import { createHash } from 'node:crypto';
import type {
  ConnectorNoteSummary,
  KnowledgeClearResult,
  KnowledgeSearchHit,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeSettings,
  KnowledgeSettingsInput,
  KnowledgeSnapshot,
  KnowledgeSourceRules,
  KnowledgeSourceSummary,
  KnowledgeSyncResult,
  KnowledgeSyncSourceResult,
} from '@shared';
import { env } from '../config/env';
import { getConnectorAdapter, listConnectorAdapters } from '../connectors/registry';
import { loadConnectorGrants } from '../connectors/grants';
import {
  getConnectedApplication,
  getConnectedApplicationSecrets,
} from '../db/repositories/connectors';
import {
  EMPTY_KNOWLEDGE_RULES,
  clearKnowledgeIndex,
  deleteKnowledgeDocumentById,
  deleteKnowledgeDocumentsByIds,
  deleteKnowledgeSource,
  getKnowledgeSettings,
  getKnowledgeSyncState,
  knowledgeSourceCounts,
  knowledgeStats,
  listKnowledgeDocumentRefs,
  listKnowledgeDocumentStates,
  normalizeKnowledgeTag,
  replaceKnowledgeDocument,
  saveKnowledgeSettings,
  saveKnowledgeSyncState,
  searchKnowledgeDocuments,
} from '../db/repositories/knowledge';
import { HttpError } from '../middleware/errors';
import { publish } from './eventBus';
import { logger } from './logger';
import type { ConnectorAdapter } from '../connectors/types';

const MAX_RULE_ITEMS = 100;
const MAX_RULE_LENGTH = 300;
const MAX_DOCUMENT_CONTENT = 250_000;
const MAX_CHUNKS = 200;
const CHUNK_SIZE = 1_600;
const CHUNK_OVERLAP = 160;
const activeSyncs = new Set<string>();

interface AdapterContext {
  adapter: ConnectorAdapter | null;
  connected: boolean;
  readGranted: boolean;
  supportsIndexing: boolean;
}

function contextFor(source: string): AdapterContext {
  const adapter = getConnectorAdapter(source);
  const connected = getConnectedApplication(source)?.status === 'connected';
  return {
    adapter,
    connected,
    readGranted: connected ? loadConnectorGrants(source).read : false,
    supportsIndexing: supportsIndexing(adapter),
  };
}

function supportsIndexing(adapter: ConnectorAdapter | null): boolean {
  if (!adapter) return false;
  return (
    adapter.descriptor.operations.some((operation) => operation.id === 'search') &&
    adapter.descriptor.operations.some((operation) => operation.id === 'read')
  );
}

function rulesFor(settings: KnowledgeSettings, source: string): KnowledgeSourceRules {
  return settings.sources[source] ?? EMPTY_KNOWLEDGE_RULES;
}

function sourceSummary(source: string): KnowledgeSourceSummary {
  const settings = getKnowledgeSettings();
  const context = contextFor(source);
  const adapter = context.adapter;
  if (!adapter) {
    const rules = rulesFor(settings, source);
    return {
      id: source,
      name: source,
      status: 'unsupported',
      connected: false,
      readGranted: false,
      supportsIndexing: false,
      indexingEnabled: false,
      documents: 0,
      chunks: 0,
      lastAttemptAt: null,
      lastIndexedAt: null,
      lastError: null,
      truncated: false,
      changeDetection: 'unsupported',
      rules,
    };
  }

  const rules = rulesFor(settings, source);
  const counts = knowledgeSourceCounts(source);
  const state = getKnowledgeSyncState(source);
  const application = getConnectedApplication(source);
  const status: KnowledgeSourceSummary['status'] =
    !application
      ? 'not-connected'
      : application.status === 'error'
        ? 'error'
        : !context.readGranted
          ? 'permission-required'
          : !context.supportsIndexing
            ? 'unsupported'
            : !settings.enabled || !rules.enabled
              ? 'disabled'
              : state?.lastError
                ? 'error'
                : counts.documents === 0
                  ? 'never-indexed'
                  : 'indexed';
  return {
    id: source,
    name: adapter.descriptor.name,
    status,
    connected: context.connected,
    readGranted: context.readGranted,
    supportsIndexing: context.supportsIndexing,
    indexingEnabled:
      settings.enabled &&
      rules.enabled &&
      context.connected &&
      context.readGranted &&
      context.supportsIndexing,
    documents: counts.documents,
    chunks: counts.chunks,
    lastAttemptAt: state?.lastAttemptAt ?? null,
    lastIndexedAt: state?.lastSuccessAt ?? null,
    lastError: state?.lastError ?? application?.lastError ?? null,
    truncated: state?.truncated ?? false,
    changeDetection: context.supportsIndexing ? 'timestamp+fingerprint' : 'unsupported',
    rules,
  };
}

export function knowledgeSnapshot(): KnowledgeSnapshot {
  const settings = getKnowledgeSettings();
  return {
    connectorsEnabled: env.connectors.enabled,
    settings,
    sources: listConnectorAdapters()
      .map((adapter) => adapter.descriptor.id)
      .sort((left, right) => left.localeCompare(right))
      .map(sourceSummary),
    stats: knowledgeStats(),
    retrieval: {
      mode: 'keyword',
      semanticAvailable: false,
      detail:
        'SQLite FTS5 keyword and phrase search. Chunks have stable ids for a future local embedding pass.',
    },
    updatedAt: new Date().toISOString(),
  };
}

function cleanRuleList(
  raw: unknown,
  options: { normalizeTags?: boolean } = {},
): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    let value = item.replace(/\s+/g, ' ').trim();
    if (options.normalizeTags) value = normalizeKnowledgeTag(value);
    if (!value || value.length > MAX_RULE_LENGTH) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= MAX_RULE_ITEMS) break;
  }
  return result;
}

function normalizeRules(raw: KnowledgeSourceRules): KnowledgeSourceRules {
  return {
    enabled: raw.enabled === true,
    excludePaths: cleanRuleList(raw.excludePaths),
    excludeCategories: cleanRuleList(raw.excludeCategories),
    excludeTags: cleanRuleList(raw.excludeTags, { normalizeTags: true }),
  };
}

function globRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(escaped, 'i');
}

function matchesRule(value: string | null | undefined, rule: string): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  const needle = rule.toLowerCase();
  if (needle.includes('*') || needle.includes('?')) {
    return globRegExp(needle).test(normalized);
  }
  return normalized.includes(needle);
}

function excluded(
  rules: KnowledgeSourceRules,
  document: {
    documentId: string;
    title: string;
    path: string;
    url?: string | null;
    category: string;
    tags: string[];
  },
): boolean {
  const paths = [document.documentId, document.title, document.path, document.url ?? ''];
  if (rules.excludePaths.some((rule) => paths.some((value) => matchesRule(value, rule)))) {
    return true;
  }
  if (
    rules.excludeCategories.some(
      (rule) => matchesRule(document.category, rule) || matchesRule(document.path, rule),
    )
  ) {
    return true;
  }
  const tags = document.tags.map(normalizeKnowledgeTag);
  if (
    rules.excludeTags.some((rule) => {
      const needle = normalizeKnowledgeTag(rule);
      return tags.some((tag) => (needle.includes('*') || needle.includes('?')
        ? globRegExp(needle).test(tag)
        : tag === needle));
    })
  ) {
    return true;
  }
  return false;
}

function pruneExcluded(source: string, rules: KnowledgeSourceRules): number {
  const refs = listKnowledgeDocumentRefs(source);
  const ids = refs
    .filter((ref) =>
      excluded(rules, {
        documentId: ref.documentId,
        title: ref.title,
        path: ref.path,
        url: ref.url,
        category: ref.category,
        tags: ref.tags,
      }),
    )
    .map((ref) => ref.id);
  return deleteKnowledgeDocumentsByIds(ids);
}

export function updateKnowledgeSettings(input: KnowledgeSettingsInput): KnowledgeSnapshot {
  if (!env.connectors.enabled) {
    throw new HttpError(
      409,
      'CONNECTOR_DISABLED',
      'Connections are disabled on this local node.',
    );
  }
  if (typeof input.enabled !== 'boolean' || !Array.isArray(input.sources)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Knowledge settings need enabled and sources.');
  }

  const registered = new Set(listConnectorAdapters().map((adapter) => adapter.descriptor.id));
  const previous = getKnowledgeSettings();
  const merged = { ...previous.sources };
  const supplied = new Set<string>();

  for (const entry of input.sources.slice(0, 100)) {
    if (!entry || typeof entry.source !== 'string' || !registered.has(entry.source)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'A knowledge source is not registered.');
    }
    if (supplied.has(entry.source)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'A knowledge source was supplied twice.');
    }
    supplied.add(entry.source);
    merged[entry.source] = normalizeRules(entry);
  }

  for (const adapter of listConnectorAdapters()) {
    const source = adapter.descriptor.id;
    if (!supplied.has(source)) {
      merged[source] ??= { ...EMPTY_KNOWLEDGE_RULES };
    }
  }

  const saved = saveKnowledgeSettings({ enabled: input.enabled, sources: merged });

  let removed = 0;
  for (const [source, rules] of Object.entries(saved.sources)) {
    if (!rules.enabled) {
      removed += deleteKnowledgeSource(source).documentsRemoved;
    } else {
      removed += pruneExcluded(source, rules);
    }
  }

  publish({
    kind: 'system',
    status: 'completed',
    summary: input.enabled ? 'Knowledge indexing settings saved' : 'Knowledge index disabled',
    detail: input.enabled
      ? `Indexing is enabled for ${Object.values(saved.sources).filter((rules) => rules.enabled).length} source(s). No new content is fetched until Sync is run.${removed ? ` ${removed} previously indexed document(s) were removed by the new exclusions.` : ''}`
      : `Existing indexed content is kept but cannot be searched until indexing is enabled again.${removed ? ` ${removed} document(s) removed for disabled sources.` : ''}`,
    meta: { removed },
  });

  return knowledgeSnapshot();
}

export function removeKnowledgeForConnector(source: string): void {
  try {
    const removed = deleteKnowledgeSource(source);
    if (removed.documentsRemoved > 0) {
      logger.info('knowledge_source_purged', {
        source,
        documents: removed.documentsRemoved,
      });
    }
  } catch (cause) {
    logger.error('knowledge_source_purge_failed', {
      source,
      message: cause instanceof Error ? cause.message : 'unknown',
    });
  }
}

function requireEnabled(): void {
  if (!getKnowledgeSettings().enabled) {
    throw new HttpError(
      409,
      'KNOWLEDGE_DISABLED',
      'The knowledge index is disabled.',
      'Enable it in Knowledge, choose sources, save, then run Sync.',
    );
  }
}

export function knowledgeIndexEnabled(): boolean {
  return getKnowledgeSettings().enabled;
}

export function assertKnowledgeSearchAllowed(): void {
  requireEnabled();
  if (!env.connectors.enabled) {
    throw new HttpError(
      409,
      'KNOWLEDGE_NOT_READY',
      'Connections are disabled, but the local knowledge index remains unavailable for search.',
    );
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableDocumentId(source: string, documentId: string): string {
  return hash(`knowledge\0${source}\0${documentId}`);
}

function chunkContent(content: string): string[] {
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
  if (!normalized) return [];
  if (normalized.length <= CHUNK_SIZE) return [normalized];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length && chunks.length < MAX_CHUNKS) {
    const hardEnd = Math.min(cursor + CHUNK_SIZE, normalized.length);
    let end = hardEnd;
    if (hardEnd < normalized.length) {
      const paragraph = normalized.lastIndexOf('\n\n', hardEnd);
      const sentence = normalized.lastIndexOf('. ', hardEnd);
      if (paragraph > cursor + CHUNK_SIZE / 2) end = paragraph;
      else if (sentence > cursor + CHUNK_SIZE / 2) end = sentence + 1;
    }
    const chunk = normalized.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    cursor = Math.max(end - CHUNK_OVERLAP, cursor + 1);
  }
  return chunks;
}

function validIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() < 1980) return null;
  return parsed.toISOString();
}

function noteUrl(summary: ConnectorNoteSummary, rawUrl: unknown): string | null {
  if (typeof rawUrl === 'string' && /^https?:\/\//i.test(rawUrl.trim())) return rawUrl.trim();
  if (/^https?:\/\//i.test(summary.path)) return summary.path;
  return null;
}

function searchLimit(adapter: ConnectorAdapter): number {
  const limit = adapter.descriptor.operations
    .find((operation) => operation.id === 'search')
    ?.arguments.find((argument) => argument.name === 'limit');
  const maximum = limit?.maximum ?? 30;
  return Math.min(Math.max(Math.trunc(maximum) || 30, 1), 50);
}

function readArgumentName(adapter: ConnectorAdapter): string {
  const operation = adapter.descriptor.operations.find((entry) => entry.id === 'read');
  const argument = operation?.arguments.find(
    (entry) => entry.required && entry.type === 'string',
  );
  return argument?.name ?? 'path';
}

function sourceResult(
  source: string,
  name: string,
  status: KnowledgeSyncSourceResult['status'],
  detail: string,
): KnowledgeSyncSourceResult {
  return {
    source,
    name,
    status,
    documentsSeen: 0,
    documentsIndexed: 0,
    documentsSkipped: 0,
    documentsRemoved: 0,
    documentsFailed: 0,
    truncated: false,
    detail,
  };
}

async function syncSource(
  source: string,
  adapter: ConnectorAdapter,
  rules: KnowledgeSourceRules,
): Promise<KnowledgeSyncSourceResult> {
  const attemptAt = new Date().toISOString();
  if (activeSyncs.has(source)) {
    return sourceResult(source, adapter.descriptor.name, 'skipped', 'A sync is already running for this source.');
  }

  activeSyncs.add(source);
  let seen = 0;
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let removed = 0;
  let truncated = false;
  const name = adapter.descriptor.name;

  try {
    const application = getConnectedApplication(source);
    if (!application || application.status !== 'connected') {
      const result = sourceResult(source, name, 'skipped', 'The application is not connected.');
      saveKnowledgeSyncState({
        source,
        lastAttemptAt: attemptAt,
        lastSuccessAt: getKnowledgeSyncState(source)?.lastSuccessAt ?? null,
        lastError: null,
        documentsSeen: 0,
        documentsIndexed: 0,
        documentsSkipped: 0,
        documentsFailed: 0,
        truncated: false,
      });
      return result;
    }

    const grants = loadConnectorGrants(source);
    if (!grants.read) {
      const result = sourceResult(source, name, 'skipped', 'Read permission is not granted.');
      return result;
    }
    if (!supportsIndexing(adapter)) {
      const result = sourceResult(source, name, 'skipped', 'This connector has no search/read indexing surface.');
      return result;
    }

    const runtime = {
      config: application.config,
      secrets: getConnectedApplicationSecrets(source),
    };

    publish({
      kind: 'system',
      status: 'progress',
      summary: `Indexing ${name}`,
      detail: 'Scanning the connector for changed documents. No content has been sent to a provider.',
      meta: { source },
    });

    const searchResult = await adapter.execute(
      'search',
      { query: '', limit: searchLimit(adapter) },
      runtime,
    );
    if (searchResult.type !== 'search') {
      throw new HttpError(502, 'KNOWLEDGE_SYNC_FAILED', `${name} returned an unexpected search result.`);
    }

    const existing = new Map(
      listKnowledgeDocumentStates(source).map((document) => [document.documentId, document]),
    );
    const readArg = readArgumentName(adapter);
    const seenIds = new Set<string>();
    truncated = searchResult.truncated || searchResult.total > searchResult.notes.length;

    for (const summary of searchResult.notes) {
      const documentId = summary.path;
      if (!documentId) continue;
      seen += 1;
      seenIds.add(documentId);
      const current = existing.get(documentId);
      const tags = [...new Set(summary.tags.map(normalizeKnowledgeTag).filter(Boolean))];
      const fingerprint = hash(
        JSON.stringify({
          path: summary.path,
          title: summary.title,
          category: summary.folder,
          tags: summary.tags,
          updatedAt: summary.updatedAt,
          sizeBytes: summary.sizeBytes,
          excerpt: summary.excerpt,
        }),
      );

      if (
        excluded(rules, {
          documentId,
          title: summary.title,
          path: summary.path,
          category: summary.folder,
          tags,
        })
      ) {
        if (current) {
          deleteKnowledgeDocumentById(current.id);
          removed += 1;
        }
        skipped += 1;
        continue;
      }

      if (current && current.fingerprint === fingerprint && current.contentHash) {
        skipped += 1;
        continue;
      }

      try {
        const readResult = await adapter.execute(
          'read',
          { [readArg]: summary.path },
          runtime,
        );
        if (readResult.type !== 'read') {
          throw new Error('The connector returned an unexpected read result.');
        }
        const note = readResult.note;
        const content = note.content.slice(0, MAX_DOCUMENT_CONTENT);
        const finalTags = [...new Set(note.tags.map(normalizeKnowledgeTag).filter(Boolean))];
        const rawUrl = note.frontmatter.values.url;
        if (
          excluded(rules, {
            documentId,
            title: note.title,
            path: note.path,
            url: noteUrl(summary, rawUrl),
            category: note.folder,
            tags: finalTags,
          })
        ) {
          if (current) {
            deleteKnowledgeDocumentById(current.id);
            removed += 1;
          }
          skipped += 1;
          continue;
        }

        const chunks = chunkContent(content);
        if (chunks.length === 0) {
          skipped += 1;
          continue;
        }
        const sourceUpdatedAt =
          validIso(note.updatedAt) ?? validIso(summary.updatedAt) ?? new Date().toISOString();
        replaceKnowledgeDocument({
          id: current?.id ?? stableDocumentId(source, documentId),
          source,
          sourceLabel: adapter.descriptor.name,
          documentId,
          title: note.title || summary.title || documentId,
          path: note.path || summary.path,
          url: noteUrl(summary, rawUrl),
          category: note.folder || summary.folder,
          tags: finalTags,
          metadata: {
            folder: note.folder || summary.folder,
            sizeBytes: note.sizeBytes,
            truncated: note.truncated || note.content.length > MAX_DOCUMENT_CONTENT,
            chunks: chunks.length,
          },
          sourceUpdatedAt,
          fingerprint,
          contentHash: hash(content),
          indexedAt: new Date().toISOString(),
          chunks,
        });
        indexed += 1;
      } catch (cause) {
        failed += 1;
        logger.warn('knowledge_document_index_failed', {
          source,
          documentId,
          message: cause instanceof Error ? cause.message : 'unknown',
        });
      }
    }

    // A complete scan is safe to mirror. A capped search cannot prove that an
    // absent document was deleted upstream, so stale rows are retained instead.
    if (!truncated) {
      const staleIds = [...existing.values()]
        .filter((document) => !seenIds.has(document.documentId))
        .map((document) => document.id);
      removed += deleteKnowledgeDocumentsByIds(staleIds);
    }

    const status: KnowledgeSyncSourceResult['status'] =
      failed > 0 ? 'partial' : indexed === 0 && removed === 0 ? 'unchanged' : 'indexed';
    const detail =
      status === 'unchanged'
        ? 'No changed documents were found.'
        : `${indexed} indexed, ${skipped} unchanged or excluded, ${removed} removed${failed ? `, ${failed} failed` : ''}.`;

    saveKnowledgeSyncState({
      source,
      lastAttemptAt: attemptAt,
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      documentsSeen: seen,
      documentsIndexed: indexed,
      documentsSkipped: skipped,
      documentsFailed: failed,
      truncated,
    });

    publish({
      kind: 'system',
      status: failed > 0 ? 'failed' : 'completed',
      summary: `${name} index ${failed > 0 ? 'partially updated' : 'updated'}`,
      detail: truncated
        ? `${detail} The connector limits this scan; older documents may not be covered.`
        : detail,
      meta: { source, indexed, skipped, removed, failed, truncated },
    });

    return {
      source,
      name,
      status,
      documentsSeen: seen,
      documentsIndexed: indexed,
      documentsSkipped: skipped,
      documentsRemoved: removed,
      documentsFailed: failed,
      truncated,
      detail: truncated
        ? `${detail} The connector returned a capped result set.`
        : detail,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The sync failed.';
    saveKnowledgeSyncState({
      source,
      lastAttemptAt: attemptAt,
      lastSuccessAt: getKnowledgeSyncState(source)?.lastSuccessAt ?? null,
      lastError: message.slice(0, 500),
      documentsSeen: seen,
      documentsIndexed: indexed,
      documentsSkipped: skipped,
      documentsFailed: failed,
      truncated,
    });
    publish({
      kind: 'system',
      status: 'failed',
      summary: `${name} index sync failed`,
      detail: message,
      meta: { source },
    });
    return sourceResult(source, name, 'failed', message);
  } finally {
    activeSyncs.delete(source);
  }
}

export async function syncKnowledge(
  sourceIds?: string[],
): Promise<KnowledgeSyncResult> {
  requireEnabled();
  if (!env.connectors.enabled) {
    throw new HttpError(
      409,
      'KNOWLEDGE_NOT_READY',
      'Connections are disabled on this local node.',
    );
  }

  const settings = getKnowledgeSettings();
  const adapters = listConnectorAdapters();
  const known = new Map(adapters.map((adapter) => [adapter.descriptor.id, adapter]));
  const requested = sourceIds?.length
    ? [...new Set(sourceIds)]
    : adapters.map((adapter) => adapter.descriptor.id);

  const unknown = requested.find((source) => !known.has(source));
  if (unknown) {
    throw new HttpError(404, 'KNOWLEDGE_SOURCE_NOT_FOUND', `${unknown} is not a registered source.`);
  }

  const startedAt = new Date().toISOString();
  const results: KnowledgeSyncSourceResult[] = [];
  for (const source of requested) {
    const adapter = known.get(source);
    if (!adapter) continue;
    const rules = rulesFor(settings, source);
    const context = contextFor(source);
    if (!context.connected) {
      results.push(sourceResult(source, adapter.descriptor.name, 'skipped', 'The application is not connected.'));
      continue;
    }
    if (!context.readGranted) {
      results.push(sourceResult(source, adapter.descriptor.name, 'skipped', 'Read permission is not granted.'));
      continue;
    }
    if (!context.supportsIndexing) {
      results.push(sourceResult(source, adapter.descriptor.name, 'skipped', 'This connector cannot be indexed.'));
      continue;
    }
    if (!rules.enabled) {
      results.push(sourceResult(source, adapter.descriptor.name, 'skipped', 'Indexing is disabled for this source.'));
      continue;
    }
    results.push(await syncSource(source, adapter, rules));
  }

  const result: KnowledgeSyncResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    sources: results,
    documentsIndexed: results.reduce((total, entry) => total + entry.documentsIndexed, 0),
    documentsSkipped: results.reduce((total, entry) => total + entry.documentsSkipped, 0),
    documentsFailed: results.reduce((total, entry) => total + entry.documentsFailed, 0),
    failedSources: results.filter((entry) => entry.status === 'failed').length,
  };
  publish({
    kind: 'system',
    status: result.failedSources > 0 ? 'failed' : 'completed',
    summary: `Knowledge sync finished: ${result.documentsIndexed} indexed`,
    detail: `${result.documentsSkipped} unchanged or excluded, ${result.documentsFailed} failed. The index stays on this device.`,
    meta: {
      indexed: result.documentsIndexed,
      skipped: result.documentsSkipped,
      failed: result.documentsFailed,
    },
  });
  return result;
}

function buildMatch(query: string): string {
  const terms: string[] = [];
  const pattern = /"([^"]{1,200})"|([^\s"]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(query)) !== null) {
    const phrase = (match[1] ?? match[2] ?? '').trim();
    if (!phrase) continue;
    const clean = phrase.replace(/["*:^(){}[\]\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    terms.push(match[1] ? `"${clean}"` : `"${clean}"*`);
    if (terms.length >= 20) break;
  }
  if (terms.length === 0) {
    throw new HttpError(400, 'KNOWLEDGE_SEARCH_FAILED', 'Enter at least one word or a quoted phrase.');
  }
  return terms.join(' AND ');
}

function searchDate(value: string, endOfDay: boolean): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !/T/.test(trimmed)) {
    throw new HttpError(400, 'KNOWLEDGE_SEARCH_FAILED', 'Use YYYY-MM-DD or an ISO date for date filters.');
  }
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    throw new HttpError(400, 'KNOWLEDGE_SEARCH_FAILED', 'That date filter is not valid.');
  }
  return parsed.toISOString();
}

export function searchKnowledge(input: KnowledgeSearchInput): KnowledgeSearchResult {
  requireEnabled();
  if (typeof input.query !== 'string' || !input.query.trim()) {
    throw new HttpError(400, 'KNOWLEDGE_SEARCH_FAILED', 'A search query is required.');
  }
  if (input.query.length > 300) {
    throw new HttpError(400, 'KNOWLEDGE_SEARCH_FAILED', 'The search query is too long.');
  }
  const sources = Array.isArray(input.sources)
    ? [...new Set(input.sources.filter((source): source is string => typeof source === 'string' && Boolean(source)))]
        .slice(0, 20)
    : [];
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags
        .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
        .map(normalizeKnowledgeTag))].slice(0, 10)
    : [];
  const limit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit!, 1), 50) : 12;
  const updatedFrom = input.updatedFrom ? searchDate(input.updatedFrom, false) : null;
  const updatedTo = input.updatedTo ? searchDate(input.updatedTo, true) : null;
  if (updatedFrom && updatedTo && updatedFrom > updatedTo) {
    throw new HttpError(400, 'KNOWLEDGE_SEARCH_FAILED', 'The start date is after the end date.');
  }

  let matched: ReturnType<typeof searchKnowledgeDocuments>;
  try {
    matched = searchKnowledgeDocuments({
      match: buildMatch(input.query),
      sources,
      tags,
      updatedFrom,
      updatedTo,
      limit,
    });
  } catch (cause) {
    if (cause instanceof HttpError) throw cause;
    logger.warn('knowledge_search_failed', {
      message: cause instanceof Error ? cause.message : 'unknown',
    });
    throw new HttpError(400, 'KNOWLEDGE_SEARCH_FAILED', 'The local index could not run that search.');
  }

  const seen = new Set<string>();
  const hits: KnowledgeSearchHit[] = [];
  for (const row of matched.rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    let tagsForHit: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.tags_json);
      if (Array.isArray(parsed)) {
        tagsForHit = parsed.filter((tag): tag is string => typeof tag === 'string');
      }
    } catch {
      tagsForHit = [];
    }
    hits.push({
      id: row.id,
      source: row.source,
      sourceLabel: row.source_label,
      documentId: row.document_id,
      title: row.title,
      path: row.path,
      url: row.url,
      category: row.category,
      tags: tagsForHit,
      updatedAt: row.updated_at,
      indexedAt: row.indexed_at,
      excerpt: String(row.excerpt ?? '').replace(/\s+/g, ' ').trim(),
      score: Number(Math.max(0, -row.rank).toFixed(4)),
      reference: {
        label: `${row.source_label}: ${row.title || row.path}`,
        source: row.source,
        documentId: row.document_id,
        path: row.path,
        url: row.url,
      },
    });
    if (hits.length >= limit) break;
  }

  return {
    query: input.query.trim(),
    hits,
    total: matched.total,
    truncated: matched.total > hits.length,
    retrieval: 'keyword',
    searchedAt: new Date().toISOString(),
  };
}

export function clearKnowledge(input: { source?: string } = {}): KnowledgeClearResult {
  if (input.source) {
    const adapter = getConnectorAdapter(input.source);
    if (!adapter) {
      throw new HttpError(404, 'KNOWLEDGE_SOURCE_NOT_FOUND', 'That source is not registered.');
    }
  }
  const result = clearKnowledgeIndex(input.source);
  publish({
    kind: 'system',
    status: 'completed',
    summary: input.source ? `Cleared ${input.source} index` : 'Cleared the knowledge index',
    detail: `${result.documentsRemoved} document(s) and ${result.chunksRemoved} chunk(s) removed from this device. Connector permissions and original content are unchanged.`,
    meta: {
      documents: result.documentsRemoved,
      chunks: result.chunksRemoved,
    },
  });
  return result;
}

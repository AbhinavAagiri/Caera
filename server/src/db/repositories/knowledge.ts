import { getDatabase, withTransaction } from '../database';
import type { KnowledgeSourceRules } from '@shared';

export const EMPTY_KNOWLEDGE_RULES: KnowledgeSourceRules = {
  enabled: false,
  excludePaths: [],
  excludeCategories: [],
  excludeTags: [],
};

export interface StoredKnowledgeSettings {
  enabled: boolean;
  sources: Record<string, KnowledgeSourceRules>;
  updatedAt: string;
}

export interface KnowledgeDocumentState {
  id: string;
  source: string;
  documentId: string;
  title: string;
  path: string;
  url: string | null;
  category: string;
  tags: string[];
  fingerprint: string;
  contentHash: string;
  sourceUpdatedAt: string;
  indexedAt: string;
}

export interface KnowledgeDocumentRef {
  id: string;
  documentId: string;
  title: string;
  path: string;
  url: string | null;
  category: string;
  tags: string[];
}

export interface SaveKnowledgeDocumentInput {
  id: string;
  source: string;
  sourceLabel: string;
  documentId: string;
  title: string;
  path: string;
  url: string | null;
  category: string;
  tags: string[];
  metadata: Record<string, unknown>;
  sourceUpdatedAt: string;
  fingerprint: string;
  contentHash: string;
  indexedAt: string;
  chunks: string[];
}

export interface KnowledgeSyncState {
  source: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  documentsSeen: number;
  documentsIndexed: number;
  documentsSkipped: number;
  documentsFailed: number;
  truncated: boolean;
  updatedAt: string;
}

export interface KnowledgeSourceCounts {
  documents: number;
  chunks: number;
}

export interface KnowledgeIndexStats {
  sources: number;
  documents: number;
  chunks: number;
  tags: number;
  lastIndexedAt: string | null;
}

export interface KnowledgeSearchQuery {
  match: string;
  sources: string[];
  tags: string[];
  updatedFrom: string | null;
  updatedTo: string | null;
  limit: number;
}

export interface KnowledgeSearchRow {
  id: string;
  source: string;
  source_label: string;
  document_id: string;
  title: string;
  path: string;
  url: string | null;
  category: string;
  tags_json: string;
  updated_at: string;
  indexed_at: string;
  excerpt: string;
  rank: number;
}

function integer(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'bigint') return Number(value);
  return fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseRules(value: unknown): KnowledgeSourceRules {
  const record =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    enabled: record.enabled === true,
    excludePaths: [...new Set(stringArray(record.excludePaths))].slice(0, 100),
    excludeCategories: [...new Set(stringArray(record.excludeCategories))].slice(0, 100),
    excludeTags: [...new Set(stringArray(record.excludeTags))].slice(0, 100),
  };
}

export function normalizeKnowledgeTag(value: string): string {
  return value.trim().replace(/^#+/, '').toLowerCase();
}

export function getKnowledgeSettings(): StoredKnowledgeSettings {
  const row = getDatabase()
    .prepare('SELECT enabled, settings_json, updated_at FROM knowledge_settings WHERE id = 1')
    .get();
  const parsed = parseJsonRecord(row?.settings_json);
  const rawSources = parseJsonRecord(parsed.sources);
  const sources: Record<string, KnowledgeSourceRules> = {};
  for (const [source, rules] of Object.entries(rawSources)) {
    sources[source] = parseRules(rules);
  }

  return {
    enabled: row?.enabled === 1 || row?.enabled === 1n,
    sources,
    updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
  };
}

export function saveKnowledgeSettings(input: {
  enabled: boolean;
  sources: Record<string, KnowledgeSourceRules>;
}): StoredKnowledgeSettings {
  const updatedAt = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE knowledge_settings
       SET enabled = ?, settings_json = ?, updated_at = ?
       WHERE id = 1`,
    )
    .run(
      input.enabled ? 1 : 0,
      JSON.stringify({ sources: input.sources }),
      updatedAt,
    );
  return getKnowledgeSettings();
}

function toDocumentState(row: Record<string, unknown>): KnowledgeDocumentState {
  return {
    id: typeof row.id === 'string' ? row.id : '',
    source: typeof row.source === 'string' ? row.source : '',
    documentId: typeof row.document_id === 'string' ? row.document_id : '',
    title: typeof row.title === 'string' ? row.title : '',
    path: typeof row.path === 'string' ? row.path : '',
    url: typeof row.url === 'string' ? row.url : null,
    category: typeof row.category === 'string' ? row.category : '',
    tags: parseStringArray(row.tags_json),
    fingerprint: typeof row.fingerprint === 'string' ? row.fingerprint : '',
    contentHash: typeof row.content_hash === 'string' ? row.content_hash : '',
    sourceUpdatedAt: typeof row.source_updated_at === 'string' ? row.source_updated_at : '',
    indexedAt: typeof row.indexed_at === 'string' ? row.indexed_at : '',
  };
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return stringArray(parsed);
  } catch {
    return [];
  }
}

export function listKnowledgeDocumentStates(source: string): KnowledgeDocumentState[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, source, document_id, title, path, url, category, tags_json,
              fingerprint, content_hash, source_updated_at, indexed_at
       FROM knowledge_documents
       WHERE source = ?
       ORDER BY document_id ASC`,
    )
    .all(source);
  return rows.map(toDocumentState);
}

export function getKnowledgeDocumentState(
  source: string,
  documentId: string,
): KnowledgeDocumentState | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, source, document_id, title, path, url, category, tags_json,
              fingerprint, content_hash, source_updated_at, indexed_at
       FROM knowledge_documents
       WHERE source = ? AND document_id = ?`,
    )
    .get(source, documentId);
  return row ? toDocumentState(row) : null;
}

export function listKnowledgeDocumentRefs(source: string): KnowledgeDocumentRef[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, document_id, title, path, url, category, tags_json
       FROM knowledge_documents
       WHERE source = ?
       ORDER BY document_id ASC`,
    )
    .all(source);
  return rows.map((row) => ({
    id: typeof row.id === 'string' ? row.id : '',
    documentId: typeof row.document_id === 'string' ? row.document_id : '',
    title: typeof row.title === 'string' ? row.title : '',
    path: typeof row.path === 'string' ? row.path : '',
    url: typeof row.url === 'string' ? row.url : null,
    category: typeof row.category === 'string' ? row.category : '',
    tags: parseStringArray(row.tags_json),
  }));
}

export function replaceKnowledgeDocument(input: SaveKnowledgeDocumentInput): void {
  withTransaction(() => {
    const database = getDatabase();
    database
      .prepare(
        `DELETE FROM knowledge_fts
         WHERE rowid IN (SELECT id FROM knowledge_chunks WHERE document_id = ?)`,
      )
      .run(input.id);
    database.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(input.id);
    database
      .prepare(
        `INSERT INTO knowledge_documents
           (id, source, source_label, document_id, title, path, url, category,
            tags_json, metadata_json, source_updated_at, fingerprint, content_hash, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.source,
        input.sourceLabel,
        input.documentId,
        input.title.slice(0, 500),
        input.path.slice(0, 2_000),
        input.url?.slice(0, 2_000) ?? null,
        input.category.slice(0, 300),
        JSON.stringify(input.tags.slice(0, 100)),
        JSON.stringify(input.metadata),
        input.sourceUpdatedAt,
        input.fingerprint,
        input.contentHash,
        input.indexedAt,
      );

    const insertTag = database.prepare(
      'INSERT OR IGNORE INTO knowledge_document_tags (document_id, tag) VALUES (?, ?)',
    );
    for (const tag of input.tags) {
      const normalized = normalizeKnowledgeTag(tag);
      if (normalized) insertTag.run(input.id, normalized.slice(0, 120));
    }

    const insertChunk = database.prepare(
      'INSERT INTO knowledge_chunks (document_id, chunk_index, content) VALUES (?, ?, ?) RETURNING id',
    );
    const insertFts = database.prepare(
      'INSERT INTO knowledge_fts (rowid, title, tags, content) VALUES (?, ?, ?, ?)',
    );
    const tagText = input.tags.join(' ');
    input.chunks.forEach((chunk, index) => {
      if (!chunk.trim()) return;
      const row = insertChunk.get(input.id, index, chunk) as { id?: unknown } | undefined;
      const chunkId = integer(row?.id, -1);
      if (chunkId < 0) throw new Error('The knowledge chunk could not be stored.');
      insertFts.run(chunkId, input.title, tagText, chunk);
    });
  });
}

export function deleteKnowledgeDocumentById(id: string): void {
  withTransaction(() => {
    const database = getDatabase();
    database
      .prepare(
        `DELETE FROM knowledge_fts
         WHERE rowid IN (SELECT id FROM knowledge_chunks WHERE document_id = ?)`,
      )
      .run(id);
    database.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(id);
  });
}

export function deleteKnowledgeDocumentsByIds(ids: string[]): number {
  if (ids.length === 0) return 0;
  let removed = 0;
  withTransaction(() => {
    for (const id of ids) {
      const database = getDatabase();
      database
        .prepare(
          `DELETE FROM knowledge_fts
           WHERE rowid IN (SELECT id FROM knowledge_chunks WHERE document_id = ?)`,
        )
        .run(id);
      const result = database.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(id);
      removed += integer(result.changes);
    }
  });
  return removed;
}

export function deleteKnowledgeSource(source: string): { documentsRemoved: number; chunksRemoved: number } {
  return withTransaction(() => {
    const database = getDatabase();
    const chunkRow = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM knowledge_chunks c
         JOIN knowledge_documents d ON d.id = c.document_id
         WHERE d.source = ?`,
      )
      .get(source);
    const documentRow = database
      .prepare('SELECT COUNT(*) AS count FROM knowledge_documents WHERE source = ?')
      .get(source);
    database
      .prepare(
        `DELETE FROM knowledge_fts
         WHERE rowid IN (
           SELECT c.id FROM knowledge_chunks c
           JOIN knowledge_documents d ON d.id = c.document_id
           WHERE d.source = ?
         )`,
      )
      .run(source);
    database.prepare('DELETE FROM knowledge_documents WHERE source = ?').run(source);
    database.prepare('DELETE FROM knowledge_sync_state WHERE source = ?').run(source);
    return {
      documentsRemoved: integer(documentRow?.count),
      chunksRemoved: integer(chunkRow?.count),
    };
  });
}

export function clearKnowledgeIndex(source?: string): {
  source: string | null;
  documentsRemoved: number;
  chunksRemoved: number;
} {
  if (source) return { source, ...deleteKnowledgeSource(source) };
  const documentRow = getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM knowledge_documents')
    .get();
  const chunkRow = getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM knowledge_chunks')
    .get();
  const documentsRemoved = integer(documentRow?.count);
  const chunksRemoved = integer(chunkRow?.count);
  withTransaction(() => {
    const database = getDatabase();
    database.exec('DELETE FROM knowledge_fts; DELETE FROM knowledge_documents; DELETE FROM knowledge_sync_state;');
  });
  return { source: null, documentsRemoved, chunksRemoved };
}

export function knowledgeSourceCounts(source: string): KnowledgeSourceCounts {
  const documentRow = getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM knowledge_documents WHERE source = ?')
    .get(source);
  const chunkRow = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE d.source = ?`,
    )
    .get(source);
  return {
    documents: integer(documentRow?.count),
    chunks: integer(chunkRow?.count),
  };
}

export function getKnowledgeSyncState(source: string): KnowledgeSyncState | null {
  const row = getDatabase()
    .prepare(
      `SELECT source, last_attempt_at, last_success_at, last_error, documents_seen,
              documents_indexed, documents_skipped, documents_failed, truncated, updated_at
       FROM knowledge_sync_state WHERE source = ?`,
    )
    .get(source);
  if (!row) return null;
  return {
    source: typeof row.source === 'string' ? row.source : source,
    lastAttemptAt: typeof row.last_attempt_at === 'string' ? row.last_attempt_at : null,
    lastSuccessAt: typeof row.last_success_at === 'string' ? row.last_success_at : null,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    documentsSeen: integer(row.documents_seen),
    documentsIndexed: integer(row.documents_indexed),
    documentsSkipped: integer(row.documents_skipped),
    documentsFailed: integer(row.documents_failed),
    truncated: row.truncated === 1 || row.truncated === 1n,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

export function saveKnowledgeSyncState(input: {
  source: string;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  documentsSeen: number;
  documentsIndexed: number;
  documentsSkipped: number;
  documentsFailed: number;
  truncated: boolean;
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO knowledge_sync_state
         (source, last_attempt_at, last_success_at, last_error, documents_seen,
          documents_indexed, documents_skipped, documents_failed, truncated, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at,
         last_error = excluded.last_error,
         documents_seen = excluded.documents_seen,
         documents_indexed = excluded.documents_indexed,
         documents_skipped = excluded.documents_skipped,
         documents_failed = excluded.documents_failed,
         truncated = excluded.truncated,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.source,
      input.lastAttemptAt,
      input.lastSuccessAt,
      input.lastError,
      input.documentsSeen,
      input.documentsIndexed,
      input.documentsSkipped,
      input.documentsFailed,
      input.truncated ? 1 : 0,
      new Date().toISOString(),
    );
}

export function knowledgeStats(): KnowledgeIndexStats {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(DISTINCT source) AS sources,
              COUNT(*) AS documents,
              (SELECT COUNT(*) FROM knowledge_chunks) AS chunks,
              (SELECT COUNT(*) FROM knowledge_document_tags) AS tags,
              MAX(indexed_at) AS last_indexed_at
       FROM knowledge_documents`,
    )
    .get();
  return {
    sources: integer(row?.sources),
    documents: integer(row?.documents),
    chunks: integer(row?.chunks),
    tags: integer(row?.tags),
    lastIndexedAt: typeof row?.last_indexed_at === 'string' ? row.last_indexed_at : null,
  };
}

function searchConditions(query: KnowledgeSearchQuery): { sql: string; params: Array<string | number> } {
  const conditions: string[] = ['knowledge_fts MATCH ?'];
  const params: Array<string | number> = [query.match];
  if (query.sources.length > 0) {
    conditions.push(`d.source IN (${query.sources.map(() => '?').join(', ')})`);
    params.push(...query.sources);
  }
  if (query.updatedFrom) {
    conditions.push('d.source_updated_at >= ?');
    params.push(query.updatedFrom);
  }
  if (query.updatedTo) {
    conditions.push('d.source_updated_at <= ?');
    params.push(query.updatedTo);
  }
  if (query.tags.length > 0) {
    conditions.push(
      `(SELECT COUNT(DISTINCT t.tag)
        FROM knowledge_document_tags t
        WHERE t.document_id = d.id AND t.tag IN (${query.tags.map(() => '?').join(', ')})) = ?`,
    );
    params.push(...query.tags, query.tags.length);
  }
  return { sql: conditions.join(' AND '), params };
}

export function searchKnowledgeDocuments(query: KnowledgeSearchQuery): {
  rows: KnowledgeSearchRow[];
  total: number;
} {
  const filters = searchConditions(query);
  const database = getDatabase();
  const totalRow = database
    .prepare(
      `SELECT COUNT(*) AS count FROM (
         SELECT DISTINCT d.id
         FROM knowledge_fts
         JOIN knowledge_chunks c ON c.id = knowledge_fts.rowid
         JOIN knowledge_documents d ON d.id = c.document_id
         WHERE ${filters.sql}
       )`,
    )
    .get(...filters.params);

  const rows = database
    .prepare(
      `SELECT d.id, d.source, d.source_label, d.document_id, d.title, d.path, d.url,
              d.category, d.tags_json, d.source_updated_at AS updated_at,
              d.indexed_at,
              COALESCE(NULLIF(snippet(knowledge_fts, 2, '', '', ' … ', 30), ''), substr(c.content, 1, 320)) AS excerpt,
              bm25(knowledge_fts, 8.0, 4.0, 1.0) AS rank
       FROM knowledge_fts
       JOIN knowledge_chunks c ON c.id = knowledge_fts.rowid
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE ${filters.sql}
       ORDER BY rank ASC, d.source_updated_at DESC
       LIMIT ?`,
    )
    .all(...filters.params, Math.min(Math.max(query.limit * 6, 24), 300)) as unknown as KnowledgeSearchRow[];

  return { rows, total: integer(totalRow?.count) };
}

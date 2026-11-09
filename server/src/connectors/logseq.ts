import type {
  ConnectorDescriptor,
  ConnectorFrontmatterValue,
  ConnectorNote,
  ConnectorNoteLink,
  ConnectorNoteSummary,
  ConnectorOperationDefinition,
  ConnectorOperationResult,
} from '@shared';
import { HttpError } from '../middleware/errors';
import {
  ConnectorHttpClient,
  isoFromUnknown,
  normalizeLoopbackBase,
  truncateText,
} from './http';
import type { ConnectorAdapter, ConnectorHealth, ConnectorRuntime } from './types';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:12315';
const MAX_CONTENT = 200_000;
const MAX_PAGE_NAME = 300;
const MAX_PAGES = 5_000;

const OPERATIONS: ConnectorOperationDefinition[] = [
  {
    id: 'search',
    capability: 'search',
    label: 'Search Logseq pages',
    description:
      'Search page titles in the graph currently open in Logseq. An empty query lists pages; body text is read through a page result rather than indexed by this adapter.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'query',
        type: 'string',
        description: 'Page title text to find. Leave empty to list pages.',
        required: false,
        maxLength: 200,
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum pages to return, from 1 to 30.',
        required: false,
        minimum: 1,
        maximum: 30,
      },
    ],
  },
  {
    id: 'read',
    capability: 'read',
    label: 'Read Logseq page',
    description:
      'Read a page and its block tree as an indented Markdown outline, including page properties, tags, wikilinks and available block IDs.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Logseq page name.',
        required: true,
        maxLength: MAX_PAGE_NAME,
      },
    ],
  },
  {
    id: 'references',
    capability: 'search',
    label: 'Read page references',
    description:
      'Retrieve pages and blocks that link to a page through Logseq linked references. Availability depends on the installed Logseq API version.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Logseq page name.',
        required: true,
        maxLength: MAX_PAGE_NAME,
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum referencing blocks to return, from 1 to 50.',
        required: false,
        minimum: 1,
        maximum: 50,
      },
    ],
  },
  {
    id: 'create',
    capability: 'create',
    label: 'Create Logseq page',
    description:
      'Create a page in the current graph. Existing pages are rejected rather than appended to. Optional content is appended as one block.',
    permission: 'create',
    destructive: false,
    arguments: [
      {
        name: 'title',
        type: 'string',
        description: 'Page name.',
        required: true,
        maxLength: 200,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Optional initial block content.',
        required: false,
        maxLength: MAX_CONTENT,
      },
    ],
  },
  {
    id: 'append',
    capability: 'append',
    label: 'Append to Logseq page',
    description:
      'Append one block to an existing page. Logseq parses page references and tags in the content.',
    permission: 'edit',
    destructive: false,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Logseq page name.',
        required: true,
        maxLength: MAX_PAGE_NAME,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Block content to append.',
        required: true,
        maxLength: MAX_CONTENT,
      },
    ],
  },
  {
    id: 'update-block',
    capability: 'update',
    label: 'Update Logseq block',
    description:
      'Replace the content of one existing block by UUID. Use the block IDs returned by read. Always requires confirmation.',
    permission: 'edit',
    destructive: true,
    arguments: [
      {
        name: 'blockId',
        type: 'string',
        description: 'UUID of the block to update, from a read result.',
        required: true,
        maxLength: 100,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Replacement block content.',
        required: true,
        maxLength: MAX_CONTENT,
      },
    ],
  },
];

const DESCRIPTOR: ConnectorDescriptor = {
  id: 'logseq',
  name: 'Logseq',
  vendor: 'Logseq',
  description:
    'Search, read and write the graph currently open in Logseq through its local HTTP API. The token stays server-side; no graph folder is exposed to the browser.',
  availability: 'available',
  availabilityDetail:
    'Logseq desktop local HTTP API (documented from 0.8.15). File and DB graphs expose some methods differently; unsupported calls fail explicitly. Live verification requires a running Logseq graph.',
  auth: {
    method: 'local-api',
    label: 'Logseq local HTTP API',
    description:
      'Enable Logseq → Settings → Advanced → Developer mode, then Settings → Features → HTTP APIs server. Create a token and keep Logseq running with the target graph open.',
    fields: [
      {
        key: 'endpoint',
        label: 'Local API address',
        type: 'url',
        required: false,
        defaultValue: DEFAULT_ENDPOINT,
        placeholder: DEFAULT_ENDPOINT,
        help: 'Loopback only. The adapter calls the documented /api endpoint.',
      },
      {
        key: 'token',
        label: 'API token',
        type: 'secret',
        required: true,
        placeholder: 'Logseq HTTP API token',
        help: 'Only the token value is sent in the Authorization header. It never leaves this local node.',
      },
      {
        key: 'expectedGraph',
        label: 'Expected graph name',
        type: 'text',
        required: false,
        placeholder: 'My graph',
        help: 'Optional safety check. If set, the current Logseq graph must match before tools are exposed.',
      },
    ],
    alternatives: [
      {
        method: 'local-folder',
        label: 'Direct graph folder (planned)',
        description:
          'A future file adapter could read Markdown directly. It is not implemented; the local HTTP API is the supported transport.',
      },
    ],
  },
  capabilities: ['search', 'read', 'create', 'append', 'update'],
  permissions: ['read', 'create', 'edit'],
  operations: OPERATIONS,
};

interface LogseqPage {
  id?: number | string;
  uuid?: string;
  name?: string;
  originalName?: string;
  namespace?: string | { name?: string };
  journal?: boolean;
  updatedAt?: number | string;
  createdAt?: number | string;
  properties?: Record<string, unknown>;
}

interface LogseqBlock {
  id?: number | string;
  uuid?: string;
  content?: string;
  title?: string;
  marker?: string;
  children?: LogseqBlock[];
  page?: LogseqPage | { name?: string; originalName?: string };
  properties?: Record<string, unknown>;
  updatedAt?: number | string;
}

function invalid(message: string, hint?: string): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', message, hint);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function pageName(raw: unknown): string {
  if (typeof raw !== 'string') throw invalid('A Logseq page name is required.');
  const value = raw.trim();
  if (!value) throw invalid('A Logseq page name is required.');
  if (value.length > MAX_PAGE_NAME) {
    throw invalid(`A Logseq page name must be ${MAX_PAGE_NAME} characters or fewer.`);
  }
  if (/[\u0000-\u001f]/.test(value)) {
    throw invalid('A Logseq page name cannot contain control characters.');
  }
  return value;
}

function blockUuid(raw: unknown): string {
  if (typeof raw !== 'string') throw invalid('A Logseq block UUID is required.');
  const value = raw.trim();
  if (!value || value.length > 100 || /\s/.test(value)) {
    throw invalid('That is not a valid Logseq block UUID.');
  }
  return value;
}

function contentArgument(raw: unknown, required: boolean): string {
  if (raw === undefined && !required) return '';
  if (typeof raw !== 'string') throw invalid('Content must be a string.');
  if (raw.length > MAX_CONTENT) {
    throw invalid(`Content must be ${MAX_CONTENT} characters or fewer.`);
  }
  if (required && !raw.trim()) throw invalid('Content is required.');
  return raw;
}

function propertyValue(raw: unknown): ConnectorFrontmatterValue {
  if (raw === null) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
          return String(entry);
        }
        const record = asRecord(entry);
        return stringValue(record.name) || stringValue(record.value);
      })
      .filter(Boolean);
  }
  const record = asRecord(raw);
  if ('value' in record) return propertyValue(record.value);
  return stringValue(record.name) || stringValue(record.value) || null;
}

function normalizeProperties(raw: unknown): Record<string, ConnectorFrontmatterValue> {
  const values: Record<string, ConnectorFrontmatterValue> = {};
  for (const [key, value] of Object.entries(asRecord(raw))) {
    const normalized = propertyValue(value);
    if (normalized !== null) values[key] = normalized;
  }
  return values;
}

function pageNameOf(page: LogseqPage | undefined): string {
  return stringValue(page?.name) || stringValue(page?.originalName) || 'Untitled Logseq page';
}

function pageFolder(page: LogseqPage): string {
  if (page.journal === true) return 'Journal';
  const namespace =
    typeof page.namespace === 'string'
      ? page.namespace
      : stringValue(page.namespace?.name);
  if (namespace.trim()) return namespace.replace(/\/+$/, '');
  const name = pageNameOf(page);
  return name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : 'Page';
}

function tagsFromProperties(properties: Record<string, unknown>): string[] {
  const tags: string[] = [];
  for (const [key, raw] of Object.entries(properties)) {
    if (!/^tags?$/i.test(key)) continue;
    const value = propertyValue(raw);
    if (Array.isArray(value)) tags.push(...value);
    else if (typeof value === 'string') tags.push(...value.split(/[,\s]+/));
  }
  return tags;
}

function collectTags(properties: Record<string, unknown>, content: string): string[] {
  const tags = tagsFromProperties(properties);
  const seen = new Set(tags.map((tag) => tag.toLowerCase()));
  let fence: string | null = null;

  for (const line of content.split(/\r?\n/)) {
    const fenceMarker = /^\s*(```|~~~)/.exec(line);
    if (fenceMarker) {
      const marker = fenceMarker[1] ?? '';
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence || /^#{1,6}\s+/.test(line)) continue;

    const pattern = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const tag = (match[2] ?? '').trim();
      if (!tag || seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  return tags;
}

function collectLinks(content: string): ConnectorNoteLink[] {
  const links: ConnectorNoteLink[] = [];
  const seen = new Set<string>();
  const pattern = /\[\[([^\]\n]+)\]\]/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const inner = (match[1] ?? '').trim();
    if (!inner) continue;
    const separator = inner.indexOf('|');
    const target = (separator >= 0 ? inner.slice(0, separator) : inner).trim();
    const label = separator >= 0 ? inner.slice(separator + 1).trim() : target;
    const key = `${target}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      raw: match[0],
      target,
      label: label || target,
      kind: 'wikilink',
      resolvedPath: null,
    });
  }
  return links;
}

function propertyExcerpt(properties: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(properties)) {
    if (/^tags?$/i.test(key)) continue;
    const value = propertyValue(raw);
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    parts.push(`${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
    if (parts.length >= 3) break;
  }
  return compact(parts.join(' · ')).slice(0, 240);
}

function summaryForPage(page: LogseqPage): ConnectorNoteSummary {
  const properties = asRecord(page.properties);
  return {
    path: pageNameOf(page),
    title: stringValue(page.originalName) || pageNameOf(page),
    folder: pageFolder(page),
    excerpt: propertyExcerpt(properties) || 'Logseq page',
    tags: tagsFromProperties(properties),
    updatedAt: isoFromUnknown(page.updatedAt ?? page.createdAt),
    sizeBytes: 0,
  };
}

function blockText(block: LogseqBlock): string {
  const text = stringValue(block.title) || stringValue(block.content);
  const marker = stringValue(block.marker);
  if (marker && !text.trimStart().startsWith(marker)) return `${marker} ${text}`;
  return text;
}

function renderBlocks(blocks: LogseqBlock[], depth = 0): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const text = blockText(block).replace(/\r\n/g, '\n').trimEnd();
    if (!text) continue;
    const indent = '  '.repeat(Math.max(depth, 0));
    const textLines = text.split('\n');
    lines.push(
      ...textLines.map((line, index) =>
        index === 0 ? `${indent}- ${line}` : `${indent}  ${line}`,
      ),
    );
    if (Array.isArray(block.children) && block.children.length > 0) {
      const children = renderBlocks(block.children, depth + 1);
      if (children) lines.push(children);
    }
  }
  return lines.join('\n');
}

function collectBlockIds(blocks: LogseqBlock[]): string[] {
  const ids: string[] = [];
  const visit = (block: LogseqBlock): void => {
    if (ids.length >= 100) return;
    const uuid = stringValue(block.uuid) || (block.id !== undefined ? String(block.id) : '');
    if (uuid) ids.push(uuid);
    for (const child of block.children ?? []) visit(child);
  };
  for (const block of blocks) visit(block);
  return ids;
}

class LogseqClient {
  private readonly http: ConnectorHttpClient;

  constructor(runtime: ConnectorRuntime) {
    const token = (runtime.secrets.token ?? runtime.config.token ?? '').trim();
    if (!token) {
      throw new HttpError(
        401,
        'CONNECTOR_AUTH_FAILED',
        'Logseq has no local API token.',
        'Reconnect Logseq in Connections with the token shown in its HTTP APIs server settings.',
      );
    }
    const endpoint = normalizeLoopbackBase(
      runtime.config.endpoint,
      DEFAULT_ENDPOINT,
      'The Logseq address',
    );
    this.http = new ConnectorHttpClient({
      baseUrl: endpoint,
      label: 'Logseq',
      headers: { Authorization: `Bearer ${token}` },
      minIntervalMs: 40,
      timeoutMs: 20_000,
      authHint:
        'Enable the HTTP APIs server in Logseq, keep Logseq running, and confirm the token in Connections.',
    });
  }

  async call<T>(method: string, args: unknown[]): Promise<T> {
    const data = await this.http.request<unknown>({
      path: '/api',
      method: 'POST',
      body: { method, args },
      retryOnServerError: true,
    });

    if (typeof data === 'string' && data.trim()) {
      const message = compact(data).slice(0, 300);
      if (/error|not found|unsupported|invalid|unknown method/i.test(message)) {
        throw new HttpError(
          409,
          'CONNECTOR_UNSUPPORTED_VERSION',
          `Logseq could not run ${method}: ${message}`,
          'This Logseq version may not expose that API method. Update Logseq or use an operation supported by this build.',
        );
      }
    }

    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const record = data as Record<string, unknown>;
      if (record.error) {
        throw new HttpError(
          409,
          'CONNECTOR_UNSUPPORTED_VERSION',
          `Logseq could not run ${method}: ${compact(String(record.error))}`,
          'The installed Logseq version may not expose that API method.',
        );
      }
    }

    return data as T;
  }
}

function asPages(value: unknown): LogseqPage[] {
  return asArray(value).map((entry) => asRecord(entry) as LogseqPage);
}

async function searchPages(
  client: LogseqClient,
  query: string,
  requestedLimit: number,
): Promise<ConnectorOperationResult> {
  const rawPages = await client.call<unknown>('logseq.Editor.getAllPages', []);
  if (!Array.isArray(rawPages)) {
    throw new HttpError(
      502,
      'CONNECTOR_OPERATION_FAILED',
      'Logseq returned an unexpected page list.',
    );
  }

  const pages = asPages(rawPages);
  const needle = query.trim().toLowerCase();
  const matched: ConnectorNoteSummary[] = [];
  let scanned = 0;

  for (const page of pages) {
    if (scanned >= MAX_PAGES) break;
    scanned += 1;
    const title = stringValue(page.originalName) || pageNameOf(page);
    if (needle && !title.toLowerCase().includes(needle)) continue;
    matched.push(summaryForPage(page));
  }

  matched.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const limit = Math.min(Math.max(Math.trunc(requestedLimit) || 10, 1), 30);

  return {
    type: 'search',
    notes: matched.slice(0, limit),
    total: matched.length,
    truncated: pages.length > MAX_PAGES || matched.length > limit,
  };
}

async function readPage(client: LogseqClient, rawPath: string): Promise<ConnectorOperationResult> {
  const name = pageName(rawPath);
  const page = await client.call<LogseqPage | null>('logseq.Editor.getPage', [name]);
  if (!page) {
    throw new HttpError(404, 'CONNECTOR_RESOURCE_NOT_FOUND', 'That Logseq page was not found.');
  }

  const rawBlocks = await client.call<unknown>('logseq.Editor.getPageBlocksTree', [name]);
  if (!Array.isArray(rawBlocks)) {
    throw new HttpError(
      502,
      'CONNECTOR_OPERATION_FAILED',
      'Logseq returned an unexpected block tree.',
    );
  }
  const blocks = rawBlocks.map((entry) => asRecord(entry) as LogseqBlock);
  const rendered = renderBlocks(blocks);
  const clipped = truncateText(rendered, MAX_CONTENT);

  let pageProperties: Record<string, unknown> = {};
  try {
    pageProperties = asRecord(
      await client.call<unknown>('logseq.Editor.getPageProperties', [name]),
    );
  } catch {
    pageProperties = asRecord(page.properties);
  }

  const values = normalizeProperties(pageProperties);
  const blockIds = collectBlockIds(blocks);
  const blockCount = blockIds.length;
  values.blockIds = blockIds;
  values.blockCount = blockCount;

  const note: ConnectorNote = {
    path: pageNameOf(page),
    title: stringValue(page.originalName) || pageNameOf(page),
    folder: pageFolder(page),
    excerpt: compact(clipped.text).slice(0, 240) || propertyExcerpt(pageProperties),
    tags: collectTags(pageProperties, clipped.text),
    content: clipped.text,
    truncated: clipped.truncated || blockCount >= 100,
    updatedAt: isoFromUnknown(page.updatedAt ?? page.createdAt),
    sizeBytes: Buffer.byteLength(clipped.text, 'utf8'),
    frontmatter: { raw: '', values },
    links: collectLinks(clipped.text),
  };

  return { type: 'read', note };
}

async function readReferences(
  client: LogseqClient,
  rawPath: string,
  requestedLimit: number,
): Promise<ConnectorOperationResult> {
  const name = pageName(rawPath);
  const page = await client.call<LogseqPage | null>('logseq.Editor.getPage', [name]);
  if (!page) {
    throw new HttpError(404, 'CONNECTOR_RESOURCE_NOT_FOUND', 'That Logseq page was not found.');
  }

  const raw = await client.call<unknown>('logseq.Editor.getPageLinkedReferences', [name]);
  const notes: ConnectorNoteSummary[] = [];
  const limit = Math.min(Math.max(Math.trunc(requestedLimit) || 20, 1), 50);
  let total = 0;
  const seen = new Set<string>();

  for (const entry of asArray(raw)) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const sourcePage = asRecord(entry[0]) as LogseqPage;
    const blocks = asArray(entry[1]);
    for (const block of blocks) {
      const record = asRecord(block) as LogseqBlock;
      const excerpt = compact(blockText(record)).slice(0, 240);
      if (!excerpt) continue;
      const key = `${pageNameOf(sourcePage)}|${String(record.uuid ?? record.id ?? '')}|${excerpt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += 1;
      if (notes.length >= limit) continue;
      notes.push({
        path: pageNameOf(sourcePage),
        title: stringValue(sourcePage.originalName) || pageNameOf(sourcePage),
        folder: 'Reference',
        excerpt,
        tags: collectTags(asRecord(sourcePage.properties), excerpt),
        updatedAt: isoFromUnknown(record.updatedAt ?? sourcePage.updatedAt ?? sourcePage.createdAt),
        sizeBytes: 0,
      });
    }
  }

  return { type: 'search', notes, total, truncated: total > limit };
}

async function createPage(
  client: LogseqClient,
  args: Record<string, unknown>,
): Promise<ConnectorOperationResult> {
  const name = pageName(args.title);
  if (name.length > 200) throw invalid('A new Logseq page name must be 200 characters or fewer.');
  const content = contentArgument(args.content, false);

  const existing = await client.call<LogseqPage | null>('logseq.Editor.getPage', [name]);
  if (existing) {
    throw new HttpError(
      409,
      'CONNECTOR_RESOURCE_EXISTS',
      'A Logseq page with that name already exists.',
      'Open the existing page or choose a different name.',
    );
  }

  const created = await client.call<LogseqPage | null>('logseq.Editor.createPage', [
    name,
    {},
    { createFirstBlock: false, redirect: false, journal: false },
  ]);
  if (!created) {
    throw new HttpError(
      502,
      'CONNECTOR_OPERATION_FAILED',
      'Logseq did not return the created page.',
    );
  }

  if (content.trim()) {
    try {
      await client.call('logseq.Editor.appendBlockInPage', [name, content]);
    } catch (cause) {
      const detail =
        cause instanceof HttpError ? `${cause.message} ${cause.hint ?? ''}`.trim() : '';
      throw new HttpError(
        502,
        'CONNECTOR_PARTIAL_WRITE',
        'The Logseq page was created, but its initial content could not be appended.',
        detail || 'Open the page in Logseq to inspect it before retrying.',
      );
    }
  }

  const saved = (await client.call<LogseqPage | null>('logseq.Editor.getPage', [name])) ?? created;
  return { type: 'write', note: summaryForPage(saved), created: true };
}

async function appendToPage(
  client: LogseqClient,
  args: Record<string, unknown>,
): Promise<ConnectorOperationResult> {
  const name = pageName(args.path);
  const content = contentArgument(args.content, true);
  const page = await client.call<LogseqPage | null>('logseq.Editor.getPage', [name]);
  if (!page) {
    throw new HttpError(404, 'CONNECTOR_RESOURCE_NOT_FOUND', 'That Logseq page was not found.');
  }

  await client.call('logseq.Editor.appendBlockInPage', [name, content]);
  return { type: 'write', note: summaryForPage(page), created: false };
}

async function updateBlock(
  client: LogseqClient,
  args: Record<string, unknown>,
): Promise<ConnectorOperationResult> {
  const uuid = blockUuid(args.blockId);
  const content = contentArgument(args.content, true);
  const block = await client.call<LogseqBlock | null>('logseq.Editor.getBlock', [uuid]);
  if (!block) {
    throw new HttpError(404, 'CONNECTOR_RESOURCE_NOT_FOUND', 'That Logseq block was not found.');
  }

  await client.call('logseq.Editor.updateBlock', [uuid, content]);

  const parentPage = asRecord(block.page) as LogseqPage;
  const parentName = pageNameOf(parentPage);
  let savedPage: LogseqPage | null = null;
  if (parentName !== 'Untitled Logseq page') {
    try {
      savedPage = await client.call<LogseqPage | null>('logseq.Editor.getPage', [parentName]);
    } catch {
      savedPage = null;
    }
  }

  if (savedPage) {
    return { type: 'write', note: summaryForPage(savedPage), created: false };
  }

  const title = parentPage.originalName || parentName;
  return {
    type: 'write',
    note: {
      path: title,
      title,
      folder: 'Logseq block',
      excerpt: compact(content).slice(0, 240),
      tags: collectTags({}, content),
      updatedAt: isoFromUnknown(block.updatedAt),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    },
    created: false,
  };
}

async function testLogseq(runtime: ConnectorRuntime): Promise<ConnectorHealth> {
  try {
    const client = new LogseqClient(runtime);
    const graph = await client.call<Record<string, unknown> | null>(
      'logseq.App.getCurrentGraph',
      [],
    );
    if (!graph) {
      return {
        ok: false,
        detail: 'Logseq answered, but no graph is open in the desktop app.',
      };
    }

    const name =
      stringValue(graph.name) ||
      stringValue(graph.graph) ||
      stringValue(graph.url) ||
      'current graph';
    const expected = (runtime.config.expectedGraph ?? '').trim();
    if (expected && name.toLowerCase() !== expected.toLowerCase()) {
      return {
        ok: false,
        detail: `Logseq is open on "${name}", not the configured graph "${expected}".`,
      };
    }

    return {
      ok: true,
      detail: `Logseq local API reachable for the "${name}" graph. Method availability depends on the installed Logseq version.`,
      metadata: { graph: name },
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof HttpError
          ? `${error.message}${error.hint ? ` ${error.hint}` : ''}`
          : 'The Logseq local API could not be reached.',
    };
  }
}

export const logseqConnector: ConnectorAdapter = {
  descriptor: DESCRIPTOR,

  prepareConfig(input) {
    const endpoint = normalizeLoopbackBase(
      typeof input.endpoint === 'string' ? input.endpoint : undefined,
      DEFAULT_ENDPOINT,
      'The Logseq address',
    );
    const token = typeof input.token === 'string' ? input.token.trim() : '';
    if (!token) {
      throw new HttpError(
        400,
        'CONNECTOR_CONFIG_INVALID',
        'A Logseq HTTP API token is required.',
        'Enable the HTTP APIs server in Logseq, create a token, and paste it here.',
      );
    }
    if (token.length > 500 || /\s/.test(token)) {
      throw new HttpError(
        400,
        'CONNECTOR_CONFIG_INVALID',
        'That does not look like a Logseq HTTP API token.',
      );
    }

    const expectedGraph =
      typeof input.expectedGraph === 'string' ? input.expectedGraph.trim() : '';
    if (expectedGraph.length > 200) {
      throw new HttpError(
        400,
        'CONNECTOR_CONFIG_INVALID',
        'The expected graph name must be 200 characters or fewer.',
      );
    }

    return {
      config: {
        endpoint,
        ...(expectedGraph ? { expectedGraph } : {}),
      },
      secrets: { token },
    };
  },

  test: testLogseq,

  requiresConfirmation(operationId) {
    return operationId === 'update-block';
  },

  async execute(operationId, args, runtime) {
    const client = new LogseqClient(runtime);

    switch (operationId) {
      case 'search':
        return searchPages(
          client,
          typeof args.query === 'string' ? args.query : '',
          typeof args.limit === 'number' ? args.limit : 10,
        );
      case 'read':
        return readPage(client, typeof args.path === 'string' ? args.path : '');
      case 'references':
        return readReferences(
          client,
          typeof args.path === 'string' ? args.path : '',
          typeof args.limit === 'number' ? args.limit : 20,
        );
      case 'create':
        return createPage(client, args);
      case 'append':
        return appendToPage(client, args);
      case 'update-block':
        return updateBlock(client, args);
      default:
        throw new HttpError(
          404,
          'CONNECTOR_TOOL_NOT_FOUND',
          'That operation is not registered for Logseq.',
        );
    }
  },

  async disconnect() {
    // The local token is removed with the connection. Logseq-side revocation
    // remains a user action in the app.
  },
};

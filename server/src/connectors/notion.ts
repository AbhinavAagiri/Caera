import type {
  ConnectorDescriptor,
  ConnectorFrontmatterValue,
  ConnectorNote,
  ConnectorNoteSummary,
  ConnectorOperationDefinition,
  ConnectorOperationResult,
} from '@shared';
import { HttpError } from '../middleware/errors';
import {
  ConnectorHttpClient,
  isoFromUnknown,
  truncateText,
} from './http';
import type { ConnectorAdapter, ConnectorHealth, ConnectorRuntime } from './types';

const NOTION_BASE = 'https://api.notion.com';
const NOTION_VERSION = '2026-03-11';
const MAX_CONTENT = 200_000;
const MAX_BLOCKS = 240;
const MAX_BLOCK_REQUESTS = 12;
const MAX_BLOCK_DEPTH = 4;
const MAX_APPEND_BLOCKS = 100;

const OPERATIONS: ConnectorOperationDefinition[] = [
  {
    id: 'search',
    capability: 'search',
    label: 'Search Notion pages',
    description:
      'Search pages shared with the Notion connection by title. The Notion search API does not search page body text. An empty query lists recently edited pages.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'query',
        type: 'string',
        description: 'Page title text to find. Leave empty for recent pages.',
        required: false,
        maxLength: 200,
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum pages to return, from 1 to 50.',
        required: false,
        minimum: 1,
        maximum: 50,
      },
    ],
  },
  {
    id: 'read',
    capability: 'read',
    label: 'Read Notion page',
    description:
      'Read one page and its content as Markdown, including properties, tags and supported block types. Child pages are referenced but not recursively included.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Notion page ID or page URL.',
        required: true,
        maxLength: 500,
      },
    ],
  },
  {
    id: 'query-data-source',
    capability: 'search',
    label: 'Query data source',
    description:
      'Retrieve entries from one Notion data source (the queryable part of a database) that is shared with the connection.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'dataSourceId',
        type: 'string',
        description: 'Data source ID. Current Notion API versions query data sources, not databases.',
        required: true,
        maxLength: 200,
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum entries to return, from 1 to 50.',
        required: false,
        minimum: 1,
        maximum: 50,
      },
    ],
  },
  {
    id: 'create',
    capability: 'create',
    label: 'Create Notion page',
    description:
      'Create a page under a shared page or a data source. Content is sent as Notion-flavored Markdown. Creating a data-source entry requires its title property and uses the supplied properties JSON when present.',
    permission: 'create',
    destructive: false,
    arguments: [
      {
        name: 'parentId',
        type: 'string',
        description: 'Page ID or data source ID that will own the new page.',
        required: true,
        maxLength: 200,
      },
      {
        name: 'parentType',
        type: 'string',
        description: 'Whether parentId is a page or a data source.',
        required: true,
        enum: ['page', 'data-source'],
      },
      {
        name: 'title',
        type: 'string',
        description: 'Title of the new page.',
        required: true,
        maxLength: 200,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Initial Markdown content. May be empty.',
        required: false,
        maxLength: MAX_CONTENT,
      },
      {
        name: 'properties',
        type: 'string',
        description:
          'Optional JSON object of simple property values for a data-source entry, for example {"Status":"Active"}.',
        required: false,
        maxLength: 20_000,
      },
    ],
  },
  {
    id: 'append',
    capability: 'append',
    label: 'Append to Notion page',
    description:
      'Append Markdown content to an existing page. Supports paragraphs, headings, bulleted and numbered lists, to-dos, quotes, code fences and dividers, up to 100 blocks per call.',
    permission: 'edit',
    destructive: false,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Notion page ID or page URL.',
        required: true,
        maxLength: 500,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Markdown content to append.',
        required: true,
        maxLength: MAX_CONTENT,
      },
    ],
  },
  {
    id: 'update',
    capability: 'update',
    label: 'Update Notion properties',
    description:
      'Update supported Notion page properties. Content is changed with append, never silently replaced. Always requires confirmation.',
    permission: 'edit',
    destructive: true,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Notion page ID or page URL.',
        required: true,
        maxLength: 500,
      },
      {
        name: 'title',
        type: 'string',
        description: 'Optional replacement title.',
        required: false,
        maxLength: 200,
      },
      {
        name: 'properties',
        type: 'string',
        description:
          'Optional JSON object of simple property values, for example {"Status":"Done","Tags":["project"]}.',
        required: false,
        maxLength: 20_000,
      },
    ],
  },
  {
    id: 'open',
    capability: 'open',
    label: 'Open in Notion',
    description: 'Return the current Notion URL for a page. CAERA does not launch applications.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Notion page ID or page URL.',
        required: true,
        maxLength: 500,
      },
    ],
  },
];

const DESCRIPTOR: ConnectorDescriptor = {
  id: 'notion',
  name: 'Notion',
  vendor: 'Notion Labs',
  description:
    'Search, read, create and update Notion pages and data-source entries through the official API. Access is limited to resources shared with the Notion connection; the token stays on the local node.',
  availability: 'available',
  availabilityDetail:
    'Official Notion API 2026-03-11. Uses a Notion integration token. Live verification still requires a real workspace token.',
  auth: {
    method: 'api-key',
    label: 'Notion integration token',
    description:
      'Create an internal integration in Notion, share only the pages or databases it should reach, then paste its token here. The token is stored server-side and never returned to the browser.',
    fields: [
      {
        key: 'apiKey',
        label: 'Integration token',
        type: 'secret',
        required: true,
        placeholder: 'ntn_…',
        help: 'Notion → Settings → Connections → Develop or manage integrations. Use an internal integration token, not a browser session.',
      },
    ],
    alternatives: [
      {
        method: 'oauth',
        label: 'Notion OAuth (planned)',
        description:
          'A public OAuth flow is not implemented in this local build. The API-key transport uses the same official API and the same server-side credential boundary.',
      },
    ],
  },
  capabilities: ['search', 'read', 'create', 'append', 'update', 'open'],
  permissions: ['read', 'create', 'edit'],
  operations: OPERATIONS,
};

interface NotionPage {
  id: string;
  object?: string;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  parent?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

interface NotionBlock {
  id: string;
  type?: string;
  has_children?: boolean;
  [key: string]: unknown;
}

interface LoadedBlock {
  block: NotionBlock;
  children: LoadedBlock[];
}

interface BlockState {
  count: number;
  requests: number;
  truncated: boolean;
}

interface DataSource {
  id: string;
  title?: unknown;
  properties?: Record<string, unknown>;
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

function notionId(raw: string, label: string): string {
  const value = raw.trim();
  if (!value) throw invalid(`${label} is required.`);

  let candidate = value;
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      const embedded = url.pathname.match(/[0-9a-f]{32}/i);
      if (embedded) {
        candidate = embedded[0];
      } else {
        const parts = url.pathname.split('/').filter(Boolean);
        candidate = parts[parts.length - 1] ?? '';
      }
    }
  } catch {
    // Keep the original value; the format check below produces a useful error.
  }

  candidate = candidate.replace(/^(page|data-source|data_source)[:/]/i, '');
  const hex = candidate.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(hex)) {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  if (/^[0-9a-f][0-9a-f-]{19,63}$/i.test(candidate)) return candidate;

  throw invalid(
    `That is not a ${label} ID or URL.`,
    'Use the 32-character Notion ID, a UUID, or the page URL.',
  );
}

function richTextPlain(value: unknown): string {
  return asArray(value)
    .map((item) => stringValue(asRecord(item).plain_text))
    .join('');
}

function richText(value: string): Array<Record<string, unknown>> {
  const text = value || '';
  const chunks: string[] = [];
  for (let index = 0; index < text.length || chunks.length === 0; index += 1_900) {
    chunks.push(text.slice(index, index + 1_900));
    if (index + 1_900 >= text.length) break;
  }
  return chunks.map((chunk) => ({ type: 'text', text: { content: chunk } }));
}

function pageTitle(page: NotionPage): string {
  for (const property of Object.values(page.properties ?? {})) {
    const value = asRecord(property);
    if (value.type !== 'title' && !Array.isArray(value.title)) continue;
    const text = richTextPlain(value.title);
    if (text.trim()) return text.trim();
  }
  return 'Untitled Notion page';
}

function propertyValue(property: unknown): ConnectorFrontmatterValue {
  const value = asRecord(property);
  const type = stringValue(value.type);
  switch (type) {
    case 'title':
    case 'rich_text':
      return richTextPlain(value[type]);
    case 'number':
      return typeof value.number === 'number' ? value.number : null;
    case 'select': {
      const selected = asRecord(value.select);
      return typeof selected.name === 'string' ? selected.name : null;
    }
    case 'status': {
      const status = asRecord(value.status);
      return typeof status.name === 'string' ? status.name : null;
    }
    case 'multi_select':
      return asArray(value.multi_select)
        .map((entry) => stringValue(asRecord(entry).name))
        .filter(Boolean);
    case 'date': {
      const date = asRecord(value.date);
      const start = stringValue(date.start);
      if (!start) return null;
      const end = stringValue(date.end);
      return end ? `${start} → ${end}` : start;
    }
    case 'checkbox':
      return value.checkbox === true;
    case 'url':
      return stringValue(value.url) || null;
    case 'email':
      return stringValue(value.email) || null;
    case 'phone_number':
      return stringValue(value.phone_number) || null;
    case 'people':
      return asArray(value.people)
        .map((person) => {
          const record = asRecord(person);
          return stringValue(record.name) || stringValue(record.id);
        })
        .filter(Boolean);
    case 'relation':
      return asArray(value.relation)
        .map((relation) => stringValue(asRecord(relation).id))
        .filter(Boolean);
    case 'created_time':
      return stringValue(value.created_time) || null;
    case 'last_edited_time':
      return stringValue(value.last_edited_time) || null;
    case 'created_by':
    case 'last_edited_by': {
      const user = asRecord(value[type]);
      return stringValue(user.name) || stringValue(user.id) || null;
    }
    case 'files':
      return asArray(value.files)
        .map((file) => {
          const record = asRecord(file);
          return stringValue(record.name);
        })
        .filter(Boolean);
    case 'formula': {
      const formula = asRecord(value.formula);
      const kind = stringValue(formula.type);
      const result = formula[kind];
      if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
        return result;
      }
      return null;
    }
    case 'verification': {
      const verification = asRecord(value.verification);
      return stringValue(verification.state) || null;
    }
    default:
      return null;
  }
}

function propertyValues(page: NotionPage): Record<string, ConnectorFrontmatterValue> {
  const values: Record<string, ConnectorFrontmatterValue> = {};
  for (const [name, property] of Object.entries(page.properties ?? {})) {
    values[name] = propertyValue(property);
  }
  return values;
}

function pageTags(page: NotionPage): string[] {
  const tags: string[] = [];
  for (const [name, property] of Object.entries(page.properties ?? {})) {
    if (!/(^|[\s_-])tags?($|[\s_-])/i.test(name)) continue;
    const value = propertyValue(property);
    if (Array.isArray(value)) tags.push(...value);
    else if (typeof value === 'string' && value.trim()) tags.push(...value.split(/[,\s]+/));
  }
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function parentLabel(parent: Record<string, unknown> | undefined): string {
  const type = stringValue(parent?.type);
  switch (type) {
    case 'workspace':
      return 'Workspace';
    case 'page_id':
      return 'Page';
    case 'data_source_id':
      return 'Data source';
    case 'database_id':
      return 'Database';
    case 'block_id':
      return 'Block';
    default:
      return 'Notion';
  }
}

function propertyExcerpt(page: NotionPage): string {
  const parts: string[] = [];
  for (const [name, property] of Object.entries(page.properties ?? {})) {
    if (asRecord(property).type === 'title') continue;
    const value = propertyValue(property);
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    parts.push(`${name}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
    if (parts.length >= 3) break;
  }
  return compact(parts.join(' · ')).slice(0, 240) || 'Notion page';
}

function summaryForPage(page: NotionPage, folderOverride?: string): ConnectorNoteSummary {
  return {
    path: page.id,
    title: pageTitle(page),
    folder: folderOverride ?? parentLabel(page.parent),
    excerpt: propertyExcerpt(page),
    tags: pageTags(page),
    updatedAt: isoFromUnknown(page.last_edited_time ?? page.created_time),
    sizeBytes: Buffer.byteLength(JSON.stringify(page.properties ?? {}), 'utf8'),
  };
}

function renderRichText(raw: unknown): string {
  return asArray(raw)
    .map((item) => {
      const value = asRecord(item);
      let text = stringValue(value.plain_text);
      if (!text && value.type === 'text') {
        text = stringValue(asRecord(value.text).content);
      }
      const annotations = asRecord(value.annotations);
      if (annotations.code === true && text) text = `\`${text.replace(/`/g, '\\`')}\``;
      if (annotations.bold === true && text) text = `**${text}**`;
      if (annotations.italic === true && text) text = `_${text}_`;
      if (annotations.strikethrough === true && text) text = `~~${text}~~`;
      const href = stringValue(value.href);
      if (href && /^https?:\/\//i.test(href)) text = `[${text || href}](${href})`;
      return text;
    })
    .join('');
}

function fileUrl(data: Record<string, unknown>): string {
  const file = asRecord(data.file);
  const external = asRecord(data.external);
  return stringValue(file.url) || stringValue(external.url);
}

function childMarkdown(children: LoadedBlock[], depth: number): string {
  return children
    .map((child) => renderBlock(child, depth))
    .filter(Boolean)
    .join('\n\n');
}

function renderBlock(item: LoadedBlock, depth: number): string {
  const block = item.block;
  const type = stringValue(block.type) || 'paragraph';
  const data = asRecord(block[type]);
  const richTextValue =
    type === 'table_row' ? '' : renderRichText(data.rich_text ?? data.text ?? []);
  const children = childMarkdown(item.children, depth + 1);
  const indent = '  '.repeat(Math.max(depth, 0));
  const withChildren = (base: string, separator = '\n\n'): string =>
    children ? `${base}${separator}${children}` : base;

  switch (type) {
    case 'paragraph':
      return withChildren(`${indent}${richTextValue}`);
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'heading_4': {
      const level = Number(type.slice(-1)) || 1;
      return withChildren(`${'#'.repeat(level)} ${richTextValue}`);
    }
    case 'bulleted_list_item':
      return `${indent}- ${richTextValue}${children ? `\n${children}` : ''}`;
    case 'numbered_list_item':
      return `${indent}1. ${richTextValue}${children ? `\n${children}` : ''}`;
    case 'to_do':
      return `${indent}- [${data.checked === true ? 'x' : ' '}] ${richTextValue}${
        children ? `\n${children}` : ''
      }`;
    case 'toggle':
      return `<details><summary>${richTextValue}</summary>\n\n${children}\n\n</details>`;
    case 'quote':
      return withChildren(`> ${richTextValue.replace(/\n/g, '\n> ')}`);
    case 'callout':
      return withChildren(`> [!NOTE]\n> ${richTextValue.replace(/\n/g, '\n> ')}`);
    case 'code': {
      const language = stringValue(data.language) || 'text';
      return `\`\`\`${language}\n${richTextPlain(data.rich_text)}\n\`\`\``;
    }
    case 'divider':
      return '---';
    case 'image': {
      const url = fileUrl(data);
      const caption = richTextPlain(data.caption);
      return url ? `![${caption || 'Image'}](${url})` : '';
    }
    case 'file':
    case 'pdf':
    case 'video':
    case 'audio': {
      const url = fileUrl(data);
      const caption = richTextPlain(data.caption);
      return url ? `[${caption || type}](${url})` : '';
    }
    case 'bookmark':
    case 'embed':
    case 'link_preview': {
      const url = stringValue(data.url);
      const caption = richTextPlain(data.caption);
      return url ? `[${caption || url}](${url})` : '';
    }
    case 'child_page':
      return `${indent}- Child page: ${stringValue(data.title) || 'Untitled'} (${block.id})`;
    case 'child_database':
      return `${indent}- Database: ${stringValue(data.title) || 'Untitled'} (${block.id})`;
    case 'link_to_page': {
      const target =
        stringValue(data.page_id) ||
        stringValue(data.database_id) ||
        stringValue(data.data_source_id) ||
        stringValue(data.block_id);
      return target ? `${indent}- Linked page: ${target}` : '';
    }
    case 'equation':
      return `$$${stringValue(data.expression)}$$`;
    case 'table':
      return children;
    case 'table_row': {
      const cells = asArray(data.cells).map((cell) => renderRichText(cell));
      return `| ${cells.join(' | ')} |`;
    }
    case 'column_list':
    case 'column':
    case 'synced_block':
      return children;
    default:
      return withChildren(`${indent}${richTextValue}`.trim());
  }
}

class NotionClient {
  private readonly http: ConnectorHttpClient;

  constructor(runtime: ConnectorRuntime) {
    const apiKey = (runtime.secrets.apiKey ?? runtime.config.apiKey ?? '').trim();
    if (!apiKey) {
      throw new HttpError(
        401,
        'CONNECTOR_AUTH_FAILED',
        'Notion has no integration token.',
        'Reconnect Notion in Connections and provide a valid integration token.',
      );
    }

    this.http = new ConnectorHttpClient({
      baseUrl: NOTION_BASE,
      label: 'Notion',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
      },
      minIntervalMs: 350,
      maxRateLimitRetries: 2,
      authHint:
        'Check the integration token in Connections. If the token was revoked, create a new internal integration in Notion.',
    });
  }

  async get<T>(path: string): Promise<T> {
    return this.http.request<T>({ path, retryOnServerError: true });
  }

  async post<T>(path: string, body: unknown, retry = false): Promise<T> {
    return this.http.request<T>({
      path,
      method: 'POST',
      body,
      retryOnServerError: retry,
    });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.http.request<T>({ path, method: 'PATCH', body });
  }

  async page(pageId: string): Promise<NotionPage> {
    const page = await this.get<NotionPage>(`/v1/pages/${encodeURIComponent(pageId)}`);
    if (!page || page.object !== 'page') {
      throw new HttpError(404, 'CONNECTOR_RESOURCE_NOT_FOUND', 'That Notion page is not accessible.');
    }
    return page;
  }

  async dataSource(dataSourceId: string): Promise<DataSource> {
    const dataSource = await this.get<DataSource>(
      `/v1/data_sources/${encodeURIComponent(dataSourceId)}`,
    );
    if (!dataSource || !dataSource.id) {
      throw new HttpError(
        404,
        'CONNECTOR_RESOURCE_NOT_FOUND',
        'That Notion data source is not accessible.',
      );
    }
    return dataSource;
  }

  async children(
    blockId: string,
    cursor?: string,
  ): Promise<{
    results: NotionBlock[];
    has_more: boolean;
    next_cursor: string | null;
  }> {
    return this.get(
      `/v1/blocks/${encodeURIComponent(blockId)}/children?page_size=100${
        cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''
      }`,
    );
  }
}

async function loadBlocks(
  client: NotionClient,
  parentId: string,
  state: BlockState,
  depth = 0,
): Promise<LoadedBlock[]> {
  if (depth > MAX_BLOCK_DEPTH || state.count >= MAX_BLOCKS) {
    state.truncated = true;
    return [];
  }

  const rawBlocks: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    if (state.requests >= MAX_BLOCK_REQUESTS) {
      state.truncated = true;
      break;
    }
    state.requests += 1;
    const page = await client.children(parentId, cursor);
    rawBlocks.push(...asArray(page.results).map((block) => asRecord(block) as NotionBlock));
    cursor =
      page.has_more && typeof page.next_cursor === 'string' ? page.next_cursor : undefined;
    if (page.has_more && !cursor) break;
  } while (cursor);

  const loaded: LoadedBlock[] = [];
  for (const block of rawBlocks) {
    if (state.count >= MAX_BLOCKS) {
      state.truncated = true;
      break;
    }
    state.count += 1;
    const entry: LoadedBlock = { block, children: [] };
    if (block.has_children === true) {
      entry.children = await loadBlocks(client, block.id, state, depth + 1);
    }
    loaded.push(entry);
  }
  return loaded;
}

function renderBlocks(blocks: LoadedBlock[]): string {
  return blocks
    .map((block) => renderBlock(block, 0))
    .filter(Boolean)
    .join('\n\n');
}

function readPageContent(page: NotionPage, blocks: LoadedBlock[], truncated: boolean): ConnectorNote {
  const full = `${renderBlocks(blocks)}`;
  const clipped = truncateText(full, MAX_CONTENT);
  const content = clipped.text;
  return {
    path: page.id,
    title: pageTitle(page),
    folder: parentLabel(page.parent),
    excerpt: compact(content).slice(0, 240) || propertyExcerpt(page),
    tags: pageTags(page),
    content,
    truncated: truncated || clipped.truncated,
    updatedAt: isoFromUnknown(page.last_edited_time ?? page.created_time),
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    frontmatter: { raw: '', values: propertyValues(page) },
    links: [],
  };
}

function findTitleProperty(
  properties: Record<string, unknown> | undefined,
): { key: string; schema: Record<string, unknown> } | null {
  for (const [key, value] of Object.entries(properties ?? {})) {
    const schema = asRecord(value);
    if (schema.type === 'title') return { key, schema };
  }
  return null;
}

function dataSourceTitle(dataSource: DataSource): string {
  const fromTitle = richTextPlain(dataSource.title);
  if (fromTitle.trim()) return fromTitle.trim();
  const titleProperty = findTitleProperty(dataSource.properties);
  return titleProperty ? titleProperty.key : 'Data source';
}

function schemaType(schema: Record<string, unknown> | undefined): string {
  return stringValue(schema?.type);
}

function schemaProperty(
  properties: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const direct = properties?.[key];
  if (direct) return asRecord(direct);
  for (const [name, value] of Object.entries(properties ?? {})) {
    if (name.toLowerCase() === key.toLowerCase()) return asRecord(value);
  }
  return undefined;
}

function asStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw invalid(`${label} must be an array of strings.`);
  return value.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw invalid(`${label} must contain only non-empty strings.`);
    }
    return entry;
  });
}

function notionPropertyInput(
  key: string,
  value: unknown,
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const type = schemaType(schema);
  if (!type) {
    if (key === 'title' && typeof value === 'string') {
      return { title: richText(value) };
    }
    throw invalid(`Notion property "${key}" does not exist on this data source.`);
  }

  if (type === 'title' || type === 'rich_text') {
    if (typeof value !== 'string') throw invalid(`Property "${key}" must be a string.`);
    return { [type]: richText(value) };
  }
  if (type === 'number') {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw invalid(`Property "${key}" must be a number or null.`);
    }
    return { number: value };
  }
  if (type === 'select' || type === 'status') {
    if (value === null) return { [type]: null };
    if (typeof value !== 'string' || !value.trim()) {
      throw invalid(`Property "${key}" must be a non-empty string or null.`);
    }
    return { [type]: { name: value } };
  }
  if (type === 'multi_select') {
    if (!Array.isArray(value)) throw invalid(`Property "${key}" must be an array of strings.`);
    return {
      multi_select: asStringList(value, `Property "${key}"`).map((name) => ({ name })),
    };
  }
  if (type === 'checkbox') {
    if (typeof value !== 'boolean') throw invalid(`Property "${key}" must be true or false.`);
    return { checkbox: value };
  }
  if (type === 'url' || type === 'email' || type === 'phone_number') {
    if (value !== null && typeof value !== 'string') {
      throw invalid(`Property "${key}" must be a string or null.`);
    }
    return { [type]: value };
  }
  if (type === 'date') {
    if (value === null) return { date: null };
    if (typeof value !== 'string' || !value.trim()) {
      throw invalid(`Property "${key}" must be an ISO date string or null.`);
    }
    return { date: { start: value } };
  }
  if (type === 'relation' || type === 'people') {
    if (!Array.isArray(value)) throw invalid(`Property "${key}" must be an array of IDs.`);
    return { [type]: asStringList(value, `Property "${key}"`).map((id) => ({ id })) };
  }
  if (
    type === 'formula' ||
    type === 'rollup' ||
    type === 'created_time' ||
    type === 'created_by' ||
    type === 'last_edited_time' ||
    type === 'last_edited_by' ||
    type === 'unique_id' ||
    type === 'verification'
  ) {
    throw invalid(`Notion property "${key}" is read-only (${type}).`);
  }
  throw invalid(`Notion property type "${type}" is not supported for writes.`);
}

function parsePropertiesJson(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'string') throw invalid('Properties must be a JSON string.');
  if (raw.length > 20_000) throw invalid('Properties JSON must be 20,000 characters or fewer.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw invalid('Properties must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid('Properties must be a JSON object.');
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 50) throw invalid('At most 50 properties can be changed at once.');
  for (const [key, value] of entries) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      continue;
    }
    if (value === null) continue;
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) continue;
    throw invalid(
      `Property "${key}" must be a string, number, boolean, array of strings or null.`,
    );
  }
  return parsed as Record<string, unknown>;
}

function buildProperties(
  schema: Record<string, unknown> | undefined,
  title: string | null,
  rawProperties: Record<string, unknown>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const titlePropertyKey = findTitleProperty(schema)?.key ?? 'title';
  const propertiesSchema = asRecord(schema?.properties);

  if (schema && !findTitleProperty(schema)) {
    throw invalid('That Notion data source has no title property.');
  }

  for (const [key, value] of Object.entries(rawProperties)) {
    const propertySchema = schemaProperty(propertiesSchema, key);
    properties[key] = notionPropertyInput(key, value, propertySchema);
  }

  if (title !== null) {
    properties[titlePropertyKey] = notionPropertyInput(
      titlePropertyKey,
      title,
      schemaProperty(propertiesSchema, titlePropertyKey),
    );
  }
  return properties;
}

function textBlock(type: string, text: string, payload: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'block',
    type,
    [type]: {
      rich_text: richText(text),
      ...payload,
    },
  };
}

function markdownToBlocks(markdown: string): Record<string, unknown>[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Record<string, unknown>[] = [];
  let index = 0;

  const startsBlock = (line: string): boolean =>
    /^\s*(#{1,3})\s+/.test(line) ||
    /^\s*```/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*---+\s*$/.test(line);

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const language = line.trim().replace(/^```/, '').trim() || 'text';
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(textBlock('code', code.join('\n'), { language }));
      continue;
    }

    const heading = /^\s*(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      blocks.push(textBlock(`heading_${level}`, heading[2] ?? ''));
      index += 1;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      index += 1;
      continue;
    }

    const todo = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (todo) {
      blocks.push(textBlock('to_do', todo[2] ?? '', { checked: todo[1]?.toLowerCase() === 'x' }));
      index += 1;
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push(textBlock('bulleted_list_item', bullet[1] ?? ''));
      index += 1;
      continue;
    }

    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push(textBlock('numbered_list_item', numbered[1] ?? ''));
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(textBlock('quote', quote.join('\n')));
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      (paragraph.length === 0 || !startsBlock(lines[index] ?? ''))
    ) {
      paragraph.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push(textBlock('paragraph', paragraph.join('\n')));
  }

  return blocks;
}

async function searchPages(
  client: NotionClient,
  query: string,
  requestedLimit: number,
): Promise<ConnectorOperationResult> {
  const limit = Math.min(Math.max(Math.trunc(requestedLimit) || 10, 1), 50);
  const notes: ConnectorNoteSummary[] = [];
  let cursor: string | undefined;
  let hasMore = false;

  for (let page = 0; page < 3 && notes.length < limit; page += 1) {
    const body: Record<string, unknown> = {
      filter: { property: 'object', value: 'page' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: Math.min(100, limit - notes.length),
    };
    if (query.trim()) body.query = query.trim();
    if (cursor) body.start_cursor = cursor;

    const response = await client.post<{
      results?: unknown[];
      has_more?: boolean;
      next_cursor?: string | null;
    }>('/v1/search', body, true);

    for (const result of asArray(response.results)) {
      const pageResult = asRecord(result) as unknown as NotionPage;
      if (pageResult.object !== 'page') continue;
      notes.push(summaryForPage(pageResult));
      if (notes.length >= limit) break;
    }

    hasMore = response.has_more === true;
    cursor = typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
    if (!hasMore || !cursor) break;
  }

  return {
    type: 'search',
    notes: notes.slice(0, limit),
    total: notes.length + (hasMore ? 1 : 0),
    truncated: hasMore,
  };
}

async function queryDataSource(
  client: NotionClient,
  rawId: string,
  requestedLimit: number,
): Promise<ConnectorOperationResult> {
  const dataSourceId = notionId(rawId, 'data source');
  const dataSource = await client.dataSource(dataSourceId);
  const folder = dataSourceTitle(dataSource);
  const limit = Math.min(Math.max(Math.trunc(requestedLimit) || 10, 1), 50);
  const notes: ConnectorNoteSummary[] = [];
  let cursor: string | undefined;
  let hasMore = false;

  for (let page = 0; page < 3 && notes.length < limit; page += 1) {
    const body: Record<string, unknown> = {
      page_size: Math.min(100, limit - notes.length),
    };
    if (cursor) body.start_cursor = cursor;

    const response = await client.post<{
      results?: unknown[];
      has_more?: boolean;
      next_cursor?: string | null;
    }>(`/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, body, true);

    for (const result of asArray(response.results)) {
      const entry = asRecord(result) as unknown as NotionPage;
      if (entry.object !== 'page') continue;
      notes.push(summaryForPage(entry, folder));
      if (notes.length >= limit) break;
    }

    hasMore = response.has_more === true;
    cursor = typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
    if (!hasMore || !cursor) break;
  }

  return {
    type: 'search',
    notes: notes.slice(0, limit),
    total: notes.length + (hasMore ? 1 : 0),
    truncated: hasMore,
  };
}

async function readPage(client: NotionClient, rawPath: string): Promise<ConnectorOperationResult> {
  const pageId = notionId(rawPath, 'page');
  const page = await client.page(pageId);
  const state: BlockState = { count: 0, requests: 0, truncated: false };
  const blocks = await loadBlocks(client, page.id, state);
  return { type: 'read', note: readPageContent(page, blocks, state.truncated) };
}

async function createPage(
  client: NotionClient,
  args: Record<string, unknown>,
): Promise<ConnectorOperationResult> {
  const parentId = notionId(
    typeof args.parentId === 'string' ? args.parentId : '',
    'parent',
  );
  const parentType = args.parentType;
  if (parentType !== 'page' && parentType !== 'data-source') {
    throw invalid('parentType must be page or data-source.');
  }
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) throw invalid('A page title is required.');
  if (title.length > 200) throw invalid('The page title must be 200 characters or fewer.');
  const content = typeof args.content === 'string' ? args.content : '';
  if (content.length > MAX_CONTENT) {
    throw invalid(`Content must be ${MAX_CONTENT} characters or fewer.`);
  }

  let schema: Record<string, unknown> | undefined;
  if (parentType === 'data-source') {
    schema = (await client.dataSource(parentId)) as unknown as Record<string, unknown>;
  }
  const rawProperties = parsePropertiesJson(args.properties);
  if (parentType === 'page' && Object.keys(rawProperties).length > 0) {
    throw invalid(
      'Page children only support a title. Use a data-source parent to set other properties.',
    );
  }

  const properties = buildProperties(schema, title, rawProperties);
  const body: Record<string, unknown> = {
    parent:
      parentType === 'page'
        ? { page_id: parentId }
        : { data_source_id: parentId },
    properties,
  };
  if (content) {
    body.markdown = content;
    body.markdown_version = 'v2';
  }

  const page = await client.post<NotionPage>('/v1/pages', body);
  if (!page || page.object !== 'page') {
    throw new HttpError(
      502,
      'CONNECTOR_OPERATION_FAILED',
      'Notion did not return the created page.',
    );
  }
  return { type: 'write', note: summaryForPage(page), created: true };
}

async function appendToPage(
  client: NotionClient,
  args: Record<string, unknown>,
): Promise<ConnectorOperationResult> {
  const pageId = notionId(typeof args.path === 'string' ? args.path : '', 'page');
  const content = typeof args.content === 'string' ? args.content : '';
  if (!content.trim()) throw invalid('Content is required.');
  if (content.length > MAX_CONTENT) {
    throw invalid(`Content must be ${MAX_CONTENT} characters or fewer.`);
  }

  const page = await client.page(pageId);
  const children = markdownToBlocks(content);
  if (children.length === 0) throw invalid('Content did not contain any appendable blocks.');
  if (children.length > MAX_APPEND_BLOCKS) {
    throw invalid(
      `This append creates ${children.length} blocks. Notion accepts at most ${MAX_APPEND_BLOCKS} per call; split the content.`,
    );
  }

  await client.patch(`/v1/blocks/${encodeURIComponent(page.id)}/children`, { children });
  return { type: 'write', note: summaryForPage(page), created: false };
}

async function updatePage(
  client: NotionClient,
  args: Record<string, unknown>,
): Promise<ConnectorOperationResult> {
  const pageId = notionId(typeof args.path === 'string' ? args.path : '', 'page');
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  const rawProperties = parsePropertiesJson(args.properties);
  if (!title && Object.keys(rawProperties).length === 0) {
    throw invalid('Provide a title or at least one property to update.');
  }
  if (title.length > 200) throw invalid('The page title must be 200 characters or fewer.');

  const page = await client.page(pageId);
  let schema: Record<string, unknown> | undefined;
  const parent = asRecord(page.parent);
  const dataSourceId = stringValue(parent.data_source_id);
  if (dataSourceId) {
    schema = (await client.dataSource(dataSourceId)) as unknown as Record<string, unknown>;
  }

  if (!dataSourceId && Object.keys(rawProperties).length > 0) {
    throw invalid(
      'This page is not inside a data source, so only its title can be updated through Notion.',
    );
  }

  const properties = buildProperties(schema, title || null, rawProperties);

  const updated = await client.patch<NotionPage>(
    `/v1/pages/${encodeURIComponent(page.id)}`,
    { properties },
  );
  return {
    type: 'write',
    note: summaryForPage(updated?.id ? updated : page),
    created: false,
  };
}

async function openPage(
  client: NotionClient,
  rawPath: string,
): Promise<ConnectorOperationResult> {
  const page = await client.page(notionId(rawPath, 'page'));
  if (!page.url) {
    throw new HttpError(
      502,
      'CONNECTOR_OPERATION_FAILED',
      'Notion did not return a URL for that page.',
    );
  }
  return { type: 'open', path: page.id, url: page.url };
}

function testClient(runtime: ConnectorRuntime): NotionClient {
  return new NotionClient(runtime);
}

async function testNotion(runtime: ConnectorRuntime): Promise<ConnectorHealth> {
  try {
    const client = testClient(runtime);
    const user = await client.get<Record<string, unknown>>('/v1/users/me');
    const bot = asRecord(user.bot);
    const workspace =
      stringValue(bot.workspace_name) ||
      stringValue(user.workspace_name) ||
      stringValue(user.name) ||
      'the connected workspace';
    return {
      ok: true,
      detail: `Notion API reachable for ${workspace}. Only resources shared with this integration are visible.`,
      metadata: {
        workspace,
        apiVersion: NOTION_VERSION,
      },
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof HttpError
          ? `${error.message}${error.hint ? ` ${error.hint}` : ''}`
          : 'Notion could not be reached from the local node.',
    };
  }
}

export const notionConnector: ConnectorAdapter = {
  descriptor: DESCRIPTOR,

  prepareConfig(input) {
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (!apiKey) {
      throw new HttpError(
        400,
        'CONNECTOR_CONFIG_INVALID',
        'A Notion integration token is required.',
        'Create an internal integration in Notion and share the pages or databases it should access.',
      );
    }
    if (apiKey.length < 20 || apiKey.length > 500 || /\s/.test(apiKey)) {
      throw new HttpError(
        400,
        'CONNECTOR_CONFIG_INVALID',
        'That does not look like a Notion integration token.',
      );
    }

    return {
      config: { apiVersion: NOTION_VERSION },
      secrets: { apiKey },
    };
  },

  test: testNotion,

  requiresConfirmation(operationId) {
    return operationId === 'update';
  },

  async execute(operationId, args, runtime) {
    const client = new NotionClient(runtime);

    switch (operationId) {
      case 'search':
        return searchPages(
          client,
          typeof args.query === 'string' ? args.query : '',
          typeof args.limit === 'number' ? args.limit : 10,
        );
      case 'read':
        return readPage(client, typeof args.path === 'string' ? args.path : '');
      case 'query-data-source':
        return queryDataSource(
          client,
          typeof args.dataSourceId === 'string' ? args.dataSourceId : '',
          typeof args.limit === 'number' ? args.limit : 10,
        );
      case 'create':
        return createPage(client, args);
      case 'append':
        return appendToPage(client, args);
      case 'update':
        return updatePage(client, args);
      case 'open':
        return openPage(client, typeof args.path === 'string' ? args.path : '');
      default:
        throw new HttpError(
          404,
          'CONNECTOR_TOOL_NOT_FOUND',
          'That operation is not registered for Notion.',
        );
    }
  },

  async disconnect() {
    // The integration token is deleted with the local connection. Revoking it
    // itself remains a Notion-side action.
  },
};

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
  normalizeLoopbackBase,
  truncateText,
} from './http';
import type { ConnectorAdapter, ConnectorHealth, ConnectorRuntime } from './types';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:31009';
const ANYTYPE_VERSION = '2025-11-08';
const MAX_CONTENT = 200_000;
const MAX_PROPERTIES = 50;

const OPERATIONS: ConnectorOperationDefinition[] = [
  {
    id: 'search',
    capability: 'search',
    label: 'Search Anytype objects',
    description:
      'Search object names and snippets in the selected Anytype space, newest modified first. File-layout objects are excluded by the local API.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'query',
        type: 'string',
        description: 'Object name or snippet text to find. Leave empty for recent objects.',
        required: false,
        maxLength: 200,
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum objects to return, from 1 to 50.',
        required: false,
        minimum: 1,
        maximum: 50,
      },
    ],
  },
  {
    id: 'read',
    capability: 'read',
    label: 'Read Anytype object',
    description:
      'Read one object as Markdown with its properties and relevant metadata. The local API is asked for the Markdown body explicitly.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Object ID, optionally prefixed with its space ID and a slash.',
        required: true,
        maxLength: 500,
      },
    ],
  },
  {
    id: 'create',
    capability: 'create',
    label: 'Create Anytype object',
    description:
      'Create an object in the selected space. The body is Markdown. Supports simple typed properties from the object type; accepts optional properties JSON.',
    permission: 'create',
    destructive: false,
    arguments: [
      {
        name: 'title',
        type: 'string',
        description: 'Object name.',
        required: true,
        maxLength: 200,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Initial Markdown body. May be empty.',
        required: false,
        maxLength: MAX_CONTENT,
      },
      {
        name: 'typeKey',
        type: 'string',
        description: 'Anytype type key. Defaults to the key saved with the connection.',
        required: false,
        maxLength: 100,
      },
      {
        name: 'properties',
        type: 'string',
        description:
          'Optional JSON object of simple property values, for example {"Status":"In progress"}.',
        required: false,
        maxLength: 20_000,
      },
    ],
  },
  {
    id: 'update',
    capability: 'update',
    label: 'Update Anytype object',
    description:
      'Update the name, Markdown body and/or supported properties of an existing object. Always requires confirmation; content is not silently replaced by another operation.',
    permission: 'edit',
    destructive: true,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Object ID, optionally prefixed with its space ID and a slash.',
        required: true,
        maxLength: 500,
      },
      {
        name: 'name',
        type: 'string',
        description: 'Optional replacement object name.',
        required: false,
        maxLength: 200,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Optional replacement Markdown body.',
        required: false,
        maxLength: MAX_CONTENT,
      },
      {
        name: 'properties',
        type: 'string',
        description:
          'Optional JSON object of simple property values. Only properties defined by the object type can be changed.',
        required: false,
        maxLength: 20_000,
      },
    ],
  },
];

const DESCRIPTOR: ConnectorDescriptor = {
  id: 'anytype',
  name: 'Anytype',
  vendor: 'Any',
  description:
    'Search, read, create and update objects in one Anytype space through the local API. The API key and object data stay on this computer.',
  availability: 'available',
  availabilityDetail:
    'Anytype local API v1 (2025-11-08). Requires Anytype desktop with the local API enabled. Live verification requires a running space.',
  auth: {
    method: 'local-api',
    label: 'Anytype local API key',
    description:
      'Create an API key in Anytype → Settings → API Keys, keep Anytype running, and choose the space this connection may use. The key is stored server-side only.',
    fields: [
      {
        key: 'endpoint',
        label: 'Local API address',
        type: 'url',
        required: false,
        defaultValue: DEFAULT_ENDPOINT,
        placeholder: DEFAULT_ENDPOINT,
        help: 'Loopback only. Anytype normally uses port 31009.',
      },
      {
        key: 'apiKey',
        label: 'API key',
        type: 'secret',
        required: true,
        placeholder: 'Anytype API key',
        help: 'The key is sent as a bearer token only to the loopback API.',
      },
      {
        key: 'spaceId',
        label: 'Space ID',
        type: 'text',
        required: false,
        placeholder: 'bafyrei…',
        help: 'Optional when exactly one space is accessible. If several spaces exist, connect reports their IDs and asks for one.',
      },
      {
        key: 'typeKey',
        label: 'Default object type',
        type: 'text',
        required: false,
        defaultValue: 'page',
        placeholder: 'page',
        help: 'Type used when create does not specify one, for example page or note.',
      },
    ],
  },
  capabilities: ['search', 'read', 'create', 'update'],
  permissions: ['read', 'create', 'edit'],
  operations: OPERATIONS,
};

interface AnytypeSpace {
  id: string;
  name?: string;
  object?: string;
}

interface AnytypeType {
  key?: string;
  name?: string;
}

interface AnytypeProperty {
  key?: string;
  name?: string;
  format?: string;
  text?: unknown;
  number?: unknown;
  select?: unknown;
  multi_select?: unknown;
  date?: unknown;
  checkbox?: unknown;
  url?: unknown;
  email?: unknown;
  phone?: unknown;
  objects?: unknown;
  files?: unknown;
}

interface AnytypeObject {
  id: string;
  name?: string;
  snippet?: string;
  space_id?: string;
  type?: AnytypeType;
  layout?: string;
  properties?: AnytypeProperty[];
  markdown?: string;
  body?: string;
  archived?: boolean;
  object?: string;
}

interface SpaceRef {
  id: string;
  name?: string;
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

function propertyValue(property: AnytypeProperty): ConnectorFrontmatterValue {
  const format = stringValue(property.format);
  switch (format) {
    case 'text':
      return stringValue(property.text);
    case 'number':
      return typeof property.number === 'number' ? property.number : null;
    case 'select': {
      const selected = asRecord(property.select);
      return stringValue(selected.name) || stringValue(property.select) || null;
    }
    case 'multi_select':
      return asArray(property.multi_select)
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          const record = asRecord(entry);
          return stringValue(record.name) || stringValue(record.key);
        })
        .filter(Boolean);
    case 'date':
      return stringValue(property.date) || null;
    case 'checkbox':
      return property.checkbox === true;
    case 'url':
      return stringValue(property.url) || null;
    case 'email':
      return stringValue(property.email) || null;
    case 'phone':
      return stringValue(property.phone) || null;
    case 'objects':
    case 'files':
      return asArray(property[format])
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          const record = asRecord(entry);
          return stringValue(record.name) || stringValue(record.id);
        })
        .filter(Boolean);
    default:
      return null;
  }
}

function propertyValues(properties: AnytypeProperty[]): Record<string, ConnectorFrontmatterValue> {
  const values: Record<string, ConnectorFrontmatterValue> = {};
  for (const property of properties) {
    const key = stringValue(property.key);
    if (!key) continue;
    const value = propertyValue(property);
    if (value !== null) values[key] = value;
  }
  return values;
}

function tagsFromProperties(properties: AnytypeProperty[]): string[] {
  const tags: string[] = [];
  for (const property of properties) {
    const name = `${property.key ?? ''} ${property.name ?? ''}`;
    if (!/tags?/i.test(name)) continue;
    const value = propertyValue(property);
    if (Array.isArray(value)) tags.push(...value);
    else if (typeof value === 'string' && value.trim()) tags.push(...value.split(/[,\s]+/));
  }
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function objectTitle(object: AnytypeObject): string {
  const name = stringValue(object.name).trim();
  if (name) return name;
  const content = stringValue(object.markdown ?? object.body);
  const firstLine = content.split(/\r?\n/).find((line) => line.trim());
  return compact(firstLine ?? '').slice(0, 120) || 'Untitled Anytype object';
}

function propertyExcerpt(properties: AnytypeProperty[]): string {
  const parts: string[] = [];
  for (const property of properties) {
    const value = propertyValue(property);
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    parts.push(
      `${stringValue(property.name) || stringValue(property.key)}: ${
        Array.isArray(value) ? value.join(', ') : String(value)
      }`,
    );
    if (parts.length >= 3) break;
  }
  return compact(parts.join(' · ')).slice(0, 240);
}

function dateProperty(properties: AnytypeProperty[], key: string): string | null {
  const property = properties.find(
    (entry) => stringValue(entry.key).toLowerCase() === key && stringValue(entry.format) === 'date',
  );
  return property ? stringValue(property.date) || null : null;
}

function objectUpdatedAt(object: AnytypeObject): string {
  const properties = asArray(object.properties).map((entry) => asRecord(entry) as AnytypeProperty);
  return isoFromUnknown(
    dateProperty(properties, 'last_modified_date') ??
      dateProperty(properties, 'created_date'),
  );
}

function objectPath(raw: unknown, fallbackSpace: string): { spaceId: string; objectId: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw invalid('An Anytype object ID is required.');
  }
  const value = raw.trim();
  if (value.length > 500 || /\s/.test(value)) {
    throw invalid('That is not a valid Anytype object reference.');
  }

  const separator = value.indexOf('/');
  if (separator > 0) {
    const spaceId = value.slice(0, separator).trim();
    const objectId = value.slice(separator + 1).trim();
    if (!spaceId || !objectId) throw invalid('The Anytype object reference is incomplete.');
    return { spaceId, objectId };
  }
  return { spaceId: fallbackSpace, objectId: value };
}

function summaryForObject(object: AnytypeObject, space: SpaceRef): ConnectorNoteSummary {
  const properties = asArray(object.properties).map((entry) => asRecord(entry) as AnytypeProperty);
  return {
    path: `${space.id}/${object.id}`,
    title: objectTitle(object),
    folder: stringValue(object.type?.name) || space.name || 'Anytype',
    excerpt: compact(stringValue(object.snippet)) || propertyExcerpt(properties) || 'Anytype object',
    tags: tagsFromProperties(properties),
    updatedAt: objectUpdatedAt(object),
    sizeBytes: Buffer.byteLength(stringValue(object.snippet), 'utf8'),
  };
}

class AnytypeClient {
  private readonly http: ConnectorHttpClient;

  constructor(runtime: ConnectorRuntime) {
    const apiKey = (runtime.secrets.apiKey ?? runtime.config.apiKey ?? '').trim();
    if (!apiKey) {
      throw new HttpError(
        401,
        'CONNECTOR_AUTH_FAILED',
        'Anytype has no local API key.',
        'Reconnect Anytype in Connections with a key created in Anytype Settings → API Keys.',
      );
    }
    const endpoint = normalizeLoopbackBase(
      runtime.config.endpoint,
      DEFAULT_ENDPOINT,
      'The Anytype address',
    );
    this.http = new ConnectorHttpClient({
      baseUrl: endpoint,
      label: 'Anytype',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Anytype-Version': ANYTYPE_VERSION,
      },
      minIntervalMs: 150,
      timeoutMs: 20_000,
      authHint:
        'Confirm the API key in Connections and check that Anytype desktop is running with its local API enabled.',
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

  async listSpaces(): Promise<AnytypeSpace[]> {
    const spaces: AnytypeSpace[] = [];
    let offset = 0;

    for (let page = 0; page < 3; page += 1) {
      const response = await this.get<Record<string, unknown>>(
        `/v1/spaces?offset=${offset}&limit=100`,
      );
      const data = asArray(response.data);
      for (const entry of data) {
        const space = asRecord(entry);
        if (typeof space.id === 'string' && space.id) {
          spaces.push({
            id: space.id,
            ...(typeof space.name === 'string' ? { name: space.name } : {}),
            ...(typeof space.object === 'string' ? { object: space.object } : {}),
          });
        }
      }
      const pagination = asRecord(response.pagination);
      if (pagination.has_more !== true) break;
      const next = typeof pagination.offset === 'number' ? pagination.offset : offset;
      const limit = typeof pagination.limit === 'number' ? pagination.limit : data.length;
      offset = next + limit;
      if (limit <= 0) break;
    }

    return spaces;
  }

  async space(spaceId: string): Promise<SpaceRef> {
    const response = await this.get<Record<string, unknown>>(
      `/v1/spaces/${encodeURIComponent(spaceId)}`,
    );
    const space = asRecord(response.space);
    const id = stringValue(space.id) || spaceId;
    return { id, ...(typeof space.name === 'string' ? { name: space.name } : {}) };
  }

  async resolveSpace(configured: string | undefined): Promise<SpaceRef> {
    const requested = (configured ?? '').trim();
    if (requested) return this.space(requested);

    const spaces = await this.listSpaces();
    if (spaces.length === 0) {
      throw new HttpError(
        404,
        'CONNECTOR_RESOURCE_NOT_FOUND',
        'Anytype returned no accessible spaces for this API key.',
        'Create or open a space in Anytype, then reconnect.',
      );
    }
    if (spaces.length === 1) {
      const only = spaces[0];
      if (!only?.id) throw new HttpError(404, 'CONNECTOR_RESOURCE_NOT_FOUND', 'No space found.');
      return { id: only.id, ...(only.name ? { name: only.name } : {}) };
    }

    const choices = spaces
      .slice(0, 4)
      .map((space) => `${space.name ?? 'Untitled'} — ${space.id}`)
      .join('; ');
    throw new HttpError(
      409,
      'CONNECTOR_SPACE_REQUIRED',
      'Several Anytype spaces are accessible. Choose one by entering its space ID.',
      `Available spaces: ${choices}`,
    );
  }

  async listProperties(spaceId: string): Promise<AnytypeProperty[]> {
    const properties: AnytypeProperty[] = [];
    let offset = 0;

    for (let page = 0; page < 2; page += 1) {
      const response = await this.get<Record<string, unknown>>(
        `/v1/spaces/${encodeURIComponent(spaceId)}/properties?offset=${offset}&limit=100`,
      );
      for (const entry of asArray(response.data)) {
        const property = asRecord(entry);
        if (typeof property.key === 'string' && property.key) {
          properties.push(property as AnytypeProperty);
        }
      }
      const pagination = asRecord(response.pagination);
      if (pagination.has_more !== true) break;
      offset += typeof pagination.limit === 'number' ? pagination.limit : 100;
    }

    return properties;
  }

  async object(spaceId: string, objectId: string): Promise<AnytypeObject> {
    const response = await this.get<Record<string, unknown>>(
      `/v1/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(
        objectId,
      )}?format=md`,
    );
    const object = asRecord(response.object);
    if (!object.id) {
      throw new HttpError(
        404,
        'CONNECTOR_RESOURCE_NOT_FOUND',
        'That Anytype object is not accessible in the selected space.',
      );
    }
    return object as unknown as AnytypeObject;
  }
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
  if (entries.length > MAX_PROPERTIES) {
    throw invalid(`At most ${MAX_PROPERTIES} properties can be changed at once.`);
  }
  for (const [key, value] of entries) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      continue;
    }
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) continue;
    throw invalid(
      `Property "${key}" must be a string, number, boolean or array of strings.`,
    );
  }
  return parsed as Record<string, unknown>;
}

function propertyInput(
  key: string,
  value: unknown,
  schema: AnytypeProperty | undefined,
): Record<string, unknown> {
  if (!schema) throw invalid(`Anytype has no property with key or name "${key}".`);
  const format = stringValue(schema.format);

  if (format === 'text') {
    if (typeof value !== 'string') throw invalid(`Property "${key}" must be a string.`);
    return { key, text: value };
  }
  if (format === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw invalid(`Property "${key}" must be a number.`);
    }
    return { key, number: value };
  }
  if (format === 'select') {
    if (typeof value !== 'string' || !value.trim()) {
      throw invalid(`Property "${key}" must be a non-empty tag key.`);
    }
    return { key, select: value };
  }
  if (format === 'multi_select') {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
      throw invalid(`Property "${key}" must be an array of tag keys.`);
    }
    return { key, multi_select: value };
  }
  if (format === 'date') {
    if (typeof value !== 'string' || !value.trim()) {
      throw invalid(`Property "${key}" must be an RFC 3339 or date-only string.`);
    }
    return { key, date: value };
  }
  if (format === 'checkbox') {
    if (typeof value !== 'boolean') throw invalid(`Property "${key}" must be true or false.`);
    return { key, checkbox: value };
  }
  if (format === 'url' || format === 'email' || format === 'phone') {
    if (typeof value !== 'string') throw invalid(`Property "${key}" must be a string.`);
    return { key, [format]: value };
  }
  if (format === 'objects') {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
      throw invalid(`Property "${key}" must be an array of object IDs.`);
    }
    return { key, objects: value };
  }
  throw invalid(`Anytype property format "${format}" is not supported for writes.`);
}

function buildProperties(
  schemas: AnytypeProperty[],
  raw: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const [key, value] of Object.entries(raw)) {
    const schema = schemas.find(
      (entry) =>
        stringValue(entry.key).toLowerCase() === key.toLowerCase() ||
        stringValue(entry.name).toLowerCase() === key.toLowerCase(),
    );
    result.push(
      propertyInput(stringValue(schema?.key) || key, value, schema),
    );
  }
  return result;
}

async function searchObjects(
  client: AnytypeClient,
  runtime: ConnectorRuntime,
  query: string,
  requestedLimit: number,
): Promise<ConnectorOperationResult> {
  const space = await client.resolveSpace(runtime.config.spaceId);
  const limit = Math.min(Math.max(Math.trunc(requestedLimit) || 10, 1), 50);
  const body: Record<string, unknown> = {
    sort: { property_key: 'last_modified_date', direction: 'desc' },
  };
  if (query.trim()) body.query = query.trim();

  const response = await client.post<Record<string, unknown>>(
    `/v1/spaces/${encodeURIComponent(space.id)}/search?offset=0&limit=${limit}`,
    body,
    true,
  );
  const notes: ConnectorNoteSummary[] = [];
  for (const entry of asArray(response.data)) {
    const object = asRecord(entry) as unknown as AnytypeObject;
    if (!object.id || object.archived === true) continue;
    notes.push(summaryForObject(object, space));
    if (notes.length >= limit) break;
  }

  const pagination = asRecord(response.pagination);
  const total =
    typeof pagination.total === 'number' && Number.isFinite(pagination.total)
      ? pagination.total
      : notes.length;

  return {
    type: 'search',
    notes,
    total,
    truncated: pagination.has_more === true || total > notes.length,
  };
}

async function readObject(
  client: AnytypeClient,
  runtime: ConnectorRuntime,
  rawPath: string,
): Promise<ConnectorOperationResult> {
  const space = await client.resolveSpace(runtime.config.spaceId);
  const reference = objectPath(rawPath, space.id);
  if (reference.spaceId !== space.id) {
    throw invalid(
      'That object belongs to a different Anytype space.',
      'Only the space selected for this connection is accessible.',
    );
  }

  const object = await client.object(space.id, reference.objectId);
  const properties = asArray(object.properties).map(
    (entry) => asRecord(entry) as AnytypeProperty,
  );
  const full = stringValue(object.markdown ?? object.body);
  const clipped = truncateText(full, MAX_CONTENT);
  const values = propertyValues(properties);
  values.spaceId = space.id;
  values.objectId = object.id;
  values.type = stringValue(object.type?.name) || stringValue(object.type?.key) || 'Object';
  if (object.layout) values.layout = object.layout;

  const note: ConnectorNote = {
    path: `${space.id}/${object.id}`,
    title: objectTitle(object),
    folder: space.name || stringValue(object.type?.name) || 'Anytype',
    excerpt: compact(clipped.text).slice(0, 240) || propertyExcerpt(properties),
    tags: tagsFromProperties(properties),
    content: clipped.text,
    truncated: clipped.truncated,
    updatedAt: objectUpdatedAt(object),
    sizeBytes: Buffer.byteLength(clipped.text, 'utf8'),
    frontmatter: { raw: '', values },
    links: [],
  };

  return { type: 'read', note };
}

async function createObject(
  client: AnytypeClient,
  runtime: ConnectorRuntime,
  args: Record<string, unknown>,
): Promise<ConnectorOperationResult> {
  const space = await client.resolveSpace(runtime.config.spaceId);
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) throw invalid('An Anytype object name is required.');
  if (title.length > 200) throw invalid('The object name must be 200 characters or fewer.');
  const content = typeof args.content === 'string' ? args.content : '';
  if (content.length > MAX_CONTENT) {
    throw invalid(`Content must be ${MAX_CONTENT} characters or fewer.`);
  }

  const requestedType = typeof args.typeKey === 'string' ? args.typeKey.trim() : '';
  const typeKey = requestedType || (runtime.config.typeKey ?? 'page').trim() || 'page';
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(typeKey)) {
    throw invalid('The Anytype type key contains unsupported characters.');
  }

  const rawProperties = parsePropertiesJson(args.properties);
  const properties =
    Object.keys(rawProperties).length > 0
      ? buildProperties(await client.listProperties(space.id), rawProperties)
      : [];

  const body: Record<string, unknown> = { name: title, type_key: typeKey };
  if (content) body.body = content;
  if (properties.length > 0) body.properties = properties;

  const response = await client.post<Record<string, unknown>>(
    `/v1/spaces/${encodeURIComponent(space.id)}/objects`,
    body,
  );
  const object = asRecord(response.object) as unknown as AnytypeObject;
  if (!object.id) {
    throw new HttpError(
      502,
      'CONNECTOR_OPERATION_FAILED',
      'Anytype did not return the created object.',
    );
  }

  return { type: 'write', note: summaryForObject(object, space), created: true };
}

async function updateObject(
  client: AnytypeClient,
  runtime: ConnectorRuntime,
  args: Record<string, unknown>,
): Promise<ConnectorOperationResult> {
  const space = await client.resolveSpace(runtime.config.spaceId);
  const reference = objectPath(args.path, space.id);
  if (reference.spaceId !== space.id) {
    throw invalid(
      'That object belongs to a different Anytype space.',
      'Only the space selected for this connection is accessible.',
    );
  }

  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const content = typeof args.content === 'string' ? args.content : '';
  const rawProperties = parsePropertiesJson(args.properties);
  if (!name && args.content === undefined && Object.keys(rawProperties).length === 0) {
    throw invalid('Provide a name, content or at least one property to update.');
  }
  if (name.length > 200) throw invalid('The object name must be 200 characters or fewer.');
  if (content.length > MAX_CONTENT) {
    throw invalid(`Content must be ${MAX_CONTENT} characters or fewer.`);
  }

  const body: Record<string, unknown> = {};
  if (name) body.name = name;
  if (args.content !== undefined) body.markdown = content;
  if (Object.keys(rawProperties).length > 0) {
    body.properties = buildProperties(
      await client.listProperties(space.id),
      rawProperties,
    );
  }

  const response = await client.patch<Record<string, unknown>>(
    `/v1/spaces/${encodeURIComponent(space.id)}/objects/${encodeURIComponent(
      reference.objectId,
    )}`,
    body,
  );
  const object = asRecord(response.object) as unknown as AnytypeObject;
  if (!object.id) {
    throw new HttpError(
      502,
      'CONNECTOR_OPERATION_FAILED',
      'Anytype did not return the updated object.',
    );
  }

  return { type: 'write', note: summaryForObject(object, space), created: false };
}

async function testAnytype(runtime: ConnectorRuntime): Promise<ConnectorHealth> {
  try {
    const client = new AnytypeClient(runtime);
    const space = await client.resolveSpace(runtime.config.spaceId);
    return {
      ok: true,
      detail: `Anytype local API reachable for ${space.name ? `the "${space.name}" space` : `space ${space.id}`}.`,
      metadata: {
        space: space.name ?? space.id,
        apiVersion: ANYTYPE_VERSION,
      },
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof HttpError
          ? `${error.message}${error.hint ? ` ${error.hint}` : ''}`
          : 'The Anytype local API could not be reached.',
    };
  }
}

export const anytypeConnector: ConnectorAdapter = {
  descriptor: DESCRIPTOR,

  prepareConfig(input) {
    const endpoint = normalizeLoopbackBase(
      typeof input.endpoint === 'string' ? input.endpoint : undefined,
      DEFAULT_ENDPOINT,
      'The Anytype address',
    );
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (!apiKey) {
      throw new HttpError(
        400,
        'CONNECTOR_CONFIG_INVALID',
        'An Anytype API key is required.',
        'Create a key in Anytype Settings → API Keys, then paste it here.',
      );
    }
    if (apiKey.length > 500 || /\s/.test(apiKey)) {
      throw new HttpError(
        400,
        'CONNECTOR_CONFIG_INVALID',
        'That does not look like an Anytype API key.',
      );
    }

    const spaceId = typeof input.spaceId === 'string' ? input.spaceId.trim() : '';
    if (spaceId.length > 300 || /\s/.test(spaceId)) {
      throw new HttpError(
        400,
        'CONNECTOR_CONFIG_INVALID',
        'The Anytype space ID is not valid.',
      );
    }

    const typeKey = (typeof input.typeKey === 'string' ? input.typeKey.trim() : '') || 'page';
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(typeKey)) {
      throw new HttpError(
        400,
        'CONNECTOR_CONFIG_INVALID',
        'The default Anytype type key contains unsupported characters.',
      );
    }

    return {
      config: {
        endpoint,
        ...(spaceId ? { spaceId } : {}),
        typeKey,
      },
      secrets: { apiKey },
    };
  },

  test: testAnytype,

  requiresConfirmation(operationId) {
    return operationId === 'update';
  },

  async execute(operationId, args, runtime) {
    const client = new AnytypeClient(runtime);

    switch (operationId) {
      case 'search':
        return searchObjects(
          client,
          runtime,
          typeof args.query === 'string' ? args.query : '',
          typeof args.limit === 'number' ? args.limit : 10,
        );
      case 'read':
        return readObject(
          client,
          runtime,
          typeof args.path === 'string' ? args.path : '',
        );
      case 'create':
        return createObject(client, runtime, args);
      case 'update':
        return updateObject(client, runtime, args);
      default:
        throw new HttpError(
          404,
          'CONNECTOR_TOOL_NOT_FOUND',
          'That operation is not registered for Anytype.',
        );
    }
  },

  async disconnect() {
    // The API key is removed with the connection. Revocation is an Anytype-side action.
  },
};

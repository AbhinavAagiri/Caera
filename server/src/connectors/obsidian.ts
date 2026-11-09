import {
  accessSync,
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {
  ConnectorDescriptor,
  ConnectorDraftInput,
  ConnectorDraftPreview,
  ConnectorFrontmatter,
  ConnectorFrontmatterValue,
  ConnectorNote,
  ConnectorNoteLink,
  ConnectorNoteSummary,
  ConnectorOperationDefinition,
  ConnectorOperationResult,
} from '@shared';
import { env } from '../config/env';
import { HttpError } from '../middleware/errors';
import type { ConnectorAdapter, ConnectorHealth, ConnectorRuntime } from './types';

const MAX_TITLE = 200;
const MAX_FOLDER = 300;
const MAX_CONTENT_CHARS = 200_000;
const MAX_SEARCH_BYTES = 512 * 1024;
const MAX_READ_BYTES = 256 * 1024;
const MAX_SEARCH_FILES = 2_500;
const MAX_SEARCH_MATCHES = 80;
const FILE_CACHE_MS = 2_000;
const BLOCKED_DIRECTORIES = new Set(['.obsidian', '.git', '.trash', '.caera-trash', 'node_modules']);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const NAMING_MODES = ['as-entered', 'date-prefix', 'slug'] as const;
type NoteNaming = (typeof NAMING_MODES)[number];

const OPERATIONS: ConnectorOperationDefinition[] = [
  {
    id: 'search',
    capability: 'search',
    label: 'Search notes',
    description:
      'Search Markdown titles, contents, tags and folder paths. An empty query lists the most recently updated notes.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'query',
        type: 'string',
        description: 'Text to find. Leave empty to list recent notes.',
        required: false,
        maxLength: 200,
      },
      {
        name: 'tag',
        type: 'string',
        description: 'Optional tag filter without the leading #.',
        required: false,
        maxLength: 80,
      },
      {
        name: 'folder',
        type: 'string',
        description: 'Optional vault-relative folder path to search inside.',
        required: false,
        maxLength: MAX_FOLDER,
      },
      {
        name: 'limit',
        type: 'integer',
        description: 'Maximum number of notes to return, from 1 to 30.',
        required: false,
        minimum: 1,
        maximum: 30,
      },
    ],
  },
  {
    id: 'read',
    capability: 'read',
    label: 'Read note',
    description: 'Read one Markdown note, including frontmatter, tags and internal links.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Vault-relative path, for example Projects/CAERA.md.',
        required: true,
        maxLength: 500,
      },
    ],
  },
  {
    id: 'create',
    capability: 'create',
    label: 'Create note',
    description:
      'Create a new Markdown note using the configured folder and naming rule. Existing notes are never overwritten. Review the preview first; confirmation is required unless trusted creation is enabled.',
    permission: 'create',
    destructive: false,
    arguments: [
      {
        name: 'title',
        type: 'string',
        description: 'Note title. The configured naming rule turns it into a file name.',
        required: true,
        maxLength: MAX_TITLE,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Initial Markdown content. May be empty. Frontmatter is preserved exactly.',
        required: false,
        maxLength: MAX_CONTENT_CHARS,
      },
      {
        name: 'folder',
        type: 'string',
        description: 'Optional vault-relative folder. Defaults to the configured note folder.',
        required: false,
        maxLength: MAX_FOLDER,
      },
    ],
  },
  {
    id: 'append',
    capability: 'append',
    label: 'Append to note',
    description: 'Add Markdown content to the end of an existing note without replacing it.',
    permission: 'edit',
    destructive: false,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Vault-relative path of the existing note.',
        required: true,
        maxLength: 500,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Markdown content to append.',
        required: true,
        maxLength: MAX_CONTENT_CHARS,
      },
    ],
  },
  {
    id: 'update',
    capability: 'update',
    label: 'Replace note content',
    description:
      'Replace the full content of an existing note. Always requires confirmation and never changes a different note.',
    permission: 'edit',
    destructive: true,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Vault-relative path of the existing note.',
        required: true,
        maxLength: 500,
      },
      {
        name: 'content',
        type: 'string',
        description: 'New Markdown content for the note.',
        required: true,
        maxLength: MAX_CONTENT_CHARS,
      },
    ],
  },
  {
    id: 'delete',
    capability: 'delete',
    label: 'Delete note',
    description: 'Delete one note from the vault. Always requires confirmation.',
    permission: 'delete',
    destructive: true,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Vault-relative path of the note to delete.',
        required: true,
        maxLength: 500,
      },
    ],
  },
  {
    id: 'open',
    capability: 'open',
    label: 'Open in Obsidian',
    description: 'Create a local Obsidian URI for a note. The node never launches an application.',
    permission: 'read',
    destructive: false,
    arguments: [
      {
        name: 'path',
        type: 'string',
        description: 'Vault-relative path of the note to open.',
        required: true,
        maxLength: 500,
      },
    ],
  },
];

const DESCRIPTOR: ConnectorDescriptor = {
  id: 'obsidian',
  name: 'Obsidian',
  vendor: 'Obsidian',
  description:
    'Search, read and write Markdown notes in a local Obsidian vault. Access stays inside the chosen folders; no account, token or network request is involved.',
  availability: 'available',
  availabilityDetail:
    'Local folder adapter. Markdown files only; readable and writable folders are configurable and contained to the vault.',
  auth: {
    method: 'local-folder',
    label: 'Local vault folder',
    description:
      'Choose the folder Obsidian opens as a vault. CAERA stores the path locally and never leaves it.',
    fields: [
      {
        key: 'vaultPath',
        label: 'Vault folder',
        type: 'path',
        required: true,
        placeholder: 'C:\\Users\\you\\Documents\\My vault',
        help: 'The folder must already exist and be readable. CAERA only touches Markdown files inside it.',
      },
      {
        key: 'includedFolders',
        label: 'Accessible folders',
        type: 'text',
        required: false,
        placeholder: 'Projects, Areas',
        help: 'Optional comma-separated vault-relative folders. Empty means the whole vault.',
      },
      {
        key: 'excludedFolders',
        label: 'Excluded folders',
        type: 'text',
        required: false,
        placeholder: 'Archive, Templates',
        help: 'Folders the connector must never search, read or write.',
      },
      {
        key: 'defaultNoteFolder',
        label: 'Default note folder',
        type: 'text',
        required: false,
        placeholder: 'Inbox',
        help: 'Where new notes go when no folder is chosen. Empty means the vault root.',
      },
      {
        key: 'noteNaming',
        label: 'Note naming',
        type: 'select',
        required: false,
        defaultValue: 'as-entered',
        options: [
          { value: 'as-entered', label: 'As entered' },
          { value: 'date-prefix', label: 'Date prefix (YYYY-MM-DD)' },
          { value: 'slug', label: 'Slug (lowercase-hyphen)' },
        ],
        help: 'Applied to new notes created from a title.',
      },
      {
        key: 'trustedCreate',
        label: 'Trusted creation',
        type: 'boolean',
        required: false,
        defaultValue: 'false',
        help: 'When on, a reviewed create preview can be written without an extra confirmation. Update and delete still always ask.',
      },
    ],
    alternatives: [
      {
        method: 'local-api',
        label: 'Obsidian Local REST API (planned)',
        description:
          'The community plugin can expose a loopback REST API. This adapter is structured so it can be added as an alternative transport; the plugin is not required or implemented yet.',
        requiresPlugin: true,
      },
    ],
  },
  capabilities: ['search', 'read', 'create', 'append', 'update', 'delete', 'open'],
  permissions: ['read', 'create', 'edit', 'delete'],
  operations: OPERATIONS,
};

interface VaultSettings {
  root: string;
  includedFolders: string[];
  excludedFolders: string[];
  defaultNoteFolder: string;
  noteNaming: NoteNaming;
  trustedCreate: boolean;
}

interface NotePath {
  absolute: string;
  relative: string;
  folder: string;
}

interface NoteIndex {
  paths: Map<string, string>;
  byBasename: Map<string, string[]>;
}

interface ParsedContent {
  frontmatter: ConnectorFrontmatter;
  body: string;
}

interface DraftTarget {
  relative: string;
  absolute: string;
  folder: string;
  fileName: string;
  content: string;
  exists: boolean;
  warnings: string[];
}

const fileCache = new Map<string, { at: number; files: string[]; truncated: boolean }>();

function invalid(message: string, hint?: string): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', message, hint);
}

function failed(status: number, message: string, hint?: string): HttpError {
  return new HttpError(status, 'CONNECTOR_OPERATION_FAILED', message, hint);
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const left = process.platform === 'win32' ? root.toLowerCase() : root;
  const right = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  return right === left || right.startsWith(`${left}${path.sep}`);
}

function isInside(root: string, candidate: string): boolean {
  const left = process.platform === 'win32' ? root.toLowerCase() : root;
  const right = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  return right.startsWith(`${left}${path.sep}`);
}

function resolveVaultRoot(raw: string): string {
  const candidate = (raw || env.connectors.obsidianVault || '').trim();
  if (!candidate) {
    throw new HttpError(
      400,
      'CONNECTOR_CONFIG_INVALID',
      'Choose an Obsidian vault folder.',
      'Use Browse folders in Connections, or set CAERA_OBSIDIAN_VAULT.',
    );
  }

  const absolute = path.resolve(candidate);
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    throw new HttpError(
      400,
      'CONNECTOR_CONFIG_INVALID',
      'That vault folder does not exist.',
      'Choose an existing folder on this machine.',
    );
  }

  if (!stat.isDirectory()) {
    throw new HttpError(400, 'CONNECTOR_CONFIG_INVALID', 'The vault path must be a folder.');
  }

  const root = realpathSync(absolute);
  if (root === path.parse(root).root) {
    throw new HttpError(
      400,
      'CONNECTOR_CONFIG_INVALID',
      'Choose a vault folder rather than an entire drive.',
    );
  }

  try {
    accessSync(root, constants.R_OK);
  } catch {
    throw new HttpError(
      400,
      'CONNECTOR_CONFIG_INVALID',
      'The vault folder is not readable by the local node.',
    );
  }

  return root;
}

function isWithin(folder: string, prefix: string): boolean {
  if (!prefix) return true;
  const left = process.platform === 'win32' ? folder.toLowerCase() : folder;
  const right = process.platform === 'win32' ? prefix.toLowerCase() : prefix;
  return left === right || left.startsWith(`${right}/`);
}

function isAllowedFolder(settings: VaultSettings, folder: string): boolean {
  if (settings.excludedFolders.some((prefix) => isWithin(folder, prefix))) return false;
  if (settings.includedFolders.length === 0) return true;
  return settings.includedFolders.some((prefix) => isWithin(folder, prefix));
}

function mayTraverse(settings: VaultSettings, folder: string): boolean {
  if (settings.excludedFolders.some((prefix) => isWithin(folder, prefix))) return false;
  if (settings.includedFolders.length === 0) return true;
  return settings.includedFolders.some(
    (prefix) => isWithin(folder, prefix) || isWithin(prefix, folder),
  );
}

function normalizeFolder(raw: string): string {
  const value = raw.trim().replace(/\\/g, '/');
  if (!value) return '';
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw invalid('Use a folder relative to the vault, not an absolute path.');
  }

  const segments = value.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw invalid('A vault folder cannot contain parent traversal.');
  }
  if (segments.some((segment) => BLOCKED_DIRECTORIES.has(segment.toLowerCase()))) {
    throw invalid('That folder is reserved and cannot be accessed by the connector.');
  }
  if (segments.some((segment) => segment.endsWith('.') || segment.endsWith(' '))) {
    throw invalid('A vault folder name cannot end with a dot or space.');
  }

  return segments.join('/');
}

function folderList(raw: unknown, label: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== 'string') throw invalid(`${label} must be text.`);

  const folders: string[] = [];
  for (const entry of raw.split(/[\n,;]+/)) {
    if (!entry.trim()) continue;
    const folder = normalizeFolder(entry);
    if (folder && !folders.includes(folder)) folders.push(folder);
  }
  return folders;
}

function parseNaming(raw: unknown, strict: boolean): NoteNaming {
  if (raw === undefined || raw === null || raw === '') return 'as-entered';
  if (typeof raw !== 'string' || !NAMING_MODES.includes(raw as NoteNaming)) {
    if (strict) {
      throw invalid('Note naming must be as-entered, date-prefix or slug.');
    }
    return 'as-entered';
  }
  return raw as NoteNaming;
}

function parseBoolean(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function vaultSettings(runtime: ConnectorRuntime): VaultSettings {
  const root = resolveVaultRoot(runtime.config.vaultPath ?? '');
  const includedFolders = folderList(runtime.config.includedFolders, 'Accessible folders');
  const excludedFolders = folderList(runtime.config.excludedFolders, 'Excluded folders');
  let defaultNoteFolder = normalizeFolder(runtime.config.defaultNoteFolder ?? '');

  if (includedFolders.length > 0 && !defaultNoteFolder) {
    defaultNoteFolder = includedFolders[0] ?? '';
  }

  return {
    root,
    includedFolders,
    excludedFolders,
    defaultNoteFolder,
    noteNaming: parseNaming(runtime.config.noteNaming, false),
    trustedCreate: parseBoolean(runtime.config.trustedCreate),
  };
}

function normalizeRelativePath(raw: string): string {
  const value = raw.trim().replace(/\\/g, '/');
  if (!value) throw invalid('A note path is required.');
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw invalid('Use a path relative to the vault, not an absolute path.');
  }

  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw invalid('The note path cannot contain empty segments or parent traversal.');
  }
  if (segments.some((segment) => BLOCKED_DIRECTORIES.has(segment.toLowerCase()))) {
    throw invalid('That folder is reserved and cannot be accessed by the connector.');
  }
  if (segments.some((segment) => segment.endsWith('.') || segment.endsWith(' '))) {
    throw invalid('A note path segment cannot end with a dot or space.');
  }
  if (segments.some((segment) => WINDOWS_RESERVED.test(segment))) {
    throw invalid('That note name is reserved by the operating system.');
  }
  if (!/\.(md|markdown)$/i.test(value)) {
    throw invalid('Only Markdown notes (.md or .markdown) can be accessed.');
  }

  return segments.join('/');
}

function resolveNotePath(settings: VaultSettings, raw: string): NotePath {
  const relative = normalizeRelativePath(raw);
  const folder = relative.includes('/') ? path.posix.dirname(relative) : '';
  if (!isAllowedFolder(settings, folder)) {
    throw invalid(
      'That folder is outside the accessible folders configured for this vault.',
      'Update the connection settings to include it deliberately.',
    );
  }

  const absolute = path.resolve(settings.root, ...relative.split('/'));
  if (!isInside(settings.root, absolute)) {
    throw invalid('The note path leaves the connected vault.');
  }

  if (existsSync(absolute)) {
    const stat = statSync(absolute);
    if (!stat.isFile()) throw invalid('That path is not a note file.');
    const resolved = realpathSync(absolute);
    if (!isInside(settings.root, resolved)) {
      throw invalid('The note resolves outside the connected vault.');
    }
  }

  return { absolute, relative, folder };
}

function ensureParentInside(root: string, absolute: string): void {
  // Check the nearest existing ancestor before creating anything. This keeps
  // a symlinked directory from causing a write outside the vault.
  let ancestor = path.dirname(absolute);
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (existsSync(ancestor)) {
    const resolvedAncestor = realpathSync(ancestor);
    if (!isInsideOrEqual(root, resolvedAncestor)) {
      throw invalid('The destination folder resolves outside the connected vault.');
    }
  }

  const parent = path.dirname(absolute);
  mkdirSync(parent, { recursive: true });
  const resolved = realpathSync(parent);
  if (!isInsideOrEqual(root, resolved)) {
    throw invalid('The destination folder resolves outside the connected vault.');
  }
}

function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function titleFor(relative: string): string {
  return path.basename(relative).replace(/\.(md|markdown)$/i, '');
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function excerptAround(content: string, index: number, length: number): string {
  const start = Math.max(0, index - 80);
  const end = Math.min(content.length, index + length + 160);
  const excerpt = compact(content.slice(start, end));
  return `${start > 0 ? '…' : ''}${excerpt}${end < content.length ? '…' : ''}`;
}

function readTextBounded(
  file: string,
  maxBytes: number,
): { content: string; truncated: boolean; sizeBytes: number } {
  const sizeBytes = statSync(file).size;
  if (sizeBytes <= maxBytes) {
    return { content: readFileSync(file, 'utf8'), truncated: false, sizeBytes };
  }

  const descriptor = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytes = readSync(descriptor, buffer, 0, maxBytes, 0);
    return {
      content: buffer.subarray(0, bytes).toString('utf8'),
      truncated: true,
      sizeBytes,
    };
  } finally {
    closeSync(descriptor);
  }
}

function unquoteValue(raw: string): string {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseScalar(raw: string): ConnectorFrontmatterValue {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((entry) => unquoteValue(entry))
      .filter((entry) => entry.length > 0);
  }

  const unquoted = unquoteValue(value);
  if (unquoted === 'null' || unquoted === '~') return null;
  if (unquoted === 'true') return true;
  if (unquoted === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function parseFrontmatterValues(block: string): Record<string, ConnectorFrontmatterValue> {
  const values: Record<string, ConnectorFrontmatterValue> = {};
  let listKey: string | null = null;
  let listItems: string[] = [];

  const flush = (): void => {
    if (listKey) values[listKey] = listItems;
    listKey = null;
    listItems = [];
  };

  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && listKey) {
      listItems.push(unquoteValue(listItem[1] ?? ''));
      continue;
    }

    const keyValue = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!keyValue) {
      if (!/^\s/.test(line)) flush();
      continue;
    }

    flush();
    const key = keyValue[1] ?? '';
    const rest = keyValue[2] ?? '';
    if (!rest.trim()) {
      listKey = key;
      listItems = [];
      values[key] = [];
    } else {
      values[key] = parseScalar(rest);
    }
  }

  flush();
  return values;
}

function parseContent(content: string): ParsedContent {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) {
    return { frontmatter: { raw: '', values: {} }, body: content };
  }

  const raw = match[0];
  return {
    frontmatter: {
      raw,
      values: parseFrontmatterValues(match[1] ?? ''),
    },
    body: content.slice(raw.length),
  };
}

function collectTags(frontmatter: ConnectorFrontmatter, body: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string): void => {
    const tag = raw.trim().replace(/^#+/, '').replace(/[.,;:]+$/, '');
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  };

  for (const key of ['tags', 'tag']) {
    const value = frontmatter.values[key];
    if (Array.isArray(value)) {
      for (const entry of value) add(entry);
    } else if (typeof value === 'string') {
      for (const entry of value.split(/[\s,]+/)) add(entry);
    }
  }

  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const fenceMarker = /^\s*(```|~~~)/.exec(line);
    if (fenceMarker) {
      const marker = fenceMarker[1] ?? '';
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence) continue;

    const pattern = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      add(match[2] ?? '');
    }
  }

  return tags;
}

function buildNoteIndex(settings: VaultSettings): NoteIndex {
  const collected = collectMarkdownFiles(settings, MAX_SEARCH_FILES);
  const paths = new Map<string, string>();
  const byBasename = new Map<string, string[]>();

  for (const file of collected.files) {
    const relative = relativePath(settings.root, file);
    paths.set(relative.toLowerCase(), relative);
    const base = titleFor(relative).toLowerCase();
    const matches = byBasename.get(base) ?? [];
    matches.push(relative);
    byBasename.set(base, matches);
  }

  return { paths, byBasename };
}

function safeLinkPath(value: string): string {
  const normalized = path.posix.normalize(value).replace(/^\/+/, '');
  if (normalized === '..' || normalized.startsWith('../')) return '';
  return normalized;
}

function resolveLinkTarget(target: string, noteFolder: string, index: NoteIndex): string | null {
  const candidate = target.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!candidate || /^[a-zA-Z]:/.test(candidate)) return null;

  const hasExtension = /\.(md|markdown)$/i.test(candidate);
  const attempts: string[] = [];

  if (hasExtension) {
    attempts.push(safeLinkPath(path.posix.join(noteFolder, candidate)));
    attempts.push(safeLinkPath(candidate));
  } else {
    attempts.push(safeLinkPath(path.posix.join(noteFolder, `${candidate}.md`)));
    attempts.push(safeLinkPath(`${candidate}.md`));
    attempts.push(safeLinkPath(noteFolder ? `${noteFolder}/${candidate}` : candidate));
  }

  for (const attempt of attempts) {
    if (!attempt) continue;
    const resolved = index.paths.get(attempt.toLowerCase());
    if (resolved) return resolved;
  }

  const base = path.posix.basename(candidate).replace(/\.(md|markdown)$/i, '').toLowerCase();
  const matches = index.byBasename.get(base);
  if (matches && matches.length === 1) return matches[0] ?? null;
  return null;
}

function collectLinks(note: NotePath, body: string, index: NoteIndex): ConnectorNoteLink[] {
  const links: ConnectorNoteLink[] = [];
  const seen = new Set<string>();

  const push = (link: ConnectorNoteLink): void => {
    const key = `${link.kind}:${link.raw}:${link.resolvedPath ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };

  const wikiPattern = /!?\[\[([^\]\n]+)\]\]/g;
  let wiki;
  while ((wiki = wikiPattern.exec(body)) !== null) {
    const inner = wiki[1] ?? '';
    const aliasIndex = inner.indexOf('|');
    const targetPart = (aliasIndex >= 0 ? inner.slice(0, aliasIndex) : inner).trim();
    const label =
      aliasIndex >= 0 ? inner.slice(aliasIndex + 1).trim() : targetPart || titleFor(note.relative);
    const target = targetPart.split('#')[0]?.split('^')[0]?.trim() ?? '';
    push({
      raw: wiki[0],
      target: targetPart,
      label: label || targetPart,
      kind: 'wikilink',
      resolvedPath: target ? resolveLinkTarget(target, note.folder, index) : note.relative,
    });
  }

  const markdownPattern = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let markdown;
  while ((markdown = markdownPattern.exec(body)) !== null) {
    if (markdown[1] === '!') continue;
    const label = markdown[2] ?? '';
    const rawHref = (markdown[3] ?? '').replace(/^<|>$/g, '');
    if (!rawHref) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) continue;

    let href = rawHref;
    try {
      href = decodeURIComponent(rawHref);
    } catch {
      // Keep the raw href when it is not valid percent-encoding.
    }

    if (href.startsWith('#')) {
      push({
        raw: markdown[0],
        target: href,
        label: label || href.slice(1),
        kind: 'markdown',
        resolvedPath: note.relative,
      });
      continue;
    }

    const target = href.split('#')[0]?.split('?')[0]?.trim() ?? '';
    if (!target) continue;
    push({
      raw: markdown[0],
      target: href,
      label: label || target,
      kind: 'markdown',
      resolvedPath: resolveLinkTarget(target, note.folder, index),
    });
  }

  return links;
}

function cacheKey(settings: VaultSettings, maxFiles: number): string {
  return `${settings.root}|${settings.includedFolders.join(',')}|${settings.excludedFolders.join(',')}|${maxFiles}`;
}

function invalidateFileCache(root: string): void {
  for (const key of [...fileCache.keys()]) {
    if (key.startsWith(`${root}|`)) fileCache.delete(key);
  }
}

function collectMarkdownFiles(
  settings: VaultSettings,
  maxFiles: number,
): { files: string[]; truncated: boolean } {
  const key = cacheKey(settings, maxFiles);
  const cached = fileCache.get(key);
  if (cached && Date.now() - cached.at < FILE_CACHE_MS) {
    return { files: cached.files, truncated: cached.truncated };
  }

  const files: string[] = [];
  const stack: Array<{ absolute: string; relative: string }> = [
    { absolute: settings.root, relative: '' },
  ];
  let truncated = false;

  while (stack.length > 0 && !truncated) {
    const current = stack.pop();
    if (!current) break;

    let entries;
    try {
      entries = readdirSync(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.') || BLOCKED_DIRECTORIES.has(entry.name.toLowerCase())) {
        continue;
      }

      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const absolute = path.join(current.absolute, entry.name);

      if (entry.isDirectory()) {
        if (mayTraverse(settings, relative)) {
          stack.push({ absolute, relative });
        }
        continue;
      }
      if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;
      if (!isAllowedFolder(settings, current.relative)) continue;

      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      files.push(absolute);
    }
  }

  if (fileCache.size >= 8) {
    const oldest = [...fileCache.entries()].sort((left, right) => left[1].at - right[1].at)[0];
    if (oldest) fileCache.delete(oldest[0]);
  }
  fileCache.set(key, { at: Date.now(), files, truncated });

  return { files, truncated };
}

function summaryFor(note: NotePath): ConnectorNoteSummary {
  const stat = statSync(note.absolute);
  const text = readTextBounded(note.absolute, MAX_READ_BYTES);
  const parsed = parseContent(text.content);
  const tags = collectTags(parsed.frontmatter, parsed.body);

  return {
    path: note.relative,
    title: titleFor(note.relative),
    folder: note.folder,
    excerpt: compact(parsed.body).slice(0, 240),
    tags,
    updatedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
  };
}

function readNote(settings: VaultSettings, rawPath: string): ConnectorNote {
  const note = resolveNotePath(settings, rawPath);
  if (!existsSync(note.absolute)) {
    throw failed(404, 'That note is not in the connected vault.');
  }

  const stat = statSync(note.absolute);
  const text = readTextBounded(note.absolute, MAX_READ_BYTES);
  const parsed = parseContent(text.content);
  const tags = collectTags(parsed.frontmatter, parsed.body);
  const index = buildNoteIndex(settings);

  return {
    path: note.relative,
    title: titleFor(note.relative),
    folder: note.folder,
    excerpt: compact(parsed.body).slice(0, 240),
    tags,
    content: text.content,
    truncated: text.truncated,
    updatedAt: stat.mtime.toISOString(),
    sizeBytes: text.sizeBytes,
    frontmatter: parsed.frontmatter,
    links: collectLinks(note, parsed.body, index),
  };
}

function searchNotes(
  settings: VaultSettings,
  query: string,
  tagFilter: string,
  folderFilter: string,
  requestedLimit: number,
): ConnectorOperationResult {
  const needle = query.trim().toLowerCase();
  const tagNeedle = tagFilter.trim().replace(/^#+/, '').toLowerCase();
  const folderNeedle = folderFilter.trim() ? normalizeFolder(folderFilter) : '';
  const limit = Math.min(Math.max(Math.trunc(requestedLimit) || 10, 1), 30);
  const collected = collectMarkdownFiles(settings, MAX_SEARCH_FILES);
  const matches: Array<{ score: number; summary: ConnectorNoteSummary }> = [];

  for (const file of collected.files) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }

    let content = '';
    try {
      content = readTextBounded(file, MAX_SEARCH_BYTES).content;
    } catch {
      continue;
    }

    const relative = relativePath(settings.root, file);
    const folder = relative.includes('/') ? path.posix.dirname(relative) : '';
    if (folderNeedle && !isWithin(folder, folderNeedle)) continue;

    const parsed = parseContent(content);
    const tags = collectTags(parsed.frontmatter, parsed.body);
    if (tagNeedle && !tags.some((tag) => tag.toLowerCase() === tagNeedle)) continue;

    const title = titleFor(relative);
    let score = 0;
    let contentIndex = -1;
    let frontmatterIndex = -1;

    if (needle) {
      const titleLower = title.toLowerCase();
      const pathLower = relative.toLowerCase();
      const bodyLower = parsed.body.toLowerCase();
      const frontmatterLower = parsed.frontmatter.raw.toLowerCase();
      contentIndex = bodyLower.indexOf(needle);
      frontmatterIndex = frontmatterLower.indexOf(needle);

      if (titleLower === needle) score += 12;
      else if (titleLower.startsWith(needle)) score += 8;
      else if (titleLower.includes(needle)) score += 5;

      if (pathLower.includes(needle)) score += 2;
      if (tags.some((tag) => tag.toLowerCase().includes(needle))) score += 4;
      if (contentIndex >= 0) score += 1;
      if (frontmatterIndex >= 0) score += 1;
      if (score === 0) continue;
    }

    matches.push({
      score,
      summary: {
        path: relative,
        title,
        folder,
        excerpt:
          contentIndex >= 0
            ? excerptAround(parsed.body, contentIndex, needle.length)
            : frontmatterIndex >= 0
              ? excerptAround(parsed.frontmatter.raw, frontmatterIndex, needle.length)
              : compact(parsed.body).slice(0, 240) ||
                (tags.length > 0 ? `Tags: ${tags.map((tag) => `#${tag}`).join(' ')}` : ''),
        tags,
        updatedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      },
    });

    if (matches.length >= MAX_SEARCH_MATCHES) break;
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.summary.updatedAt.localeCompare(left.summary.updatedAt);
  });

  return {
    type: 'search',
    notes: matches.slice(0, limit).map((match) => match.summary),
    total: matches.length,
    truncated: collected.truncated || matches.length >= MAX_SEARCH_MATCHES,
  };
}

function contentArgument(args: Record<string, unknown>, required: boolean): string {
  const value = args.content;
  if (value === undefined) {
    if (required) throw invalid('Content is required.');
    return '';
  }
  if (typeof value !== 'string') throw invalid('Content must be a string.');
  if (value.length > MAX_CONTENT_CHARS) {
    throw invalid(`Content must be ${MAX_CONTENT_CHARS} characters or fewer.`);
  }
  return value;
}

function pathArgument(args: Record<string, unknown>): string {
  const value = args.path;
  if (typeof value !== 'string' || !value.trim()) throw invalid('A note path is required.');
  if (value.length > 500) throw invalid('The note path must be 500 characters or fewer.');
  return value;
}

function titleArgument(args: Record<string, unknown>): string {
  const value = args.title;
  if (typeof value !== 'string' || !value.trim()) throw invalid('A note title is required.');
  if (value.length > MAX_TITLE) {
    throw invalid(`The note title must be ${MAX_TITLE} characters or fewer.`);
  }
  return value;
}

function folderArgument(args: Record<string, unknown>): string | undefined {
  const value = args.folder;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalid('The note folder must be a string.');
  if (value.length > MAX_FOLDER) {
    throw invalid(`The note folder must be ${MAX_FOLDER} characters or fewer.`);
  }
  return value;
}

function sanitizeTitle(raw: string): string {
  const value = raw
    .replace(/\.(md|markdown)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/g, '')
    .replace(/[. ]+$/g, '')
    .slice(0, 160)
    .trim();

  return value || 'Untitled';
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function noteFileName(title: string, naming: NoteNaming): string {
  const safe = sanitizeTitle(title);
  const dated = new Date().toLocaleDateString('en-CA');
  const base =
    naming === 'slug'
      ? slugify(safe) || 'untitled'
      : naming === 'date-prefix'
        ? `${dated} ${safe}`
        : safe;
  const guarded = WINDOWS_RESERVED.test(base) ? `_${base}` : base;
  return `${guarded}.md`;
}

function buildDraft(settings: VaultSettings, input: ConnectorDraftInput): DraftTarget {
  const title = (input.title ?? '').trim();
  if (!title) throw invalid('A note title is required.');
  if (title.length > MAX_TITLE) {
    throw invalid(`The note title must be ${MAX_TITLE} characters or fewer.`);
  }

  const content = input.content ?? '';
  if (typeof content !== 'string') throw invalid('Note content must be a string.');
  if (content.length > MAX_CONTENT_CHARS) {
    throw invalid(`Content must be ${MAX_CONTENT_CHARS} characters or fewer.`);
  }

  const folder =
    input.folder !== undefined && input.folder.trim()
      ? normalizeFolder(input.folder)
      : settings.defaultNoteFolder;

  if (!isAllowedFolder(settings, folder)) {
    throw invalid(
      'The destination folder is outside the accessible folders configured for this vault.',
    );
  }

  const fileName = noteFileName(title, settings.noteNaming);
  const relative = folder ? `${folder}/${fileName}` : fileName;
  const note = resolveNotePath(settings, relative);
  const safeTitle = sanitizeTitle(title);
  const warnings: string[] = [];

  if (safeTitle !== title.replace(/\.(md|markdown)$/i, '').trim()) {
    warnings.push(`The file name was adjusted to "${fileName}" for the filesystem.`);
  }
  if (!content.trim()) warnings.push('The note will be created with empty content.');

  return {
    relative: note.relative,
    absolute: note.absolute,
    folder,
    fileName,
    content,
    exists: existsSync(note.absolute),
    warnings,
  };
}

async function testVault(runtime: ConnectorRuntime): Promise<ConnectorHealth> {
  try {
    const settings = vaultSettings(runtime);
    const collected = collectMarkdownFiles(settings, 500);
    const count = collected.files.length;
    const scope =
      settings.includedFolders.length > 0
        ? `inside ${settings.includedFolders.join(', ')}`
        : 'across the vault';
    return {
      ok: true,
      detail:
        count === 0
          ? `The vault folder "${path.basename(settings.root)}" is readable; it has no accessible Markdown notes yet.`
          : `The vault folder "${path.basename(settings.root)}" is readable with ${count}${collected.truncated ? '+' : ''} Markdown notes ${scope}.`,
      metadata: { noteCount: count },
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof HttpError
          ? error.message
          : 'The vault folder could not be read by the local node.',
    };
  }
}

export const obsidianConnector: ConnectorAdapter = {
  descriptor: DESCRIPTOR,

  prepareConfig(input) {
    const vaultPath = typeof input.vaultPath === 'string' ? input.vaultPath : '';
    const root = resolveVaultRoot(vaultPath);
    const includedFolders = folderList(input.includedFolders, 'Accessible folders');
    const excludedFolders = folderList(input.excludedFolders, 'Excluded folders');
    let defaultNoteFolder = normalizeFolder(
      typeof input.defaultNoteFolder === 'string' ? input.defaultNoteFolder : '',
    );

    if (defaultNoteFolder && !isAllowedFolder({ root, includedFolders, excludedFolders, defaultNoteFolder, noteNaming: 'as-entered', trustedCreate: false }, defaultNoteFolder)) {
      throw invalid('The default note folder cannot be excluded or outside the accessible folders.');
    }
    if (includedFolders.length > 0) {
      if (!defaultNoteFolder) defaultNoteFolder = includedFolders[0] ?? '';
      if (
        !includedFolders.some((prefix) => isWithin(defaultNoteFolder, prefix)) ||
        excludedFolders.some((prefix) => isWithin(defaultNoteFolder, prefix))
      ) {
        throw invalid('The default note folder must be inside an included, non-excluded folder.');
      }
    }

    return {
      config: {
        vaultPath: root,
        includedFolders: includedFolders.join(', '),
        excludedFolders: excludedFolders.join(', '),
        defaultNoteFolder,
        noteNaming: parseNaming(input.noteNaming, true),
        trustedCreate: parseBoolean(typeof input.trustedCreate === 'string' ? input.trustedCreate : '')
          ? 'true'
          : 'false',
      },
      secrets: {},
    };
  },

  test: testVault,

  async previewCreate(input, runtime) {
    const settings = vaultSettings(runtime);
    const draft = buildDraft(settings, input);
    return {
      path: draft.relative,
      content: draft.content,
      exists: draft.exists,
      canCreate: !draft.exists,
      requiresConfirmation: !settings.trustedCreate,
      warnings: draft.exists
        ? ['A note already exists at this path. Creation is blocked; open it instead.', ...draft.warnings]
        : draft.warnings,
    } satisfies ConnectorDraftPreview;
  },

  requiresConfirmation(operationId, runtime) {
    if (operationId === 'create') return !vaultSettings(runtime).trustedCreate;
    return OPERATIONS.find((operation) => operation.id === operationId)?.destructive ?? false;
  },

  async execute(operationId, args, runtime) {
    const settings = vaultSettings(runtime);

    switch (operationId) {
      case 'search': {
        const query = typeof args.query === 'string' ? args.query : '';
        if (query.length > 200) throw invalid('The search query is too long.');
        const tag = typeof args.tag === 'string' ? args.tag : '';
        if (tag.length > 80) throw invalid('The tag filter is too long.');
        const folder = typeof args.folder === 'string' ? args.folder : '';
        if (folder.length > MAX_FOLDER) throw invalid('The folder filter is too long.');
        const limit = typeof args.limit === 'number' ? args.limit : 10;
        return searchNotes(settings, query, tag, folder, limit);
      }

      case 'read':
        return { type: 'read', note: readNote(settings, pathArgument(args)) };

      case 'create': {
        const draft = buildDraft(settings, {
          title: titleArgument(args),
          content: contentArgument(args, false),
          ...(folderArgument(args) !== undefined ? { folder: folderArgument(args) } : {}),
        });
        if (draft.exists) {
          throw failed(409, 'A note already exists at that path in the vault.');
        }

        ensureParentInside(settings.root, draft.absolute);
        try {
          writeFileSync(draft.absolute, draft.content, { encoding: 'utf8', flag: 'wx' });
        } catch {
          throw failed(500, 'The note could not be created in the vault.');
        }
        invalidateFileCache(settings.root);

        return {
          type: 'write',
          note: summaryFor({
            absolute: draft.absolute,
            relative: draft.relative,
            folder: draft.folder,
          }),
          created: true,
        };
      }

      case 'append': {
        const note = resolveNotePath(settings, pathArgument(args));
        if (!existsSync(note.absolute)) {
          throw failed(404, 'That note is not in the connected vault.');
        }

        try {
          const prefix = statSync(note.absolute).size > 0 ? '\n\n' : '';
          appendFileSync(note.absolute, `${prefix}${contentArgument(args, true)}\n`, 'utf8');
        } catch {
          throw failed(500, 'The note could not be updated in the vault.');
        }
        invalidateFileCache(settings.root);

        return { type: 'write', note: summaryFor(note), created: false };
      }

      case 'update': {
        const note = resolveNotePath(settings, pathArgument(args));
        if (!existsSync(note.absolute)) {
          throw failed(404, 'That note is not in the connected vault.');
        }

        try {
          writeFileSync(note.absolute, contentArgument(args, true), 'utf8');
        } catch {
          throw failed(500, 'The note could not be updated in the vault.');
        }
        invalidateFileCache(settings.root);

        return { type: 'write', note: summaryFor(note), created: false };
      }

      case 'delete': {
        const note = resolveNotePath(settings, pathArgument(args));
        if (!existsSync(note.absolute)) {
          throw failed(404, 'That note is not in the connected vault.');
        }

        try {
          unlinkSync(note.absolute);
        } catch {
          throw failed(500, 'The note could not be deleted from the vault.');
        }
        invalidateFileCache(settings.root);

        return { type: 'delete', path: note.relative };
      }

      case 'open': {
        const note = resolveNotePath(settings, pathArgument(args));
        if (!existsSync(note.absolute)) {
          throw failed(404, 'That note is not in the connected vault.');
        }

        const vaultName = path.basename(settings.root);
        const file = note.relative.replace(/\.(md|markdown)$/i, '');
        return {
          type: 'open',
          path: note.relative,
          url: `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`,
        };
      }

      default:
        throw new HttpError(
          404,
          'CONNECTOR_TOOL_NOT_FOUND',
          'That operation is not registered for Obsidian.',
        );
    }
  },

  async disconnect() {
    // Nothing to clean up: the connection only points at a local folder.
  },
};

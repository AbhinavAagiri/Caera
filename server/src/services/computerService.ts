import { spawn } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ApprovedDirectory,
  ComputerActionPlan,
  ComputerOperationDefinition,
  ComputerOperationId,
  ComputerOperationResult,
  ComputerSettings,
  ComputerSettingsInput,
  ComputerSnapshot,
} from '@shared';
import { COMPUTER_OPERATIONS, DEFAULT_COMPUTER_OPERATIONS } from '../domain/computer';
import {
  computerSnapshot,
  loadComputerSettings,
  normalizeApprovedApplication,
  normalizeApprovedDirectory,
  saveComputerSettings,
} from '../db/repositories/computerSettings';
import { recordToolExecution } from '../db/repositories/toolExecutions';
import { HttpError } from '../middleware/errors';
import { publish } from './eventBus';
import { logger } from './logger';

const MAX_RELATIVE_PATH = 500;
const MAX_READ_BYTES = 256_000;
const MAX_FILE_SCAN_BYTES = 512_000;
const MAX_CREATE_CHARS = 100_000;
const MAX_SEARCH_QUERY = 100;
const MAX_SCAN_ENTRIES = 8_000;
const MAX_SCAN_MS = 1_800;
const RESERVED_NAMES =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const OPENABLE_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.xml', '.yaml', '.yml',
  '.html', '.htm', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.doc', '.docx',
  '.xls', '.xlsx', '.ppt', '.pptx',
]);

function invalid(message: string, hint?: string): never {
  throw new HttpError(400, 'COMPUTER_INVALID_ARGUMENT', message, hint);
}

function requireText(value: unknown, name: string, max: number, min = 1): string {
  if (typeof value !== 'string') invalid(`${name} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    invalid(`${name} must be between ${min} and ${max} characters.`);
  }
  return trimmed;
}

function definition(operation: ComputerOperationId): ComputerOperationDefinition {
  const found = COMPUTER_OPERATIONS.find((entry) => entry.id === operation);
  if (!found) invalid('That computer operation is not registered.');
  return found;
}

export function computerOperations(): ComputerOperationDefinition[] {
  return [...COMPUTER_OPERATIONS];
}

export function getComputerSnapshot(): ComputerSnapshot {
  return computerSnapshot();
}

export function updateComputerSettings(input: ComputerSettingsInput): ComputerSnapshot {
  const current = loadComputerSettings();
  const operations = { ...DEFAULT_COMPUTER_OPERATIONS, ...(input.operations ?? {}) };
  for (const operation of COMPUTER_OPERATIONS) {
    const policy = operations[operation.id];
    if (!policy) continue;
    operations[operation.id] = {
      enabled: policy.enabled === true,
      requiresConfirmation:
        operation.confirmationRequired || policy.requiresConfirmation === true,
    };
  }
  saveComputerSettings({
    enabled: input.enabled === true,
    operations,
    applications: Array.isArray(input.applications) ? input.applications : [],
    directories: Array.isArray(input.directories) ? input.directories : [],
  });
  publish({
    kind: 'tool',
    status: 'completed',
    summary: 'Computer permissions updated',
    detail: input.enabled ? 'Local computer access is enabled with the saved operation policy.' : 'Local computer access is disabled.',
    meta: { scope: 'computer', enabled: input.enabled === true, applications: input.applications?.length ?? current.applications.length },
  });
  return getComputerSnapshot();
}

export function computerOperationPolicy(operation: ComputerOperationId) {
  const settings = loadComputerSettings();
  return {
    settings,
    definition: definition(operation),
    policy: settings.operations[operation] ?? DEFAULT_COMPUTER_OPERATIONS[operation],
  };
}

export function computerOperationRequiresConfirmation(operation: ComputerOperationId): boolean {
  const { definition: entry, policy } = computerOperationPolicy(operation);
  return entry.confirmationRequired || policy.requiresConfirmation;
}

export function assertComputerOperationAvailable(operation: ComputerOperationId): void {
  const { settings, policy } = computerOperationPolicy(operation);
  if (!settings.enabled) {
    throw new HttpError(
      409,
      'COMPUTER_DISABLED',
      'Local computer access is disabled.',
      'Enable it in Tools and permissions before trying this action.',
    );
  }
  if (!policy?.enabled) {
    throw new HttpError(
      409,
      'COMPUTER_OPERATION_DISABLED',
      `${definition(operation).label} is disabled.`,
      'Enable that operation in Tools and permissions.',
    );
  }
}

function approvedDirectory(id: string, access: 'read' | 'create'): ApprovedDirectory {
  const settings = loadComputerSettings();
  const directory = settings.directories.find((entry) => entry.id === id);
  if (!directory) {
    throw new HttpError(404, 'COMPUTER_DIRECTORY_NOT_FOUND', 'That approved directory no longer exists.');
  }
  if (access === 'read' && !directory.canRead) {
    throw new HttpError(403, 'COMPUTER_PERMISSION_DENIED', 'That directory is not approved for reading.');
  }
  if (access === 'create' && !directory.canCreate) {
    throw new HttpError(403, 'COMPUTER_PERMISSION_DENIED', 'That directory is not approved for creating files.');
  }
  const realRoot = normalizeApprovedDirectory(directory.path);
  if (!realRoot) {
    throw new HttpError(409, 'COMPUTER_DIRECTORY_UNAVAILABLE', 'That approved directory is missing or is now a drive root.');
  }
  return { ...directory, path: realRoot };
}

function safeRelativePath(raw: unknown): string {
  const value = requireText(raw, 'relativePath', MAX_RELATIVE_PATH);
  if (/[\u0000-\u001f]/.test(value)) invalid('The relative path contains control characters.');
  const segments = value.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    invalid('The relative path must not contain empty, dot or parent segments.');
  }
  for (const segment of segments) {
    if (segment.includes(':') || /[. ]$/.test(segment) || RESERVED_NAMES.test(segment)) {
      invalid('That file name is not allowed on Windows.', 'Use an ordinary file name inside the approved directory.');
    }
  }
  return segments.join(path.sep);
}

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new HttpError(403, 'COMPUTER_PATH_ESCAPE', 'The path resolves outside the approved directory.');
  }
}

function assertOpenableFile(absolute: string): void {
  if (!OPENABLE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
    throw new HttpError(
      415,
      'COMPUTER_FILE_UNTRUSTED',
      'That file type cannot be opened by CAERA.',
      'Only ordinary document and image types can be opened. Executables and scripts are never launched as files.',
    );
  }
}

function existingFile(directory: ApprovedDirectory, rawRelative: unknown): { absolute: string; relative: string } {
  const relative = safeRelativePath(rawRelative);
  const candidate = path.resolve(directory.path, relative);
  assertContained(directory.path, candidate);
  if (!existsSync(candidate)) {
    throw new HttpError(404, 'COMPUTER_FILE_NOT_FOUND', 'That file does not exist in the approved directory.');
  }
  let real: string;
  try {
    real = realpathSync(candidate);
    if (!statSync(real).isFile()) invalid('That path is not a file.');
  } catch {
    throw new HttpError(404, 'COMPUTER_FILE_NOT_FOUND', 'That file cannot be resolved.');
  }
  assertContained(directory.path, real);
  return { absolute: real, relative: path.relative(directory.path, real).replaceAll('\\', '/') };
}

function argumentsFor(operation: ComputerOperationId, args: Record<string, unknown>): Record<string, unknown> {
  switch (operation) {
    case 'applications.open':
      return { applicationId: requireText(args.applicationId, 'applicationId', 80) };
    case 'websites.open': {
      const raw = requireText(args.url, 'url', 2_048);
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        invalid('Enter a complete http or https URL.');
      }
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
        invalid('Only http and https addresses without embedded credentials are allowed.');
      }
      return { url: url.toString() };
    }
    case 'files.search':
      return {
        directoryId: requireText(args.directoryId, 'directoryId', 80),
        query: requireText(args.query, 'query', MAX_SEARCH_QUERY),
        limit: typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 50) : 20,
      };
    case 'files.read':
    case 'files.open':
    case 'files.reveal':
      return {
        directoryId: requireText(args.directoryId, 'directoryId', 80),
        relativePath: requireText(args.relativePath, 'relativePath', MAX_RELATIVE_PATH),
      };
    case 'files.create':
      return {
        directoryId: requireText(args.directoryId, 'directoryId', 80),
        relativePath: requireText(args.relativePath, 'relativePath', MAX_RELATIVE_PATH),
        content: typeof args.content === 'string' ? args.content : invalid('content must be text.'),
      };
    case 'system.info':
      return {};
    default:
      invalid('That computer operation is not registered.');
  }
}

function actionFor(operation: ComputerOperationId, args: Record<string, unknown>): ComputerActionPlan {
  const normalized = argumentsFor(operation, args);
  const entry = definition(operation);
  let summary = entry.description;
  if (operation === 'applications.open') {
    const app = loadComputerSettings().applications.find((candidate) => candidate.id === normalized.applicationId);
    if (!app) throw new HttpError(404, 'COMPUTER_APPLICATION_NOT_FOUND', 'That application is not on the approved list.');
    summary = `Open approved application “${app.label}” (${app.path}).`;
  } else if (operation === 'websites.open') {
    summary = `Open ${String(normalized.url)} in the default browser.`;
  } else if (operation === 'files.search') {
    const dir = approvedDirectory(String(normalized.directoryId), 'read');
    summary = `Search “${String(normalized.query)}” inside ${dir.path}, up to ${String(normalized.limit)} results.`;
  } else if (operation === 'files.read' || operation === 'files.create' || operation === 'files.open' || operation === 'files.reveal') {
    const dir = approvedDirectory(String(normalized.directoryId), operation === 'files.create' ? 'create' : 'read');
    const relative = safeRelativePath(normalized.relativePath);
    if (operation === 'files.create') {
      if (existsSync(path.resolve(dir.path, relative))) {
        throw new HttpError(409, 'COMPUTER_FILE_EXISTS', 'That file already exists. CAERA never overwrites it.');
      }
      summary = `Create “${relative.replaceAll('\\', '/')}” in ${dir.path} (${String(normalized.content).length} characters).`;
    } else {
      const file = existingFile(dir, normalized.relativePath);
      if (operation === 'files.open') assertOpenableFile(file.absolute);
      summary = `${operation === 'files.read' ? 'Read' : operation === 'files.open' ? 'Open' : 'Reveal'} “${file.relative}” in ${dir.path}.`;
    }
  }
  return {
    operation,
    label: entry.label,
    summary,
    requiresConfirmation: computerOperationRequiresConfirmation(operation),
    arguments: normalized,
  };
}

export function previewComputerOperation(
  operation: ComputerOperationId,
  args: Record<string, unknown>,
): ComputerActionPlan {
  assertComputerOperationAvailable(operation);
  return actionFor(operation, args);
}

function executable(name: string): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  return path.join(root, name === 'explorer.exe' ? '' : 'System32', name);
}

function launch(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        shell: false,
        windowsHide: false,
        detached: true,
        stdio: 'ignore',
      });
    } catch (cause) {
      reject(cause);
      return;
    }
    const timer = setTimeout(() => {
      child.unref();
      resolve(child.pid ?? null);
    }, 800);
    timer.unref();
    child.once('error', (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.once('spawn', () => {
      clearTimeout(timer);
      child.unref();
      resolve(child.pid ?? null);
    });
  });
}

function searchFiles(directory: ApprovedDirectory, query: string, limit: number) {
  const needle = query.toLowerCase();
  const results: Array<{ name: string; relativePath: string; size: number; modifiedAt: string }> = [];
  const stack = [directory.path];
  const started = Date.now();
  let scanned = 0;
  let truncated = false;

  while (stack.length > 0 && results.length < limit && scanned < MAX_SCAN_ENTRIES && Date.now() - started < MAX_SCAN_MS) {
    const current = stack.pop();
    if (!current) break;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      scanned += 1;
      if (scanned >= MAX_SCAN_ENTRIES || Date.now() - started >= MAX_SCAN_MS) {
        truncated = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.obsidian') continue;
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(directory.path, absolute).replaceAll('\\', '/');
      if (!relative.toLowerCase().includes(needle)) continue;
      try {
        const info = statSync(absolute);
        if (!info.isFile()) continue;
        results.push({ name: entry.name, relativePath: relative, size: info.size, modifiedAt: info.mtime.toISOString() });
      } catch {
        // A file can disappear during a search; skip it rather than fail the search.
      }
      if (results.length >= limit) break;
    }
  }

  return { results, scanned, truncated: truncated || results.length >= limit };
}

function logOperation(
  operation: ComputerOperationId,
  status: 'completed' | 'failed' | 'denied',
  summary: string,
  startedAt: string,
  errorCode: string | null = null,
): void {
  recordToolExecution({
    toolId: `computer.${operation}`,
    status,
    summary,
    startedAt,
    finishedAt: new Date().toISOString(),
    errorCode,
  });
  publish({
    kind: 'tool',
    status: status === 'completed' ? 'completed' : 'failed',
    summary: `Computer: ${definition(operation).label}`,
    detail: summary,
    meta: { operation, status },
  });
}

export async function executeComputerOperation(
  operation: ComputerOperationId,
  rawArgs: Record<string, unknown>,
  options: { confirmed: boolean; signal?: AbortSignal } = { confirmed: false },
): Promise<ComputerOperationResult> {
  assertComputerOperationAvailable(operation);
  const plan = actionFor(operation, rawArgs);
  if (plan.requiresConfirmation && !options.confirmed) {
    throw new HttpError(
      409,
      'COMPUTER_CONFIRMATION_REQUIRED',
      `${plan.label} needs explicit approval before it can run.`,
      'Review the proposed action, then confirm it.',
    );
  }
  if (options.signal?.aborted) throw new HttpError(409, 'COMPUTER_CANCELLED', 'The operation was cancelled.');

  const startedAt = new Date().toISOString();
  try {
    let data: unknown;
    let summary: string;

    switch (operation) {
      case 'applications.open': {
        const app = loadComputerSettings().applications.find((entry) => entry.id === plan.arguments.applicationId);
        if (!app) throw new HttpError(404, 'COMPUTER_APPLICATION_NOT_FOUND', 'That application is no longer approved.');
        const real = normalizeApprovedApplication(app.path);
        if (!real) throw new HttpError(409, 'COMPUTER_APPLICATION_UNAVAILABLE', 'The approved executable is missing or is no longer an .exe file.');
        const pid = await launch(real, []);
        summary = `Opened approved application “${app.label}”${pid ? ` (process ${pid})` : ''}.`;
        data = { application: app.label, pid };
        break;
      }
      case 'websites.open': {
        const pid = await launch(executable('rundll32.exe'), ['url.dll,FileProtocolHandler', String(plan.arguments.url)]);
        summary = `Asked Windows to open ${String(plan.arguments.url)} in the default browser.`;
        data = { url: plan.arguments.url, pid };
        break;
      }
      case 'files.search': {
        const dir = approvedDirectory(String(plan.arguments.directoryId), 'read');
        const found = searchFiles(dir, String(plan.arguments.query), Number(plan.arguments.limit));
        summary = `Searched ${dir.path}; found ${found.results.length} matching ${found.results.length === 1 ? 'file' : 'files'}.`;
        data = { directory: dir.path, query: plan.arguments.query, ...found };
        break;
      }
      case 'files.read': {
        const dir = approvedDirectory(String(plan.arguments.directoryId), 'read');
        const file = existingFile(dir, plan.arguments.relativePath);
        const info = statSync(file.absolute);
        if (info.size > MAX_FILE_SCAN_BYTES) {
          throw new HttpError(413, 'COMPUTER_FILE_TOO_LARGE', 'That file is too large to inspect.', `The current read limit is ${MAX_READ_BYTES} bytes.`);
        }
        const buffer = readFileSync(file.absolute);
        if (buffer.includes(0)) {
          throw new HttpError(415, 'COMPUTER_FILE_BINARY', 'That file appears to be binary. Only UTF-8 text is readable.');
        }
        const content = buffer.toString('utf8');
        if (content.length > MAX_READ_BYTES) {
          throw new HttpError(413, 'COMPUTER_FILE_TOO_LARGE', 'That file is too large to return.', `The current read limit is ${MAX_READ_BYTES} characters.`);
        }
        summary = `Read “${file.relative}” (${buffer.length} bytes).`;
        data = { path: file.relative, size: buffer.length, content };
        break;
      }
      case 'files.create': {
        const dir = approvedDirectory(String(plan.arguments.directoryId), 'create');
        const relative = safeRelativePath(plan.arguments.relativePath);
        const target = path.resolve(dir.path, relative);
        assertContained(dir.path, target);
        if (target.length > 1_000) invalid('The destination path is too long.');
        const parent = path.dirname(target);
        const realParent = realpathSync(parent);
        assertContained(dir.path, realParent);
        if (existsSync(target)) {
          throw new HttpError(409, 'COMPUTER_FILE_EXISTS', 'That file already exists. CAERA never overwrites it.');
        }
        const content = String(plan.arguments.content);
        if (content.length > MAX_CREATE_CHARS) {
          throw new HttpError(413, 'COMPUTER_CONTENT_TOO_LARGE', `Content is limited to ${MAX_CREATE_CHARS} characters.`);
        }
        writeFileSync(target, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        summary = `Created “${relative.replaceAll('\\', '/')}” in the approved directory.`;
        data = { path: relative.replaceAll('\\', '/'), characters: content.length };
        break;
      }
      case 'files.open': {
        const dir = approvedDirectory(String(plan.arguments.directoryId), 'read');
        const file = existingFile(dir, plan.arguments.relativePath);
        assertOpenableFile(file.absolute);
        const pid = await launch(executable('rundll32.exe'), ['url.dll,FileProtocolHandler', file.absolute]);
        summary = `Asked Windows to open “${file.relative}” with its default application.`;
        data = { path: file.relative, pid };
        break;
      }
      case 'files.reveal': {
        const dir = approvedDirectory(String(plan.arguments.directoryId), 'read');
        const file = existingFile(dir, plan.arguments.relativePath);
        const pid = await launch(executable('explorer.exe'), [`/select,${file.absolute}`]);
        summary = `Opened Explorer with “${file.relative}” selected.`;
        data = { path: file.relative, pid };
        break;
      }
      case 'system.info': {
        const cpus = os.cpus();
        data = {
          platform: os.platform(),
          release: os.release(),
          version: os.version(),
          architecture: os.arch(),
          hostname: os.hostname(),
          uptimeSeconds: Math.round(os.uptime()),
          cpuModel: cpus[0]?.model ?? 'unknown',
          cpuCount: cpus.length,
          totalMemoryBytes: os.totalmem(),
          freeMemoryBytes: os.freemem(),
          nodeVersion: process.version,
          windows: process.platform === 'win32',
        };
        summary = `Read system information: ${os.version()} (${os.arch()}), ${cpus.length} CPUs.`;
        break;
      }
      default:
        throw new HttpError(400, 'COMPUTER_OPERATION_NOT_FOUND', 'That computer operation is not registered.');
    }

    const finishedAt = new Date().toISOString();
    logOperation(operation, 'completed', summary, startedAt);
    logger.info('computer_operation_completed', { operation });
    return { operation, status: 'completed', summary, data, startedAt, finishedAt };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The computer operation failed.';
    logOperation(operation, 'failed', message.slice(0, 500), startedAt, cause instanceof HttpError ? cause.code : 'COMPUTER_OPERATION_FAILED');
    logger.warn('computer_operation_failed', {
      operation,
      code: cause instanceof HttpError ? cause.code : 'COMPUTER_OPERATION_FAILED',
    });
    throw cause;
  }
}

export function listComputerDirectories(rawPath?: string) {
  const home = os.homedir();
  const roots = [path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Downloads'), home]
    .filter((candidate) => existsSync(candidate) && normalizeApprovedDirectory(candidate))
    .map((candidate) => ({ label: path.basename(candidate) || candidate, path: candidate }));
  const selected = rawPath?.trim() ? normalizeApprovedDirectory(rawPath) : home;
  if (!selected) throw new HttpError(400, 'COMPUTER_DIRECTORY_UNREADABLE', 'That folder does not exist or is not readable.');
  const entries = readdirSync(selected, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, path: path.join(selected, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 400);
  return {
    path: selected,
    parent: path.dirname(selected) === selected ? null : path.dirname(selected),
    roots,
    directories: entries,
    truncated: entries.length >= 400,
  };
}

export function computerSettingsDefaults(): ComputerSettings {
  return {
    enabled: true,
    operations: structuredClone(DEFAULT_COMPUTER_OPERATIONS),
    applications: [],
    directories: [],
    updatedAt: new Date().toISOString(),
  };
}

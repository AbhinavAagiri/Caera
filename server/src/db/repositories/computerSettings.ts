import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  ApprovedApplication,
  ApprovedDirectory,
  ComputerOperationId,
  ComputerSettings,
  ComputerSettingsInput,
  ComputerSnapshot,
} from '@shared';
import { getDatabase } from '../database';
import { COMPUTER_OPERATIONS, DEFAULT_COMPUTER_OPERATIONS } from '../../domain/computer';
import { listToolExecutions } from './toolExecutions';

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 12)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOperationId(value: string): value is ComputerOperationId {
  return COMPUTER_OPERATIONS.some((operation) => operation.id === value);
}

function isDriveRoot(resolved: string): boolean {
  return path.parse(resolved).root === resolved;
}

export function normalizeApprovedDirectory(raw: string): string | null {
  const candidate = raw.trim();
  if (!candidate || !path.isAbsolute(candidate)) return null;
  try {
    if (!statSync(candidate).isDirectory()) return null;
    const real = realpathSync(candidate);
    if (isDriveRoot(real)) return null;
    return real;
  } catch {
    return null;
  }
}

export function normalizeApprovedApplication(raw: string): string | null {
  const candidate = raw.trim();
  if (!candidate || !path.isAbsolute(candidate) || path.extname(candidate).toLowerCase() !== '.exe') {
    return null;
  }
  try {
    if (!statSync(candidate).isFile()) return null;
    return realpathSync(candidate);
  } catch {
    return null;
  }
}

function defaultSettings(): ComputerSettings {
  return {
    enabled: true,
    operations: structuredClone(DEFAULT_COMPUTER_OPERATIONS),
    applications: [],
    directories: [],
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeSettings(value: unknown): ComputerSettings {
  const fallback = defaultSettings();
  if (!isRecord(value)) return fallback;

  const operations = structuredClone(DEFAULT_COMPUTER_OPERATIONS);
  if (isRecord(value.operations)) {
    for (const [id, raw] of Object.entries(value.operations)) {
      if (!isOperationId(id) || !isRecord(raw)) continue;
      const definition = COMPUTER_OPERATIONS.find((entry) => entry.id === id);
      operations[id] = {
        enabled: raw.enabled === true,
        requiresConfirmation:
          definition?.confirmationRequired === true || raw.requiresConfirmation === true,
      };
    }
  }

  const applications: ApprovedApplication[] = [];
  if (Array.isArray(value.applications)) {
    for (const raw of value.applications.slice(0, 50)) {
      if (!isRecord(raw) || typeof raw.path !== 'string') continue;
      const real = normalizeApprovedApplication(raw.path);
      if (!real) continue;
      const label =
        typeof raw.label === 'string' && raw.label.trim()
          ? raw.label.trim().slice(0, 80)
          : path.basename(real, path.extname(real));
      applications.push({ id: stableId('app', real), label, path: real });
    }
  }

  const directories: ApprovedDirectory[] = [];
  if (Array.isArray(value.directories)) {
    for (const raw of value.directories.slice(0, 50)) {
      if (!isRecord(raw) || typeof raw.path !== 'string') continue;
      const real = normalizeApprovedDirectory(raw.path);
      if (!real) continue;
      directories.push({
        id: stableId('dir', real),
        path: real,
        canRead: raw.canRead === true,
        canCreate: raw.canCreate === true,
      });
    }
  }

  return {
    enabled: value.enabled !== false,
    operations,
    applications,
    directories,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

export function loadComputerSettings(): ComputerSettings {
  const row = getDatabase()
    .prepare('SELECT settings_json, updated_at FROM computer_settings WHERE id = 1')
    .get();
  if (!row) return defaultSettings();
  try {
    const parsed = JSON.parse(String(row.settings_json ?? '{}')) as unknown;
    const settings = sanitizeSettings(parsed);
    if (typeof row.updated_at === 'string') settings.updatedAt = row.updated_at;
    return settings;
  } catch {
    return defaultSettings();
  }
}

export function saveComputerSettings(input: ComputerSettingsInput): ComputerSettings {
  const settings = sanitizeSettings({
    ...input,
    updatedAt: new Date().toISOString(),
  });
  getDatabase()
    .prepare(
      `UPDATE computer_settings
       SET settings_json = ?, updated_at = ?
       WHERE id = 1`,
    )
    .run(JSON.stringify(settings), settings.updatedAt);
  return settings;
}

export function hasApprovedApplication(id: string): ApprovedApplication | null {
  return loadComputerSettings().applications.find((entry) => entry.id === id) ?? null;
}

export function hasApprovedDirectory(id: string): ApprovedDirectory | null {
  return loadComputerSettings().directories.find((entry) => entry.id === id) ?? null;
}

export function computerSnapshot(): ComputerSnapshot {
  const history = listToolExecutions(40)
    .filter((entry) => entry.toolId.startsWith('computer.'))
    .map((entry) => ({
      id: entry.id,
      operation: entry.toolId,
      status:
        entry.status === 'failed'
          ? ('failed' as const)
          : entry.status === 'denied'
            ? ('denied' as const)
            : ('completed' as const),
      summary: entry.summary,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
    }));
  return { settings: loadComputerSettings(), operations: [...COMPUTER_OPERATIONS], history };
}

export function isConfiguredRootUsable(entry: ApprovedDirectory): boolean {
  return existsSync(entry.path) && normalizeApprovedDirectory(entry.path) !== null;
}

import { randomUUID } from 'node:crypto';
import type { PermissionLevel } from '@shared';
import { getDatabase, withTransaction } from '../database';

export type ConnectorStatus = 'disconnected' | 'connected' | 'error';

export interface ConnectedApplication {
  id: string;
  connector: string;
  displayName: string;
  status: ConnectorStatus;
  scopes: string[];
  config: Record<string, string>;
  hasSecret: boolean;
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface UpsertConnectedApplicationInput {
  connector: string;
  displayName: string;
  status: ConnectorStatus;
  scopes?: string[];
  config?: Record<string, string>;
  secrets?: Record<string, string>;
  connectedAt?: string | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
}

export interface ConnectorPermission {
  connector: string;
  scope: string;
  level: PermissionLevel;
  updatedAt: string;
}

const SELECT_COLUMNS = `
  id, connector, display_name, status, scopes, config_json, secret_json,
  connected_at, last_used_at, last_checked_at, last_error, created_at
`;

function parseScopes(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((scope): scope is string => typeof scope === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const record: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === 'string') record[key] = entry;
    }
    return record;
  } catch {
    return {};
  }
}

function toApplication(row: Record<string, unknown>): ConnectedApplication {
  const status: ConnectorStatus =
    row.status === 'connected' || row.status === 'error' ? row.status : 'disconnected';
  const secrets = parseStringRecord(row.secret_json);

  return {
    id: typeof row.id === 'string' ? row.id : '',
    connector: typeof row.connector === 'string' ? row.connector : '',
    displayName: typeof row.display_name === 'string' ? row.display_name : '',
    status,
    scopes: parseScopes(row.scopes),
    config: parseStringRecord(row.config_json),
    hasSecret: Object.keys(secrets).length > 0,
    connectedAt: typeof row.connected_at === 'string' ? row.connected_at : null,
    lastUsedAt: typeof row.last_used_at === 'string' ? row.last_used_at : null,
    lastCheckedAt: typeof row.last_checked_at === 'string' ? row.last_checked_at : null,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

export function listConnectedApplications(): ConnectedApplication[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM connected_applications
       ORDER BY display_name ASC`,
    )
    .all();

  return rows.map((row) => toApplication(row));
}

export function getConnectedApplication(connector: string): ConnectedApplication | null {
  const row = getDatabase()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM connected_applications
       WHERE connector = ?`,
    )
    .get(connector);

  return row ? toApplication(row) : null;
}

export function getConnectedApplicationSecrets(connector: string): Record<string, string> {
  const row = getDatabase()
    .prepare('SELECT secret_json FROM connected_applications WHERE connector = ?')
    .get(connector);

  return parseStringRecord(row?.secret_json);
}

export function upsertConnectedApplication(
  input: UpsertConnectedApplicationInput,
): ConnectedApplication {
  const now = new Date().toISOString();
  const id = randomUUID();

  getDatabase()
    .prepare(
      `INSERT INTO connected_applications
         (id, connector, display_name, status, scopes, config_json, secret_json,
          connected_at, last_used_at, last_checked_at, last_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(connector) DO UPDATE SET
         display_name = excluded.display_name,
         status = excluded.status,
         scopes = excluded.scopes,
         config_json = excluded.config_json,
         secret_json = excluded.secret_json,
         connected_at = COALESCE(connected_applications.connected_at, excluded.connected_at),
         last_checked_at = excluded.last_checked_at,
         last_error = excluded.last_error`,
    )
    .run(
      id,
      input.connector,
      input.displayName,
      input.status,
      JSON.stringify(input.scopes ?? []),
      JSON.stringify(input.config ?? {}),
      JSON.stringify(input.secrets ?? {}),
      input.connectedAt ?? now,
      input.lastCheckedAt ?? null,
      input.lastError ?? null,
      now,
    );

  const saved = getConnectedApplication(input.connector);
  if (!saved) throw new Error('The connector could not be saved.');
  return saved;
}

export function updateConnectedApplicationStatus(
  connector: string,
  status: ConnectorStatus,
  lastError: string | null,
  lastCheckedAt: string,
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE connected_applications
       SET status = ?, last_error = ?, last_checked_at = ?
       WHERE connector = ?`,
    )
    .run(status, lastError, lastCheckedAt, connector);

  return Number(result.changes) > 0;
}

export function markConnectedApplicationUsed(connector: string, at: string): void {
  getDatabase()
    .prepare('UPDATE connected_applications SET last_used_at = ? WHERE connector = ?')
    .run(at, connector);
}

export function deleteConnectedApplication(connector: string): boolean {
  return withTransaction(() => {
    const database = getDatabase();
    database
      .prepare('DELETE FROM connector_permissions WHERE connector = ?')
      .run(connector);
    const result = database
      .prepare('DELETE FROM connected_applications WHERE connector = ?')
      .run(connector);
    return Number(result.changes) > 0;
  });
}

export function listConnectorPermissions(connector: string): ConnectorPermission[] {
  const rows = getDatabase()
    .prepare(
      `SELECT connector, scope, level, updated_at
       FROM connector_permissions
       WHERE connector = ?
       ORDER BY scope ASC`,
    )
    .all(connector);

  return rows.flatMap((row) => {
    if (
      typeof row.connector !== 'string' ||
      typeof row.scope !== 'string' ||
      typeof row.updated_at !== 'string'
    ) {
      return [];
    }

    const level: PermissionLevel =
      row.level === 'allow' || row.level === 'block' ? row.level : 'ask';

    return [
      {
        connector: row.connector,
        scope: row.scope,
        level,
        updatedAt: row.updated_at,
      },
    ];
  });
}

export function setConnectorPermission(
  connector: string,
  scope: string,
  level: PermissionLevel,
): ConnectorPermission {
  const updatedAt = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO connector_permissions (connector, scope, level, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(connector, scope) DO UPDATE SET
         level = excluded.level,
         updated_at = excluded.updated_at`,
    )
    .run(connector, scope, level, updatedAt);

  return { connector, scope, level, updatedAt };
}

export function deleteConnectorPermissions(connector: string): void {
  getDatabase()
    .prepare('DELETE FROM connector_permissions WHERE connector = ?')
    .run(connector);
}

/**
 * Read is the only default grant. Write grants stay blocked until the user
 * explicitly enables them. Existing rows are left untouched.
 */
export function ensureConnectorPermissions(connector: string): void {
  const updatedAt = new Date().toISOString();
  const insert = getDatabase().prepare(
    `INSERT OR IGNORE INTO connector_permissions (connector, scope, level, updated_at)
     VALUES (?, ?, ?, ?)`,
  );

  withTransaction(() => {
    insert.run(connector, 'read', 'allow', updatedAt);
    insert.run(connector, 'create', 'block', updatedAt);
    insert.run(connector, 'edit', 'block', updatedAt);
    insert.run(connector, 'delete', 'block', updatedAt);
  });
}

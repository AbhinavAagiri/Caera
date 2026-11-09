import { existsSync, mkdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { DatabaseStatus } from '@shared';
import { env } from '../config/env';
import { logger } from '../services/logger';

let connection: DatabaseSync | null = null;

function toInteger(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return fallback;
}

/**
 * Opens the local SQLite database and applies the pragmas CAERA relies on.
 * The node is single-process and single-user, so one synchronous connection is
 * enough; SQLite serializes access and keeps the file safe on Windows.
 */
export function openDatabase(): DatabaseSync {
  if (connection) return connection;

  mkdirSync(env.dataDir, { recursive: true });
  const database = new DatabaseSync(env.databaseFile);

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    PRAGMA secure_delete = ON;
  `);

  connection = database;
  logger.info('database_opened', { engine: 'sqlite', file: env.databaseFile });
  return database;
}

export function getDatabase(): DatabaseSync {
  if (!connection) {
    throw new Error('The local database is not open. Call openDatabase() before using repositories.');
  }
  return connection;
}

export function withTransaction<T>(operation: () => T): T {
  const database = getDatabase();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // The original error is more useful than a rollback failure.
    }
    throw error;
  }
}

export function closeDatabase(): void {
  if (!connection) return;
  try {
    connection.close();
    logger.info('database_closed');
  } finally {
    connection = null;
  }
}

/** Never throws: health checks must still answer when storage is unavailable. */
export function databaseStatus(): DatabaseStatus {
  const unavailable: DatabaseStatus = {
    engine: 'sqlite',
    state: 'unavailable',
    schemaVersion: 0,
    appliedMigrations: 0,
    file: env.databaseFile,
    sizeBytes: null,
  };

  if (!connection) return unavailable;

  try {
    const row = connection
      .prepare('SELECT COUNT(*) AS count, COALESCE(MAX(id), 0) AS version FROM schema_migrations')
      .get();
    const sizeBytes = existsSync(env.databaseFile) ? statSync(env.databaseFile).size : null;

    return {
      engine: 'sqlite',
      state: 'ready',
      schemaVersion: toInteger(row?.version),
      appliedMigrations: toInteger(row?.count),
      file: env.databaseFile,
      sizeBytes,
    };
  } catch {
    return unavailable;
  }
}

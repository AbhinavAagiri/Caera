import { getDatabase } from '../database';

export function getSetting(key: string): unknown {
  const row = getDatabase().prepare('SELECT value FROM user_settings WHERE key = ?').get(key);
  if (!row || typeof row.value !== 'string') return undefined;

  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return undefined;
  }
}

export function setSetting(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('Setting values must be JSON-serializable.');
  }

  getDatabase()
    .prepare(
      `INSERT INTO user_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    )
    .run(key, serialized, new Date().toISOString());
}

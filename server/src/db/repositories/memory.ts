import { randomUUID } from 'node:crypto';
import type { MemoryEntry, MemoryKind, MemoryRelation } from '@shared';
import { getDatabase, withTransaction } from '../database';

const MEMORY_KINDS: ReadonlySet<string> = new Set([
  'fact',
  'preference',
  'project',
  'context',
  'relationship',
]);

const SOURCE_TITLE_SELECT = `
  SELECT
    m.id,
    m.kind,
    m.content,
    m.subject,
    m.reason,
    m.source_conversation_id,
    m.source_message_id,
    m.source_excerpt,
    m.created_at,
    m.updated_at,
    m.last_used_at,
    m.use_count,
    c.title AS source_conversation_title
  FROM memory_entries m
  LEFT JOIN conversations c ON c.id = m.source_conversation_id
`;

export interface StoredMemoryInput {
  kind: MemoryKind;
  content: string;
  subject: string | null;
  reason: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  sourceExcerpt: string | null;
  relatedIds: string[];
}

export interface MemoryUpdateRecord {
  kind: MemoryKind;
  content: string;
  subject: string | null;
  reason: string | null;
  relatedIds: string[];
}

export interface MemorySettings {
  paused: boolean;
  updatedAt: string;
}

export interface ListMemoryOptions {
  query?: string;
  kind?: MemoryKind;
  limit?: number;
}

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function integer(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'bigint') return Math.max(0, Number(value));
  return 0;
}

function toKind(value: unknown): MemoryKind {
  return typeof value === 'string' && MEMORY_KINDS.has(value) ? (value as MemoryKind) : 'fact';
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function loadLinks(ids: string[]): Map<string, string[]> {
  const links = new Map<string, string[]>();
  if (ids.length === 0) return links;

  const placeholders = ids.map(() => '?').join(', ');
  const rows = getDatabase()
    .prepare(
      `SELECT memory_id, related_id
       FROM memory_links
       WHERE memory_id IN (${placeholders})
       ORDER BY memory_id, related_id`,
    )
    .all(...ids);

  for (const row of rows) {
    const memoryId = text(row.memory_id);
    const relatedId = text(row.related_id);
    if (!memoryId || !relatedId) continue;
    const current = links.get(memoryId) ?? [];
    current.push(relatedId);
    links.set(memoryId, current);
  }

  return links;
}

function loadRelations(links: Map<string, string[]>): Map<string, MemoryRelation[]> {
  const relations = new Map<string, MemoryRelation[]>();
  const ids = [...new Set([...links.values()].flat())];
  if (ids.length === 0) return relations;

  const placeholders = ids.map(() => '?').join(', ');
  const rows = getDatabase()
    .prepare(
      `SELECT id, kind, subject, content
       FROM memory_entries
       WHERE archived = 0 AND id IN (${placeholders})`,
    )
    .all(...ids);

  const byId = new Map<string, MemoryRelation>();
  for (const row of rows) {
    const id = text(row.id);
    if (!id) continue;
    byId.set(id, {
      id,
      kind: toKind(row.kind),
      subject: text(row.subject),
      content: text(row.content) ?? '',
    });
  }

  for (const [owner, relatedIds] of links) {
    relations.set(
      owner,
      relatedIds
        .map((id) => byId.get(id))
        .filter((entry): entry is MemoryRelation => Boolean(entry)),
    );
  }

  return relations;
}

function toMemoryEntry(
  row: Row,
  relatedIds: string[],
  related: MemoryRelation[],
): MemoryEntry {
  const sourceConversationId = text(row.source_conversation_id);
  const sourceMessageId = text(row.source_message_id);
  const sourceExcerpt = text(row.source_excerpt);
  const sourceConversationTitle = text(row.source_conversation_title);
  const hasSource = Boolean(sourceConversationId || sourceMessageId || sourceExcerpt);

  return {
    id: text(row.id) ?? '',
    kind: toKind(row.kind),
    content: text(row.content) ?? '',
    subject: text(row.subject),
    reason: text(row.reason),
    source: hasSource
      ? {
          conversationId: sourceConversationId,
          conversationTitle: sourceConversationTitle,
          messageId: sourceMessageId,
          excerpt: sourceExcerpt,
        }
      : null,
    relatedIds,
    related,
    createdAt: text(row.created_at) ?? '',
    updatedAt: text(row.updated_at) ?? '',
    lastUsedAt: text(row.last_used_at),
    useCount: integer(row.use_count),
  };
}

export function listMemoryEntries(options: ListMemoryOptions = {}): MemoryEntry[] {
  const database = getDatabase();
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 200) || 1, 1), 500);
  const filters = ['m.archived = 0'];
  const parameters: string[] = [];

  const query = options.query?.trim();
  if (query) {
    const pattern = likePattern(query);
    filters.push(
      `(m.content LIKE ? ESCAPE '\\'
        OR COALESCE(m.subject, '') LIKE ? ESCAPE '\\'
        OR COALESCE(m.reason, '') LIKE ? ESCAPE '\\')`,
    );
    parameters.push(pattern, pattern, pattern);
  }

  if (options.kind) {
    filters.push('m.kind = ?');
    parameters.push(options.kind);
  }

  const rows = database
    .prepare(
      `${SOURCE_TITLE_SELECT}
       WHERE ${filters.join(' AND ')}
       ORDER BY m.updated_at DESC, m.created_at DESC
       LIMIT ?`,
    )
    .all(...parameters, limit);

  const ids = rows.map((row) => text(row.id)).filter((id): id is string => Boolean(id));
  const links = loadLinks(ids);
  const relations = loadRelations(links);

  return rows.map((row) => {
    const id = text(row.id) ?? '';
    return toMemoryEntry(row, links.get(id) ?? [], relations.get(id) ?? []);
  });
}

export function countMemoryEntries(): number {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM memory_entries WHERE archived = 0')
    .get();
  return integer(row?.count);
}

export function findMemoryEntry(id: string): MemoryEntry | null {
  const row = getDatabase()
    .prepare(`${SOURCE_TITLE_SELECT} WHERE m.id = ? AND m.archived = 0`)
    .get(id);
  if (!row) return null;
  const links = loadLinks([id]);
  return toMemoryEntry(row, links.get(id) ?? [], loadRelations(links).get(id) ?? []);
}

export function memoryEntryExists(id: string): boolean {
  return Boolean(
    getDatabase()
      .prepare('SELECT 1 AS found FROM memory_entries WHERE id = ? AND archived = 0')
      .get(id),
  );
}

function replaceLinks(id: string, relatedIds: string[]): void {
  const database = getDatabase();
  database.prepare('DELETE FROM memory_links WHERE memory_id = ?').run(id);

  if (relatedIds.length === 0) return;
  const insert = database.prepare(
    'INSERT INTO memory_links (memory_id, related_id, created_at) VALUES (?, ?, ?)',
  );
  const createdAt = new Date().toISOString();

  for (const relatedId of [...new Set(relatedIds)]) {
    if (relatedId === id) continue;
    insert.run(id, relatedId, createdAt);
  }
}

export function createMemoryEntry(input: StoredMemoryInput): MemoryEntry {
  const id = randomUUID();
  const now = new Date().toISOString();

  withTransaction(() => {
    getDatabase()
      .prepare(
        `INSERT INTO memory_entries
           (id, kind, content, subject, reason, source_conversation_id, source_message_id,
            source_excerpt, created_at, updated_at, archived, use_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      )
      .run(
        id,
        input.kind,
        input.content,
        input.subject,
        input.reason,
        input.sourceConversationId,
        input.sourceMessageId,
        input.sourceExcerpt,
        now,
        now,
      );

    replaceLinks(id, input.relatedIds);
  });

  const created = findMemoryEntry(id);
  if (!created) throw new Error('The memory entry could not be read after it was stored.');
  return created;
}

export function updateMemoryEntry(
  id: string,
  input: MemoryUpdateRecord,
): MemoryEntry | null {
  const existing = findMemoryEntry(id);
  if (!existing) return null;

  withTransaction(() => {
    getDatabase()
      .prepare(
        `UPDATE memory_entries
         SET kind = ?, content = ?, subject = ?, reason = ?, updated_at = ?
         WHERE id = ? AND archived = 0`,
      )
      .run(
        input.kind,
        input.content,
        input.subject,
        input.reason,
        new Date().toISOString(),
        id,
      );

    replaceLinks(id, input.relatedIds);
  });

  return findMemoryEntry(id);
}

export function deleteMemoryEntry(id: string): boolean {
  const result = getDatabase()
    .prepare('DELETE FROM memory_entries WHERE id = ? AND archived = 0')
    .run(id);
  return Number(result.changes) > 0;
}

export function clearMemoryEntries(): number {
  const count = countMemoryEntries();
  getDatabase().exec('DELETE FROM memory_entries');
  return count;
}

export function markMemoryEntriesUsed(ids: string[], at: string): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  getDatabase()
    .prepare(
      `UPDATE memory_entries
       SET last_used_at = ?, use_count = use_count + 1
       WHERE archived = 0 AND id IN (${placeholders})`,
    )
    .run(at, ...ids);
}

export function getMemorySettings(): MemorySettings {
  const database = getDatabase();
  database
    .prepare(
      `INSERT OR IGNORE INTO memory_settings (id, paused, updated_at)
       VALUES (1, 0, ?)`,
    )
    .run(new Date().toISOString());

  const row = database
    .prepare('SELECT paused, updated_at FROM memory_settings WHERE id = 1')
    .get();

  return {
    paused: row?.paused === 1,
    updatedAt: text(row?.updated_at) ?? new Date().toISOString(),
  };
}

export function setMemoryPaused(paused: boolean): MemorySettings {
  const database = getDatabase();
  const updatedAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO memory_settings (id, paused, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at`,
    )
    .run(paused ? 1 : 0, updatedAt);

  return { paused, updatedAt };
}

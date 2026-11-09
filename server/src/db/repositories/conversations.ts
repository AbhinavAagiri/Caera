import type { Message, MessageNotice, NoticeActionId } from '@shared';
import { getDatabase, withTransaction } from '../database';
import type { ConversationStats, StoredConversation } from '../types';

type Row = Record<string, unknown>;

const CONVERSATION_COLUMNS = 'id, title, created_at, updated_at';
const MESSAGE_COLUMNS = 'id, conversation_id, role, kind, content, notice_json, created_at';

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function integer(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return fallback;
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function parseNotice(value: unknown): MessageNotice | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRow(parsed) || typeof parsed.title !== 'string') return undefined;

    const tone = parsed.tone === 'warning' || parsed.tone === 'error' ? parsed.tone : 'info';
    const notice: MessageNotice = { title: parsed.title, tone };

    if (Array.isArray(parsed.actions)) {
      const actions = parsed.actions
        .filter(
          (action: unknown): action is { id: NoticeActionId; label: string } =>
            isRow(action) && typeof action.id === 'string' && typeof action.label === 'string',
        )
        .map((action) => ({ id: action.id as NoticeActionId, label: action.label }));

      if (actions.length > 0) notice.actions = actions;
    }

    return notice;
  } catch {
    return undefined;
  }
}

function toMessage(row: Row): Message {
  const role: Message['role'] =
    row.role === 'assistant' || row.role === 'system' ? row.role : 'user';
  const kind: Message['kind'] = row.kind === 'notice' ? 'notice' : 'text';
  const notice = parseNotice(row.notice_json);

  return {
    id: text(row.id),
    conversationId: text(row.conversation_id),
    role,
    kind,
    content: text(row.content),
    createdAt: text(row.created_at),
    ...(notice ? { notice } : {}),
  };
}

function loadMessages(conversationId: string): Message[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages
       WHERE conversation_id = ?
       ORDER BY position ASC`,
    )
    .all(conversationId);

  return rows.map((row) => toMessage(row));
}

function hydrate(row: Row): StoredConversation {
  const id = text(row.id);
  return {
    id,
    title: text(row.title),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    messages: loadMessages(id),
  };
}

export function listStoredConversations(query?: string): StoredConversation[] {
  const database = getDatabase();
  const needle = query?.trim() ?? '';

  if (!needle) {
    const rows = database
      .prepare(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations
         ORDER BY updated_at DESC`,
      )
      .all();
    return rows.map((row) => hydrate(row));
  }

  const pattern = likePattern(needle);
  const rows = database
    .prepare(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations c
       WHERE c.title LIKE ? ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM messages m
            WHERE m.conversation_id = c.id
              AND m.content LIKE ? ESCAPE '\\'
          )
       ORDER BY updated_at DESC`,
    )
    .all(pattern, pattern);

  return rows.map((row) => hydrate(row));
}

export function findStoredConversation(id: string): StoredConversation | null {
  const row = getDatabase()
    .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`)
    .get(id);

  return row ? hydrate(row) : null;
}

export function conversationExists(id: string): boolean {
  return Boolean(getDatabase().prepare('SELECT 1 AS found FROM conversations WHERE id = ?').get(id));
}

export function countConversations(): number {
  const row = getDatabase().prepare('SELECT COUNT(*) AS count FROM conversations').get();
  return integer(row?.count);
}

export function insertStoredConversation(record: StoredConversation): void {
  withTransaction(() => {
    const database = getDatabase();

    database
      .prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(record.id, record.title, record.createdAt, record.updatedAt);

    const insertMessage = database.prepare(
      `INSERT INTO messages
         (id, conversation_id, role, kind, content, notice_json, created_at, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    record.messages.forEach((message, index) => {
      insertMessage.run(
        message.id,
        record.id,
        message.role,
        message.kind,
        message.content,
        message.notice ? JSON.stringify(message.notice) : null,
        message.createdAt,
        index,
      );
    });
  });
}

export function appendStoredMessages(
  conversationId: string,
  messages: Message[],
  updatedAt: string,
  title?: string,
): StoredConversation | null {
  const database = getDatabase();
  if (!conversationExists(conversationId)) return null;

  withTransaction(() => {
    const positionRow = database
      .prepare('SELECT COALESCE(MAX(position), -1) AS position FROM messages WHERE conversation_id = ?')
      .get(conversationId);
    let position = integer(positionRow?.position, -1) + 1;

    const insertMessage = database.prepare(
      `INSERT INTO messages
         (id, conversation_id, role, kind, content, notice_json, created_at, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const message of messages) {
      insertMessage.run(
        message.id,
        conversationId,
        message.role,
        message.kind,
        message.content,
        message.notice ? JSON.stringify(message.notice) : null,
        message.createdAt,
        position,
      );
      position += 1;
    }

    if (title) {
      database
        .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
        .run(title, updatedAt, conversationId);
    } else {
      database
        .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
        .run(updatedAt, conversationId);
    }
  });

  return findStoredConversation(conversationId);
}

export function renameStoredConversation(
  conversationId: string,
  title: string,
  updatedAt: string,
): StoredConversation | null {
  const result = getDatabase()
    .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, updatedAt, conversationId);

  if (Number(result.changes) === 0) return null;
  return findStoredConversation(conversationId);
}

export function deleteStoredConversation(conversationId: string): boolean {
  const result = getDatabase()
    .prepare('DELETE FROM conversations WHERE id = ?')
    .run(conversationId);

  return Number(result.changes) > 0;
}

export function clearStoredConversations(): number {
  const database = getDatabase();
  const count = conversationStats().conversations;
  database.exec('DELETE FROM conversations');
  return count;
}

export function conversationStats(): ConversationStats {
  const row = getDatabase()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM conversations) AS conversations,
         (SELECT COUNT(*) FROM messages) AS messages`,
    )
    .get();

  return {
    conversations: integer(row?.conversations),
    messages: integer(row?.messages),
  };
}

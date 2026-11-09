import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  Message,
  MessageNotice,
  NoticeActionId,
  PermissionLevel,
  ToolId,
} from '@shared';
import { env } from '../config/env';
import { DEFAULT_PERMISSIONS } from '../domain/tools';
import { logger } from '../services/logger';
import {
  conversationExists,
  countConversations,
  insertStoredConversation,
} from './repositories/conversations';
import { savePermissionLevel } from './repositories/permissions';
import { getSetting, setSetting } from './repositories/settings';
import type { StoredConversation } from './types';

const MARKER_KEY = 'migrations.store_json_v1';
const NOTICE_ACTION_IDS: readonly NoticeActionId[] = [
  'open-provider-settings',
  'open-tools',
  'open-memory-settings',
  'retry',
];

export type LegacyImportReason =
  | 'already-imported'
  | 'no-legacy-file'
  | 'unreadable'
  | 'database-not-empty'
  | 'imported';

export interface LegacyImportResult {
  imported: boolean;
  reason: LegacyImportReason;
  conversations: number;
  messages: number;
  permissions: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}

function isPermissionLevel(value: unknown): value is PermissionLevel {
  return value === 'allow' || value === 'ask' || value === 'block';
}

function parseNotice(value: unknown): MessageNotice | undefined {
  if (!isRecord(value) || typeof value.title !== 'string' || !value.title.trim()) return undefined;

  const tone = value.tone === 'warning' || value.tone === 'error' ? value.tone : 'info';
  const notice: MessageNotice = { title: value.title.slice(0, 200), tone };

  if (Array.isArray(value.actions)) {
    const actions = value.actions
      .filter(
        (action: unknown): action is { id: NoticeActionId; label: string } =>
          isRecord(action) &&
          typeof action.id === 'string' &&
          NOTICE_ACTION_IDS.includes(action.id as NoticeActionId) &&
          typeof action.label === 'string',
      )
      .map((action) => ({ id: action.id, label: action.label.slice(0, 80) }));

    if (actions.length > 0) notice.actions = actions;
  }

  return notice;
}

function parseMessage(
  value: unknown,
  conversationId: string,
  fallbackTimestamp: string,
): Message | null {
  if (!isRecord(value) || typeof value.content !== 'string' || !value.content.trim()) {
    return null;
  }

  const role =
    value.role === 'assistant' || value.role === 'system' ? value.role : 'user';
  const kind = value.kind === 'notice' ? 'notice' : 'text';
  const notice = parseNotice(value.notice);

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : randomUUID(),
    conversationId,
    role,
    kind,
    content: value.content,
    createdAt: timestamp(value.createdAt, fallbackTimestamp),
    ...(notice ? { notice } : {}),
  };
}

function parseConversation(value: unknown): StoredConversation | null {
  if (!isRecord(value)) return null;

  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : randomUUID();
  const now = new Date().toISOString();
  const createdAt = timestamp(value.createdAt, now);
  const updatedAt = timestamp(value.updatedAt, createdAt);

  const messages: Message[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.messages)) {
    for (const item of value.messages) {
      const message = parseMessage(item, id, createdAt);
      if (!message) continue;
      if (seen.has(message.id)) message.id = randomUUID();
      seen.add(message.id);
      messages.push(message);
    }
  }

  const title =
    typeof value.title === 'string' && value.title.trim()
      ? value.title.trim().slice(0, 120)
      : 'Imported conversation';

  return { id, title, createdAt, updatedAt, messages };
}

/**
 * Imports the Phase 1 JSON store once. The original file is left in place and
 * only aggregate counts are logged; conversation titles and message bodies are
 * never written to the terminal.
 */
export function importLegacyStore(): LegacyImportResult {
  if (getSetting(MARKER_KEY) !== undefined) {
    return {
      imported: false,
      reason: 'already-imported',
      conversations: 0,
      messages: 0,
      permissions: 0,
    };
  }

  const file = path.join(env.dataDir, 'store.json');
  if (!existsSync(file)) {
    return {
      imported: false,
      reason: 'no-legacy-file',
      conversations: 0,
      messages: 0,
      permissions: 0,
    };
  }

  if (countConversations() > 0) {
    setSetting(MARKER_KEY, {
      version: 1,
      importedAt: new Date().toISOString(),
      skipped: 'database-not-empty',
    });
    logger.info('legacy_store_skipped', { reason: 'database-not-empty' });
    return {
      imported: false,
      reason: 'database-not-empty',
      conversations: 0,
      messages: 0,
      permissions: 0,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch (error) {
    logger.warn('legacy_store_unreadable', {
      code: (error as NodeJS.ErrnoException).code ?? 'parse-error',
    });
    return {
      imported: false,
      reason: 'unreadable',
      conversations: 0,
      messages: 0,
      permissions: 0,
    };
  }

  const candidate = isRecord(parsed) ? parsed : {};
  let conversations = 0;
  let messages = 0;
  let permissions = 0;

  if (Array.isArray(candidate.conversations)) {
    for (const raw of candidate.conversations) {
      const record = parseConversation(raw);
      if (!record || conversationExists(record.id)) continue;
      insertStoredConversation(record);
      conversations += 1;
      messages += record.messages.length;
    }
  }

  const rawPermissions = isRecord(candidate.permissionLevels) ? candidate.permissionLevels : {};
  const permissionsUpdatedAt =
    typeof candidate.permissionsUpdatedAt === 'string' ? candidate.permissionsUpdatedAt : null;

  for (const toolId of Object.keys(DEFAULT_PERMISSIONS) as ToolId[]) {
    const level = rawPermissions[toolId];
    if (!isPermissionLevel(level)) continue;
    savePermissionLevel(toolId, level, permissionsUpdatedAt);
    permissions += 1;
  }

  setSetting(MARKER_KEY, {
    version: 1,
    importedAt: new Date().toISOString(),
    source: 'store.json',
    conversations,
    messages,
    permissions,
  });

  logger.info('legacy_store_imported', { conversations, messages, permissions });

  return { imported: true, reason: 'imported', conversations, messages, permissions };
}

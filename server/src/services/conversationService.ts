import { randomUUID } from 'node:crypto';
import type {
  Conversation,
  ConversationSummary,
  CreateConversationInput,
  Message,
} from '@shared';
import {
  appendStoredMessages,
  clearStoredConversations,
  deleteStoredConversation,
  findStoredConversation,
  insertStoredConversation,
  listStoredConversations,
  renameStoredConversation,
} from '../db/repositories/conversations';
import type { StoredConversation } from '../db/types';
import { publish } from './eventBus';

const MAX_TITLE_WORDS_LENGTH = 52;
const PREVIEW_LENGTH = 110;

function compress(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function deriveConversationTitle(content: string): string {
  const clean = compress(content);
  if (!clean) return 'New conversation';

  let title = '';
  for (const word of clean.split(' ')) {
    const next = `${title} ${word}`.trim();
    if (next.length > MAX_TITLE_WORDS_LENGTH) break;
    title = next;
  }

  return title || clean.slice(0, MAX_TITLE_WORDS_LENGTH);
}

function buildPreview(content: string): string {
  return compress(content.replace(/[#*_`>-]/g, '')).slice(0, PREVIEW_LENGTH);
}

export function toConversation(record: StoredConversation): Conversation {
  const lastText = [...record.messages]
    .reverse()
    .find((message) => message.kind === 'text');

  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messages.length,
    preview: lastText ? buildPreview(lastText.content) : null,
    messages: record.messages,
  };
}

function summarize(record: StoredConversation): ConversationSummary {
  const conversation = toConversation(record);
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messageCount,
    preview: conversation.preview,
  };
}

export async function listConversations(query?: string): Promise<ConversationSummary[]> {
  return listStoredConversations(query).map(summarize);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const record = findStoredConversation(id);
  return record ? toConversation(record) : null;
}

export async function createConversation(input: CreateConversationInput): Promise<Conversation> {
  const now = new Date().toISOString();
  const firstMessage = input.firstMessage?.trim() ?? '';

  const record: StoredConversation = {
    id: randomUUID(),
    title:
      input.title?.trim() ||
      (firstMessage ? deriveConversationTitle(firstMessage) : 'New conversation'),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };

  if (firstMessage) {
    record.messages.push({
      id: randomUUID(),
      conversationId: record.id,
      role: 'user',
      kind: 'text',
      content: firstMessage,
      createdAt: now,
    });
  }

  insertStoredConversation(record);

  publish({
    kind: 'conversation',
    status: 'completed',
    summary: firstMessage ? 'Conversation started' : 'Conversation created',
    detail: record.title,
    meta: { conversationId: record.id },
  });

  if (firstMessage) {
    publish({
      kind: 'message',
      status: 'completed',
      summary: 'Message stored on this device',
      detail: 'No reply was requested by this endpoint',
      meta: { conversationId: record.id },
    });
  }

  return toConversation(record);
}

/**
 * Legacy JSON append endpoint. It stores the user turn only. Real replies use
 * POST /api/conversations/:id/turns so the response can stream.
 */
export async function appendMessage(
  conversationId: string,
  content: string,
): Promise<Conversation | null> {
  const existing = findStoredConversation(conversationId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const userMessage: Message = {
    id: randomUUID(),
    conversationId,
    role: 'user',
    kind: 'text',
    content,
    createdAt: now,
  };

  const title =
    !existing.title || existing.title === 'New conversation'
      ? deriveConversationTitle(content)
      : undefined;

  const updated = appendStoredMessages(conversationId, [userMessage], now, title);
  if (!updated) return null;

  publish({
    kind: 'message',
    status: 'completed',
    summary: 'Message stored on this device',
    detail: 'No reply was requested by this endpoint',
    meta: { conversationId, title: updated.title },
  });

  return toConversation(updated);
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<Conversation | null> {
  const updated = renameStoredConversation(conversationId, title, new Date().toISOString());
  if (!updated) return null;

  publish({
    kind: 'conversation',
    status: 'completed',
    summary: 'Conversation renamed',
    detail: title,
    meta: { conversationId },
  });

  return toConversation(updated);
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  const removed = deleteStoredConversation(conversationId);
  if (!removed) return false;

  publish({
    kind: 'conversation',
    status: 'completed',
    summary: 'Conversation deleted',
    detail: 'Local history only',
    meta: { conversationId },
  });

  return true;
}

export async function clearConversations(): Promise<number> {
  const count = clearStoredConversations();

  publish({
    kind: 'conversation',
    status: 'completed',
    summary: 'Conversation history cleared',
    detail: `${count} ${count === 1 ? 'conversation' : 'conversations'} removed from this device`,
  });

  return count;
}

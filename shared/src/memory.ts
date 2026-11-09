import type { IsoTimestamp } from './conversations.js';

/** The kinds of approved context CAERA may keep between sessions. */
export type MemoryKind = 'fact' | 'preference' | 'project' | 'context' | 'relationship';

export interface MemorySource {
  conversationId: string | null;
  conversationTitle: string | null;
  messageId: string | null;
  /** A bounded excerpt kept locally for provenance. */
  excerpt: string | null;
}

/** A compact view of a linked entry, enough to display the relationship. */
export interface MemoryRelation {
  id: string;
  kind: MemoryKind;
  subject: string | null;
  content: string;
}

/** A user-approved memory entry. Nothing here is inferred automatically. */
export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  content: string;
  subject: string | null;
  reason: string | null;
  source: MemorySource | null;
  relatedIds: string[];
  related: MemoryRelation[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  lastUsedAt: IsoTimestamp | null;
  useCount: number;
}

export interface MemoryEntryInput {
  content: string;
  kind?: MemoryKind;
  subject?: string | null;
  reason?: string | null;
  relatedMemoryIds?: string[];
  /** Optional provenance. The server verifies the message belongs to the conversation. */
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
}

export interface MemoryUpdateInput {
  kind?: MemoryKind;
  content?: string;
  subject?: string | null;
  reason?: string | null;
  relatedMemoryIds?: string[];
}

export interface MemoryListResult {
  entries: MemoryEntry[];
  /** Count of all active entries, before a search filter. */
  total: number;
  paused: boolean;
  updatedAt: IsoTimestamp;
}

export interface MemorySettingsInput {
  paused: boolean;
}

export interface MemorySettingsResult {
  paused: boolean;
  updatedAt: IsoTimestamp;
  total: number;
}

/** A memory entry selected for a provider turn. Source excerpts stay local. */
export interface RecalledMemory {
  id: string;
  kind: MemoryKind;
  subject: string | null;
  content: string;
}

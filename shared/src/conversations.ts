import type { ApiErrorBody } from './api.js';

export type IsoTimestamp = string;

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageKind = 'text' | 'notice';
export type NoticeTone = 'info' | 'warning' | 'error';

/** Client-resolved actions attached to a system notice. */
export type NoticeActionId =
  | 'open-provider-settings'
  | 'open-tools'
  | 'open-memory-settings'
  | 'retry';

export interface NoticeAction {
  id: NoticeActionId;
  label: string;
}

export interface MessageNotice {
  title: string;
  tone: NoticeTone;
  actions?: NoticeAction[];
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  kind: MessageKind;
  /** Markdown. Notices are authored by the local node, never by a model. */
  content: string;
  createdAt: IsoTimestamp;
  notice?: MessageNotice;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  messageCount: number;
  preview: string | null;
}

export interface Conversation extends ConversationSummary {
  messages: Message[];
}

export interface CreateConversationInput {
  title?: string;
  firstMessage?: string;
}

export interface AppendMessageInput {
  content: string;
}

export interface RenameConversationInput {
  title: string;
}

export interface ConversationListResponse {
  conversations: ConversationSummary[];
}

export interface ConversationResponse {
  conversation: Conversation;
}

export interface TurnRequest {
  content: string;
  /** One-message model ref override. The local router validates it. */
  model?: string;
  mode?: 'economy' | 'balanced' | 'maximum';
}

/**
 * Server-sent events for one assistant turn. The response is an HTTP POST
 * stream, not EventSource, so the client can send the prompt and abort it.
 */
export interface TurnStreamStarted {
  type: 'turn_started';
  conversation: Conversation;
  userMessage: Message;
  assistantMessageId: string;
  model: string;
}

export interface TurnStreamDelta {
  type: 'assistant_delta';
  text: string;
}

export interface TurnStreamDone {
  type: 'assistant_done';
  message: Message;
  conversation: Conversation;
}

export interface TurnStreamError {
  type: 'turn_error';
  error: ApiErrorBody;
  conversation: Conversation | null;
}

export type TurnStreamEvent =
  | TurnStreamStarted
  | TurnStreamDelta
  | TurnStreamDone
  | TurnStreamError;

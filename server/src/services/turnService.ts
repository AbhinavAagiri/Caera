import { randomUUID } from 'node:crypto';
import type { Conversation, Message, TurnStreamEvent, UsageMode } from '@shared';
import { appendStoredMessages, findStoredConversation } from '../db/repositories/conversations';
import { runCompletion } from '../ai/generation';
import { RouteError } from '../ai/router';
import { readAiSettings } from '../ai/settings';
import { ProviderError, normalizeProviderError } from '../providers/errors';
import type { ProviderMessage } from '../providers/types';
import { deriveConversationTitle, toConversation } from './conversationService';
import { publish } from './eventBus';
import { logger } from './logger';
import { buildMemoryInstruction, recallMemories } from './memoryService';
import { resolveProviderConfig, type ResolvedProviderConfig } from './providerConfigService';

export interface TurnPreparation {
  conversation: Conversation;
  userMessage: Message;
  assistantMessageId: string;
  model: string;
}

export interface GenerateReplyOptions {
  conversationId: string;
  userMessage: Message;
  assistantMessageId: string;
  model: string;
  clientSignal: AbortSignal;
  send: (event: TurnStreamEvent) => void;
  overrideModel?: string | null;
  mode?: UsageMode;
}

const NOTICE_TITLES: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: 'No model is configured',
  PROVIDER_AUTH_ERROR: 'The provider rejected the API key',
  PROVIDER_CONFIG_ERROR: 'The provider rejected the request',
  PROVIDER_MODEL_NOT_FOUND: 'Model unavailable',
  PROVIDER_RATE_LIMITED: 'Provider quota or rate limit',
  PROVIDER_TIMEOUT: 'The model timed out',
  PROVIDER_UNAVAILABLE: 'The provider is unavailable',
  PROVIDER_UNREACHABLE: 'The provider could not be reached',
  PROVIDER_BLOCKED: 'No reply was returned',
  PROVIDER_ERROR: 'The model request failed',
  AI_MODEL_UNAVAILABLE: 'The selected model is unavailable',
  AI_NO_SUITABLE_MODEL: 'No suitable model is available',
  AI_BUDGET_EXCEEDED: 'Spending limit reached',
  AI_SPENDING_CONFIRMATION_REQUIRED: 'Spending change needs confirmation',
};

interface FailureLike {
  code: string;
  message: string;
  hint?: string;
}

function buildAssistantMessage(
  conversationId: string,
  id: string,
  content: string,
  createdAt: string,
): Message {
  return {
    id,
    conversationId,
    role: 'assistant',
    kind: 'text',
    content: content.trimEnd(),
    createdAt,
  };
}

function buildProviderNotice(
  conversationId: string,
  error: FailureLike,
  attempted: boolean,
): Message {
  const localState = attempted
    ? 'Your message is stored locally. The local node attempted an AI provider request, but no complete reply was returned. Check Usage for the recorded attempt.'
    : 'Your message is stored locally and was not sent to an AI provider.';

  return {
    id: randomUUID(),
    conversationId,
    role: 'system',
    kind: 'notice',
    content: [error.message, ...(error.hint ? ['', error.hint] : []), '', localState].join('\n'),
    createdAt: new Date().toISOString(),
    notice: {
      title: NOTICE_TITLES[error.code] ?? 'The model request failed',
      tone: 'error',
      actions: [
        {
          id: 'open-provider-settings',
          label: 'Review models & usage',
        },
      ],
    },
  };
}

function persistPartial(
  conversationId: string,
  assistantMessageId: string,
  text: string,
  startedAt: string,
): Message | null {
  const content = text.trimEnd();
  if (!content) return null;

  const message = buildAssistantMessage(conversationId, assistantMessageId, content, startedAt);
  return appendStoredMessages(conversationId, [message], new Date().toISOString())
    ? message
    : null;
}

function buildProviderHistory(
  conversationId: string,
  currentUserMessage: Message,
  config: ResolvedProviderConfig,
): ProviderMessage[] {
  const record = findStoredConversation(conversationId);
  const previous = (record?.messages ?? []).filter(
    (message) =>
      message.id !== currentUserMessage.id &&
      message.kind === 'text' &&
      (message.role === 'user' || message.role === 'assistant') &&
      message.content.trim().length > 0,
  );

  const selected: ProviderMessage[] = [];
  const limit = Math.max(1, config.contextMessages - 1);
  let characters = 0;

  for (let index = previous.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const message = previous[index];
    if (!message) continue;
    if (selected.length > 0 && characters + message.content.length > config.contextChars) break;

    selected.push({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    });
    characters += message.content.length;
  }

  selected.reverse();
  while (selected[0]?.role === 'assistant') selected.shift();
  selected.push({ role: 'user', content: currentUserMessage.content });
  return selected;
}

/**
 * Stores the user's turn before the response starts, so history remains real
 * even if no provider is configured or the request fails.
 */
export function beginTurn(
  conversationId: string,
  content: string,
  overrideModel?: string | null,
): TurnPreparation | null {
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

  const settings = readAiSettings();
  const modelLabel =
    overrideModel && overrideModel !== 'auto'
      ? overrideModel.slice(overrideModel.indexOf('/') + 1)
      : overrideModel === 'auto'
        ? `Auto · ${settings.mode}`
        : settings.defaultModel
          ? settings.defaultModel.slice(settings.defaultModel.indexOf('/') + 1)
          : `Auto · ${settings.mode}`;

  publish({
    kind: 'message',
    status: 'started',
    summary: 'Message stored on this device',
    detail: `Routing · ${modelLabel}`,
    meta: { conversationId, model: modelLabel },
  });

  return {
    conversation: toConversation(updated),
    userMessage,
    assistantMessageId: randomUUID(),
    model: modelLabel,
  };
}

export async function generateReply(options: GenerateReplyOptions): Promise<void> {
  let recalled: ReturnType<typeof recallMemories> = [];
  try {
    recalled = recallMemories(options.userMessage.content, options.conversationId);
  } catch (cause) {
    logger.warn('memory_recall_failed', {
      name: cause instanceof Error ? cause.name : 'unknown_error',
    });
  }

  const config = resolveProviderConfig();
  const systemInstruction = buildMemoryInstruction(config.systemInstruction, recalled);
  const controller = new AbortController();
  let abortReason: 'client' | 'timeout' | null = null;
  let text = '';
  let sawDelta = false;
  const startedAt = new Date().toISOString();

  const onClientAbort = (): void => {
    if (controller.signal.aborted) return;
    abortReason = 'client';
    controller.abort();
  };

  if (options.clientSignal.aborted) onClientAbort();
  else options.clientSignal.addEventListener('abort', onClientAbort, { once: true });

  const timeout = setTimeout(() => {
    if (controller.signal.aborted) return;
    abortReason = 'timeout';
    controller.abort();
  }, config.timeoutMs);
  timeout.unref();

  try {
    if (controller.signal.aborted) {
      publish({
        kind: 'message',
        status: 'info',
        summary: 'Generation stopped',
        detail: 'No reply was written',
        meta: { conversationId: options.conversationId },
      });
      return;
    }

    const history = buildProviderHistory(options.conversationId, options.userMessage, config);

    await runCompletion({
      conversationId: options.conversationId,
      routingContent: options.userMessage.content,
      messages: history,
      systemInstruction,
      signal: controller.signal,
      maxOutputTokens: config.maxOutputTokens,
      ...(options.overrideModel ? { overrideModel: options.overrideModel } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      onText: (delta) => {
        if (controller.signal.aborted) return;
        text += delta;
        if (!sawDelta) {
          sawDelta = true;
          publish({
            kind: 'message',
            status: 'progress',
            summary: 'An AI model is streaming a reply',
            detail: options.overrideModel ?? 'Automatic routing',
            meta: { conversationId: options.conversationId },
          });
        }
        options.send({ type: 'assistant_delta', text: delta });
      },
    });

    if (abortReason === 'client' || options.clientSignal.aborted) {
      persistPartial(options.conversationId, options.assistantMessageId, text, startedAt);
      publish({
        kind: 'message',
        status: 'info',
        summary: 'Generation stopped',
        detail: text.trim() ? 'Partial reply kept locally' : 'No reply was written',
        meta: { conversationId: options.conversationId },
      });
      return;
    }

    if (!text.trim()) {
      throw new ProviderError('PROVIDER_BLOCKED');
    }

    const assistant = buildAssistantMessage(
      options.conversationId,
      options.assistantMessageId,
      text,
      startedAt,
    );
    const updated = appendStoredMessages(
      options.conversationId,
      [assistant],
      new Date().toISOString(),
    );

    if (!updated) {
      throw new Error('The conversation disappeared while the reply was streaming.');
    }

    options.send({
      type: 'assistant_done',
      message: assistant,
      conversation: toConversation(updated),
    });

    publish({
      kind: 'message',
      status: 'completed',
      summary: 'CAERA reply completed',
      detail: options.model,
      meta: { conversationId: options.conversationId, model: options.model },
    });
  } catch (cause) {
    if (abortReason === 'client' || options.clientSignal.aborted) {
      persistPartial(options.conversationId, options.assistantMessageId, text, startedAt);
      publish({
        kind: 'message',
        status: 'info',
        summary: 'Generation stopped',
        detail: text.trim() ? 'Partial reply kept locally' : 'No reply was written',
        meta: { conversationId: options.conversationId },
      });
      return;
    }

    const routeFailure = cause instanceof RouteError;
    const error: FailureLike =
      abortReason === 'timeout'
        ? new ProviderError('PROVIDER_TIMEOUT')
        : routeFailure
          ? { code: cause.code, message: cause.message, ...(cause.hint ? { hint: cause.hint } : {}) }
          : normalizeProviderError(cause);

    const messages: Message[] = [];
    if (text.trim()) {
      messages.push(
        buildAssistantMessage(options.conversationId, options.assistantMessageId, text, startedAt),
      );
    }
    messages.push(buildProviderNotice(options.conversationId, error, !routeFailure));

    const updated = appendStoredMessages(
      options.conversationId,
      messages,
      new Date().toISOString(),
    );

    options.send({
      type: 'turn_error',
      error: {
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      },
      conversation: updated ? toConversation(updated) : null,
    });

    logger.warn('turn_generation_failed', {
      code: error.code,
      modeled: !routeFailure,
    });
    publish({
      kind: 'error',
      status: 'failed',
      summary: 'The model reply failed',
      detail: error.message,
      meta: {
        conversationId: options.conversationId,
        model: options.model,
        code: error.code,
      },
    });
  } finally {
    clearTimeout(timeout);
    options.clientSignal.removeEventListener('abort', onClientAbort);
  }
}

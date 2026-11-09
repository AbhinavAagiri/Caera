import type { AiModel, AiProviderId, ModelRoute, UsageMode } from '@shared';
import { ProviderError, normalizeProviderError } from '../providers/errors';
import type { ProviderMessage, ProviderUsage } from '../providers/types';
import { logger } from '../services/logger';
import { getRouteContext, estimateModelCost, recordAiUsage, serviceAdapter } from './aiService';
import { classifyTask } from './classifier';
import { affordable, routeTask, RouteError } from './router';
import { providerAccess } from './providerStore';

/**
 * Retry only failures where another verified model can plausibly succeed.
 * Auth/configuration/safety failures are deterministic and are surfaced
 * immediately instead of burning a second request.
 */
const RETRYABLE_FALLBACK_CODES = new Set([
  'PROVIDER_MODEL_NOT_FOUND',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_UNREACHABLE',
]);

export interface CompletionOptions {
  conversationId: string | null;
  routingContent: string;
  messages: ProviderMessage[];
  systemInstruction: string;
  signal: AbortSignal;
  maxOutputTokens: number;
  timeoutMs?: number;
  overrideModel?: string | null;
  mode?: UsageMode;
  allowFallback?: boolean;
  responseMimeType?: 'text/plain' | 'application/json';
  responseJsonSchema?: unknown;
  onText: (text: string) => void;
}

export interface CompletionResult {
  text: string;
  route: ModelRoute;
  finishReason: string | null;
  usage: ProviderUsage;
}

function isFree(model: AiModel): boolean {
  return (
    model.provider === 'ollama' ||
    (model.pricing?.inputPerMillion === 0 && model.pricing.outputPerMillion === 0)
  );
}

function providerError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return normalizeProviderError(error);
}

function usageOrEmpty(): ProviderUsage {
  return { inputTokens: null, outputTokens: null, cachedTokens: null };
}

function recordAttempt(input: {
  route: ModelRoute;
  model: AiModel;
  method: ModelRoute['routingMethod'];
  conversationId: string | null;
  usage: ProviderUsage;
  startedAt: number;
  status: 'completed' | 'failed' | 'stopped';
  errorCode: string | null;
}): void {
  const cost = estimateModelCost(
    input.model,
    input.usage.inputTokens,
    input.usage.outputTokens,
    input.usage.cachedTokens,
  );
  recordAiUsage({
    conversationId: input.conversationId,
    provider: input.model.provider,
    model: input.model.id,
    taskCategory: input.route.taskCategory,
    complexity: input.route.complexity,
    routingMethod: input.method,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cachedTokens: input.usage.cachedTokens,
    estimatedCostUsd: cost,
    pricingSourceUrl: input.model.pricing?.sourceUrl ?? null,
    durationMs: Math.max(0, Date.now() - input.startedAt),
    status: input.status,
    errorCode: input.errorCode,
  });
}

/**
 * Executes one routed model request. Fallback is allowed only before any text
 * was emitted, so users never receive a splice of two different models.
 */
export async function runCompletion(options: CompletionOptions): Promise<CompletionResult> {
  const context = getRouteContext();
  const classification = classifyTask(options.routingContent);
  const inputBytes =
    Buffer.byteLength(options.routingContent, 'utf8') +
    Buffer.byteLength(options.systemInstruction, 'utf8') +
    options.messages.reduce(
      (total, message) => total + Buffer.byteLength(message.content, 'utf8'),
      0,
    );
  const route = routeTask({
    request: {
      content: options.routingContent,
      ...(options.overrideModel ? { overrideModel: options.overrideModel } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
    },
    classification,
    models: context.models,
    settings: context.settings,
    spending: context.spending,
    maxOutputTokens: options.maxOutputTokens,
    inputBytes,
  });

  const candidates = [route.model, ...(options.allowFallback === false ? [] : route.fallbackCandidates)];
  const allowFallback = context.settings.fallbackEnabled && options.allowFallback !== false;
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    if (!model) continue;
    if (index > 0 && !allowFallback) break;
    if (index > 0 && isFree(route.model) && !isFree(model)) {
      // A free/local quota failure must never silently move work to a paid model.
      continue;
    }

    const access = providerAccess(model.provider);
    if (!access.configured) continue;
    const budget = affordable(
      model,
      context.settings,
      context.spending,
      inputBytes,
      options.maxOutputTokens,
    );
    if (!budget.ok) {
      lastError = new RouteError('AI_BUDGET_EXCEEDED', budget.reason ?? 'Budget limit reached.');
      continue;
    }

    const startedAt = Date.now();
    const usage = usageOrEmpty();
    let finishReason: string | null = null;
    let text = '';
    let emitted = false;
    let stopped = false;
    let streamError: unknown = null;

    try {
      const stream = serviceAdapter(model.provider).streamReply({
        apiKey: access.apiKey,
        model: model.id,
        endpoint: access.endpoint,
        systemInstruction: options.systemInstruction,
        messages: options.messages,
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? context.timeoutMs,
        maxOutputTokens: options.maxOutputTokens,
        ...(options.responseMimeType
          ? { responseMimeType: options.responseMimeType }
          : {}),
        ...(options.responseJsonSchema !== undefined
          ? { responseJsonSchema: options.responseJsonSchema }
          : {}),
      });

      for await (const event of stream) {
        if (options.signal.aborted) {
          stopped = true;
          streamError = new ProviderError('PROVIDER_TIMEOUT');
          break;
        }

        if (event.type === 'text') {
          if (!event.text) continue;
          emitted = true;
          text += event.text;
          options.onText(event.text);
        } else if (event.type === 'usage') {
          usage.inputTokens = event.usage.inputTokens;
          usage.outputTokens = event.usage.outputTokens;
          usage.cachedTokens = event.usage.cachedTokens;
        } else {
          finishReason = event.finishReason;
        }
      }
    } catch (cause) {
      streamError = cause;
      if (options.signal.aborted) stopped = true;
    }

    if (!streamError && text.trim().length > 0) {
      recordAttempt({
        route,
        model,
        method: index === 0 ? route.routingMethod : 'fallback',
        conversationId: options.conversationId,
        usage,
        startedAt,
        status: 'completed',
        errorCode: null,
      });
      return {
        text,
        route: {
          ...route,
          model,
          routingMethod: index === 0 ? route.routingMethod : 'fallback',
          rationale:
            index === 0
              ? route.rationale
              : `The first provider failed, so CAERA used the next permitted fallback: ${model.displayName}.`,
        },
        finishReason,
        usage,
      };
    }

    const error = streamError
      ? providerError(streamError)
      : new ProviderError('PROVIDER_BLOCKED', {
          ...(finishReason ? { hint: `The provider stopped with reason: ${finishReason}.` } : {}),
        });
    recordAttempt({
      route,
      model,
      method: index === 0 ? route.routingMethod : 'fallback',
      conversationId: options.conversationId,
      usage,
      startedAt,
      status: stopped ? 'stopped' : 'failed',
      errorCode: stopped ? 'GENERATION_CANCELLED' : error.code,
    });

    lastError = error;
    if (emitted || stopped) {
      // The caller persists the partial text. Never concatenate another model.
      throw error;
    }
    if (!allowFallback) throw error;
    if (options.signal.aborted) {
      // The turn budget is exhausted; another attempt cannot be authorized.
      throw error;
    }
    if (!RETRYABLE_FALLBACK_CODES.has(error.code)) throw error;

    const next = candidates[index + 1];
    if (next) {
      logger.warn('ai_model_fallback_selected', {
        from: model.ref,
        to: next.ref,
        code: error.code,
        httpStatus: error.httpStatus ?? null,
        attempt: index + 1,
      });
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new RouteError(
    'AI_NO_SUITABLE_MODEL',
    'No configured model could complete the request.',
    'Check provider credentials and model selection in Settings → Models & usage.',
  );
}

export function providerLabel(provider: AiProviderId): string {
  return provider === 'ollama'
    ? 'Ollama'
    : provider === 'gemini'
      ? 'Gemini'
      : provider === 'openai'
        ? 'OpenAI'
        : provider === 'anthropic'
          ? 'Claude'
          : 'DeepSeek';
}

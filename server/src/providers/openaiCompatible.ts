import type { AiProviderId } from '@shared';
import { normalizeProviderError } from './errors';
import {
  objectOrNull,
  providerFetch,
  readSse,
  safeJson,
  type ProviderHttpError,
} from './http';
import type {
  AiProvider,
  DiscoveredProviderModel,
  ProviderMessage,
  ProviderProbeRequest,
  ProviderStreamEvent,
  ProviderStreamRequest,
  ProviderUsage,
} from './types';

interface OpenAiCompatibleOptions {
  id: Extract<AiProviderId, 'openai' | 'deepseek' | 'ollama'>;
  label: string;
  requiresKey: boolean;
}

function apiUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, '')}${path}`;
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      const record = objectOrNull(part);
      return record?.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
    .join('');
}

function mapMessages(
  messages: ProviderMessage[],
  systemInstruction: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const mapped: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (systemInstruction.trim()) mapped.push({ role: 'system', content: systemInstruction });

  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    const previous = mapped.at(-1);
    if (previous && previous.role === message.role) previous.content += `\n\n${content}`;
    else mapped.push({ role: message.role, content });
  }
  return mapped;
}

function usageFrom(value: unknown): ProviderUsage | null {
  const usage = objectOrNull(value);
  if (!usage) return null;
  const details = objectOrNull(usage.prompt_tokens_details);
  return {
    inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
    cachedTokens:
      typeof details?.cached_tokens === 'number'
        ? details.cached_tokens
        : typeof usage.prompt_cache_hit_tokens === 'number'
          ? usage.prompt_cache_hit_tokens
          : null,
  };
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id: OpenAiCompatibleOptions['id'];
  readonly label: string;
  private readonly requiresKey: boolean;

  constructor(options: OpenAiCompatibleOptions) {
    this.id = options.id;
    this.label = options.label;
    this.requiresKey = options.requiresKey;
  }

  async *streamReply(request: ProviderStreamRequest): AsyncGenerator<ProviderStreamEvent> {
    if (request.signal.aborted) return;

    let response: Response;
    try {
      response = await providerFetch(
        apiUrl(request.endpoint, '/chat/completions'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders(request.apiKey),
          },
          body: JSON.stringify({
            model: request.model,
            messages: mapMessages(request.messages, request.systemInstruction),
            stream: true,
            max_tokens: request.maxOutputTokens,
            ...(this.id === 'openai' || this.id === 'deepseek'
              ? { stream_options: { include_usage: true } }
              : {}),
          }),
          signal: request.signal,
        },
        request.timeoutMs,
      );
    } catch (cause) {
      throw normalizeProviderError(cause);
    }

    let finishReason: string | null = null;
    let lastUsage: ProviderUsage | null = null;

    try {
      for await (const frame of readSse(response, request.signal)) {
        if (frame.data === '[DONE]') break;
        const payload = objectOrNull(safeJson(frame.data));
        if (!payload) continue;

        const usage = usageFrom(payload.usage);
        if (usage) lastUsage = usage;

        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const choice = objectOrNull(choices[0]);
        if (!choice) continue;

        if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
        const delta = objectOrNull(choice.delta);
        const text = textFromContent(delta?.content ?? choice.text);
        if (text) yield { type: 'text', text };
      }
    } catch (cause) {
      throw normalizeProviderError(cause);
    }

    if (lastUsage) yield { type: 'usage', usage: lastUsage };
    yield { type: 'done', finishReason };
  }

  async discoverModels(request: ProviderProbeRequest): Promise<DiscoveredProviderModel[]> {
    if (this.requiresKey && !request.apiKey) return [];

    let response: Response;
    try {
      response = await providerFetch(
        apiUrl(request.endpoint, '/models'),
        {
          headers: authHeaders(request.apiKey),
          signal: request.signal,
        },
        request.timeoutMs,
      );
    } catch (cause) {
      throw normalizeProviderError(cause);
    }

    const payload = objectOrNull(await response.json().catch(() => null));
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const discovered: DiscoveredProviderModel[] = [];

    for (const entry of data) {
      const model = objectOrNull(entry);
      if (!model) continue;
      const id = typeof model.id === 'string' ? model.id : '';
      if (!id || /embedding|moderation|whisper|tts|dall-e|audio|realtime|transcribe|image/i.test(id)) {
        continue;
      }
      discovered.push({
        id,
        displayName: typeof model.name === 'string' && model.name !== id ? model.name : id,
        contextWindow: null,
        maxOutputTokens: null,
        vision: null,
        tools: null,
        json: null,
      });
    }

    return discovered.sort((left, right) => left.id.localeCompare(right.id));
  }

  async checkConnection(request: ProviderProbeRequest & { model: string }): Promise<void> {
    const models = await this.discoverModels(request);
    const expected = request.model.trim();
    if (models.length > 0 && !models.some((model) => model.id === expected)) {
      throw normalizeProviderError({ status: 404, name: 'ModelNotFound' });
    }

    if (!this.requiresKey) {
      // A successful tags/list response is enough for a local runtime.
      return;
    }
    if (!request.apiKey) {
      throw normalizeProviderError({ status: 401, name: 'MissingKey' });
    }
  }
}

export type { ProviderHttpError };

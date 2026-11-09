import { normalizeProviderError } from './errors';
import {
  numberOrNull,
  objectOrNull,
  providerFetch,
  readSse,
  safeJson,
} from './http';
import type {
  AiProvider,
  DiscoveredProviderModel,
  ProviderMessage,
  ProviderProbeRequest,
  ProviderStreamEvent,
  ProviderStreamRequest,
} from './types';

const VERSION = '2023-06-01';

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': VERSION,
  };
}

function messagesFor(messages: ProviderMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const output: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    const previous = output.at(-1);
    if (previous?.role === message.role) previous.content += `\n\n${content}`;
    else output.push({ role: message.role, content });
  }
  while (output[0]?.role === 'assistant') output.shift();
  return output;
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const;
  readonly label = 'Anthropic Claude';

  async *streamReply(request: ProviderStreamRequest): AsyncGenerator<ProviderStreamEvent> {
    if (request.signal.aborted) return;

    let response: Response;
    try {
      response = await providerFetch(
        `${request.endpoint.replace(/\/+$/, '')}/messages`,
        {
          method: 'POST',
          headers: headers(request.apiKey),
          body: JSON.stringify({
            model: request.model,
            system: request.systemInstruction,
            messages: messagesFor(request.messages),
            max_tokens: request.maxOutputTokens,
            stream: true,
          }),
          signal: request.signal,
        },
        request.timeoutMs,
      );
    } catch (cause) {
      throw normalizeProviderError(cause);
    }

    let finishReason: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let cachedTokens: number | null = null;

    try {
      for await (const frame of readSse(response, request.signal)) {
        const payload = objectOrNull(safeJson(frame.data));
        if (!payload) continue;
        const type = payload.type;

        if (type === 'message_start') {
          const message = objectOrNull(payload.message);
          const usage = objectOrNull(message?.usage);
          inputTokens = numberOrNull(usage?.input_tokens);
          cachedTokens =
            numberOrNull(usage?.cache_read_input_tokens) ??
            numberOrNull(usage?.cache_creation_input_tokens);
        } else if (type === 'content_block_delta') {
          const delta = objectOrNull(payload.delta);
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            yield { type: 'text', text: delta.text };
          }
        } else if (type === 'message_delta') {
          const delta = objectOrNull(payload.delta);
          if (typeof delta?.stop_reason === 'string') finishReason = delta.stop_reason;
          const usage = objectOrNull(payload.usage);
          outputTokens = numberOrNull(usage?.output_tokens) ?? outputTokens;
        } else if (type === 'error') {
          const error = objectOrNull(payload.error);
          throw normalizeProviderError({
            status: 500,
            name: typeof error?.type === 'string' ? error.type : 'AnthropicStreamError',
            message: typeof error?.message === 'string' ? error.message : 'Anthropic stream failed',
          });
        }
      }
    } catch (cause) {
      throw normalizeProviderError(cause);
    }

    if (inputTokens !== null || outputTokens !== null || cachedTokens !== null) {
      yield { type: 'usage', usage: { inputTokens, outputTokens, cachedTokens } };
    }
    yield { type: 'done', finishReason };
  }

  async discoverModels(request: ProviderProbeRequest): Promise<DiscoveredProviderModel[]> {
    let response: Response;
    try {
      response = await providerFetch(
        `${request.endpoint.replace(/\/+$/, '')}/models?limit=100`,
        { headers: headers(request.apiKey), signal: request.signal },
        request.timeoutMs,
      );
    } catch (cause) {
      throw normalizeProviderError(cause);
    }

    const payload = objectOrNull(await response.json().catch(() => null));
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data
      .map((entry): DiscoveredProviderModel | null => {
        const model = objectOrNull(entry);
        const id = typeof model?.id === 'string' ? model.id : '';
        if (!id) return null;
        return {
          id,
          displayName:
            typeof model?.display_name === 'string' && model.display_name !== id
              ? model.display_name
              : id,
          contextWindow: numberOrNull(model?.context_window),
          maxOutputTokens: numberOrNull(model?.max_output_tokens),
          vision: null,
          tools: null,
          json: null,
        };
      })
      .filter((model): model is DiscoveredProviderModel => model !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async checkConnection(request: ProviderProbeRequest & { model: string }): Promise<void> {
    const models = await this.discoverModels(request);
    if (models.length > 0 && !models.some((model) => model.id === request.model)) {
      throw normalizeProviderError({ status: 404, name: 'ModelNotFound' });
    }
  }
}

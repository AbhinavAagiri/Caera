import { GoogleGenAI, type Content } from '@google/genai';
import type { AiProviderId } from '@shared';
import { normalizeProviderError } from './errors';
import {
  objectOrNull,
  providerFetch,
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
import type { ProviderHttpError as _ProviderHttpError } from './openaiCompatible';

function toContents(messages: ProviderMessage[]): Content[] {
  const contents: Content[] = [];

  for (const message of messages) {
    const text = message.content.trim();
    if (!text) continue;

    const role = message.role === 'assistant' ? 'model' : 'user';
    const previous = contents.at(-1);

    if (previous?.role === role) {
      previous.parts = [...(previous.parts ?? []), { text }];
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  while (contents[0]?.role === 'model') contents.shift();
  return contents;
}

// Gemini's model catalog also exposes audio, image and transcription models.
// They are not chat-capable in CAERA, so they must never appear in the model
// picker or count toward eligible routing models.
const NON_CHAT_MODEL_ID = /(?:tts|transcrib|image|lyria|embedding|imagen|veo|nano-banana)/i;

export function isChatCapableGeminiModel(id: string): boolean {
  return !NON_CHAT_MODEL_ID.test(id);
}

function usageFrom(metadata: unknown): ProviderUsage | null {
  const value = objectOrNull(metadata);
  if (!value) return null;
  const input = typeof value.promptTokenCount === 'number' ? value.promptTokenCount : null;
  const output = typeof value.candidatesTokenCount === 'number' ? value.candidatesTokenCount : null;
  const cached =
    typeof value.cachedContentTokenCount === 'number' ? value.cachedContentTokenCount : null;
  return input !== null || output !== null || cached !== null
    ? { inputTokens: input, outputTokens: output, cachedTokens: cached }
    : null;
}

export class GeminiProvider implements AiProvider {
  readonly id: AiProviderId = 'gemini';
  readonly label = 'Google Gemini';

  async *streamReply(request: ProviderStreamRequest): AsyncGenerator<ProviderStreamEvent> {
    if (request.signal.aborted) return;

    const client = new GoogleGenAI({ apiKey: request.apiKey });
    let stream: Awaited<ReturnType<typeof client.models.generateContentStream>>;

    try {
      stream = await client.models.generateContentStream({
        model: request.model,
        contents: toContents(request.messages),
        config: {
          systemInstruction: request.systemInstruction,
          temperature: 0.7,
          maxOutputTokens: request.maxOutputTokens,
          automaticContinuation: false,
          ...(request.responseMimeType
            ? { responseMimeType: request.responseMimeType }
            : {}),
          ...(request.responseJsonSchema !== undefined
            ? { responseJsonSchema: request.responseJsonSchema }
            : {}),
          abortSignal: request.signal,
          httpOptions: {
            baseUrl: request.endpoint,
            timeout: request.timeoutMs,
          },
        },
      });
    } catch (cause) {
      throw normalizeProviderError(cause);
    }

    let finishReason: string | null = null;
    let usage: ProviderUsage | null = null;

    try {
      for await (const chunk of stream) {
        if (request.signal.aborted) return;

        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason) finishReason = String(candidate.finishReason);
        const chunkUsage = usageFrom(chunk.usageMetadata);
        if (chunkUsage) usage = chunkUsage;

        const text = chunk.text;
        if (text) yield { type: 'text', text };
      }
    } catch (cause) {
      throw normalizeProviderError(cause);
    }

    if (usage) yield { type: 'usage', usage };
    yield { type: 'done', finishReason };
  }

  async discoverModels(request: ProviderProbeRequest): Promise<DiscoveredProviderModel[]> {
    const endpoint = `${request.endpoint.replace(/\/+$/, '')}/v1beta/models?pageSize=1000&key=${encodeURIComponent(request.apiKey)}`;
    let response: Response;
    try {
      response = await providerFetch(
        endpoint,
        { signal: request.signal },
        request.timeoutMs,
      );
    } catch (cause) {
      throw normalizeProviderError(cause);
    }

    const payload = objectOrNull(await response.json().catch(() => null));
    const models = Array.isArray(payload?.models) ? payload.models : [];
    const output: DiscoveredProviderModel[] = [];

    for (const entry of models) {
      const model = objectOrNull(entry);
      if (!model) continue;
      const fullName = typeof model.name === 'string' ? model.name : '';
      const id = fullName.replace(/^models\//, '');
      const methods = Array.isArray(model.supportedGenerationMethods)
        ? model.supportedGenerationMethods.filter((value): value is string => typeof value === 'string')
        : [];
      if (
        !id ||
        !isChatCapableGeminiModel(id) ||
        (methods.length > 0 && !methods.includes('generateContent'))
      ) {
        continue;
      }

      output.push({
        id,
        displayName:
          typeof model.displayName === 'string' && model.displayName !== id
            ? model.displayName
            : id,
        contextWindow:
          typeof model.inputTokenLimit === 'number' ? model.inputTokenLimit : null,
        maxOutputTokens:
          typeof model.outputTokenLimit === 'number' ? model.outputTokenLimit : null,
        vision: null,
        tools: null,
        json: null,
      });
    }

    return output.sort((left, right) => left.id.localeCompare(right.id));
  }

  async checkConnection(request: ProviderProbeRequest & { model: string }): Promise<void> {
    const models = await this.discoverModels(request);
    const expected = request.model.replace(/^models\//, '').trim();
    if (models.length > 0 && !models.some((model) => model.id === expected)) {
      throw normalizeProviderError({ status: 404, name: 'ModelNotFound' });
    }
  }
}

export type { _ProviderHttpError, ProviderHttpError };
export { safeJson };

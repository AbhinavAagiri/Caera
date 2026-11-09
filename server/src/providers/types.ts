import type { AiProviderId } from '@shared';

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderStreamRequest {
  apiKey: string;
  model: string;
  endpoint: string;
  systemInstruction: string;
  messages: ProviderMessage[];
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputTokens: number;
  /** When set, the provider must return a JSON object that can be validated. */
  responseMimeType?: 'text/plain' | 'application/json';
  responseJsonSchema?: unknown;
}

export interface ProviderProbeRequest {
  apiKey: string;
  endpoint: string;
  signal: AbortSignal;
  timeoutMs: number;
}

export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
}

export interface DiscoveredProviderModel {
  id: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  vision: boolean | null;
  tools: boolean | null;
  json: boolean | null;
}

export type ProviderStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: ProviderUsage }
  | { type: 'done'; finishReason: string | null };

/** Provider implementations are replaceable; routing and storage stay outside them. */
export interface AiProvider {
  readonly id: AiProviderId;
  readonly label: string;
  streamReply(request: ProviderStreamRequest): AsyncGenerator<ProviderStreamEvent>;
  discoverModels(request: ProviderProbeRequest): Promise<DiscoveredProviderModel[]>;
  checkConnection(request: ProviderProbeRequest & { model: string }): Promise<void>;
}

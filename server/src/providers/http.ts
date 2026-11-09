import { ProviderError } from './errors';

export interface SseFrame {
  event: string | null;
  data: string;
}

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Provider HTTP ${status}`);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.body = body.slice(0, 2_000);
  }
}

export async function providerFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const timeout = AbortSignal.timeout(Math.max(1_000, timeoutMs));
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (cause) {
    if (timeout.aborted) throw new ProviderError('PROVIDER_TIMEOUT');
    throw cause;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProviderHttpError(response.status, body);
  }

  return response;
}

/** Parses a text/event-stream response without assuming which fields are present. */
export async function* readSse(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<SseFrame> {
  if (!response.body) throw new ProviderError('PROVIDER_BLOCKED');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | null = null;
  let data: string[] = [];

  const flush = (): SseFrame | null => {
    if (data.length === 0) {
      event = null;
      return null;
    }
    const frame = { event, data: data.join('\n') };
    event = null;
    data = [];
    return frame;
  };

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);

        if (line === '') {
          const frame = flush();
          if (frame) yield frame;
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).trimStart());
        }

        newline = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
      else if (buffer.startsWith('event:')) event = buffer.slice(6).trim();
    }
    const frame = flush();
    if (frame) yield frame;
  } finally {
    reader.releaseLock();
  }
}

export function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function objectOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

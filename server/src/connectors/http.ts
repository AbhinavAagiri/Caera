import { HttpError } from '../middleware/errors';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_ERROR_MESSAGE = 320;

export interface ConnectorHttpOptions {
  baseUrl: string;
  label: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  minIntervalMs?: number;
  maxRateLimitRetries?: number;
  authHint?: string;
}

export interface ConnectorHttpRequest {
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Only enable for idempotent reads. Writes must not be retried blindly. */
  retryOnServerError?: boolean;
}

interface ErrorPayload {
  message?: unknown;
  code?: unknown;
  error?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_MESSAGE);
}

function payloadMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return compact(payload);
  if (typeof payload !== 'object' || payload === null) return fallback;

  const body = payload as ErrorPayload;
  if (typeof body.message === 'string' && body.message.trim()) {
    return compact(body.message);
  }
  if (typeof body.error === 'string' && body.error.trim()) {
    return compact(body.error);
  }
  if (typeof body.error === 'object' && body.error !== null) {
    const nested = body.error as ErrorPayload;
    if (typeof nested.message === 'string' && nested.message.trim()) {
      return compact(nested.message);
    }
  }
  return fallback;
}

function retryAfterMs(headers: Headers, payload: unknown): number {
  const raw = headers.get('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 10_000);
    }
    const date = Date.parse(raw);
    if (Number.isFinite(date)) {
      return Math.min(Math.max(date - Date.now(), 0), 10_000);
    }
  }

  if (typeof payload === 'object' && payload !== null) {
    const body = payload as {
      additional_data?: { retry_after?: unknown };
      retry_after?: unknown;
    };
    const value = body.additional_data?.retry_after ?? body.retry_after;
    const seconds = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 10_000);
    }
  }

  return 1_200;
}

function mapHttpError(
  status: number,
  payload: unknown,
  text: string,
  options: ConnectorHttpOptions,
  waitMs: number,
): HttpError {
  const message = payloadMessage(payload, compact(text) || 'The service rejected the request.');
  const authHint =
    options.authHint ??
    'Open Connections and check the credential for this application, then test the connection again.';

  if (status === 401) {
    return new HttpError(
      401,
      'CONNECTOR_AUTH_FAILED',
      `${options.label} rejected the credential.`,
      authHint,
    );
  }
  if (status === 403) {
    return new HttpError(
      403,
      'CONNECTOR_PERMISSION_DENIED',
      `${options.label} denied access to that resource.`,
      'The credential is valid, but it does not grant access to this item. Grant access in the application itself.',
    );
  }
  if (status === 404 || status === 410) {
    return new HttpError(
      404,
      'CONNECTOR_RESOURCE_NOT_FOUND',
      `${options.label} could not find that resource, or it is not shared with this connection.`,
      'Check the identifier and grant the connection access in the application.',
    );
  }
  if (status === 429) {
    const seconds = Math.max(1, Math.ceil(waitMs / 1_000));
    return new HttpError(
      429,
      'CONNECTOR_RATE_LIMITED',
      `${options.label} rate limited the request.`,
      `Wait about ${seconds} second${seconds === 1 ? '' : 's'} and retry.`,
    );
  }
  if (status === 400 || status === 409 || status === 422) {
    return new HttpError(
      400,
      'CONNECTOR_OPERATION_FAILED',
      `${options.label} rejected the request: ${message}`,
    );
  }
  if (status >= 500) {
    return new HttpError(
      502,
      'CONNECTOR_UPSTREAM_UNAVAILABLE',
      `${options.label} is temporarily unavailable.`,
      'The application returned a server error. Retry the operation shortly.',
    );
  }

  return new HttpError(
    502,
    'CONNECTOR_OPERATION_FAILED',
    `${options.label} returned an unexpected response (${status}).`,
  );
}

/**
 * Small authenticated JSON client used by hosted and local connector APIs.
 * It paces requests, retries only safe rate-limit failures, and never includes
 * credentials in errors. Local endpoints must remain loopback-only.
 */
export class ConnectorHttpClient {
  private readonly baseUrl: string;
  private readonly label: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly maxRateLimitRetries: number;
  private readonly authHint?: string;
  private lastRequestAt = 0;

  constructor(options: ConnectorHttpOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.label = options.label;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.minIntervalMs = options.minIntervalMs ?? 0;
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 2;
    if (options.authHint) this.authHint = options.authHint;
  }

  async request<T>(request: ConnectorHttpRequest): Promise<T> {
    const url = new URL(
      `${this.baseUrl}${request.path.startsWith('/') ? request.path : `/${request.path}`}`,
    );
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let rateLimitAttempts = 0;
    let serverAttempts = 0;

    for (;;) {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();

      let response: Response;
      try {
        response = await fetch(url, {
          method: request.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...this.headers,
          },
          ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
        throw new HttpError(
          502,
          'CONNECTOR_UNREACHABLE',
          timedOut
            ? `${this.label} did not respond in time.`
            : `${this.label} is not reachable.`,
          timedOut
            ? 'The application may be busy. Try again, or check that it is running.'
            : 'Check that the application or local service is running and that its address is correct.',
        );
      }

      const text = await response.text();
      let payload: unknown = null;
      if (text.trim()) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          payload = text;
        }
      }

      if (response.ok) {
        if (!text.trim()) return undefined as T;
        if (typeof payload === 'string') {
          throw new HttpError(
            502,
            'CONNECTOR_OPERATION_FAILED',
            `${this.label} returned a response that was not JSON.`,
          );
        }
        return payload as T;
      }

      const waitMs = retryAfterMs(response.headers, payload);

      if (response.status === 429 && rateLimitAttempts < this.maxRateLimitRetries) {
        rateLimitAttempts += 1;
        await sleep(waitMs);
        continue;
      }

      if (
        request.retryOnServerError &&
        response.status >= 500 &&
        response.status !== 501 &&
        serverAttempts < 1
      ) {
        serverAttempts += 1;
        await sleep(600);
        continue;
      }

      throw mapHttpError(response.status, payload, text, {
        baseUrl: this.baseUrl,
        label: this.label,
        ...(this.authHint ? { authHint: this.authHint } : {}),
      }, waitMs);
    }
  }
}

export function normalizeLoopbackBase(
  raw: string | undefined,
  fallback: string,
  label: string,
): string {
  const value = (raw ?? '').trim() || fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, 'CONNECTOR_CONFIG_INVALID', `${label} must be a valid URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'CONNECTOR_CONFIG_INVALID', `${label} must use http or https.`);
  }
  if (url.username || url.password) {
    throw new HttpError(
      400,
      'CONNECTOR_CONFIG_INVALID',
      `${label} must not contain credentials in the URL.`,
    );
  }

  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
    throw new HttpError(
      400,
      'CONNECTOR_CONFIG_INVALID',
      `${label} must point to a loopback address on this computer.`,
      'CAERA does not send local application tokens to remote hosts.',
    );
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new HttpError(
      400,
      'CONNECTOR_CONFIG_INVALID',
      `${label} must be an origin without a path, query or fragment.`,
    );
  }

  return `${url.protocol}//${url.host}`;
}

export function truncateText(
  value: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, maxChars), truncated: true };
}

export function isoFromUnknown(value: unknown, fallback = 0): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1_000;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(fallback).toISOString();
}

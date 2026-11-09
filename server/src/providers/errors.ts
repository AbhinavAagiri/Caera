import type { ApiErrorBody } from '@shared';

export type ProviderErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_AUTH_ERROR'
  | 'PROVIDER_CONFIG_ERROR'
  | 'PROVIDER_MODEL_NOT_FOUND'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_UNREACHABLE'
  | 'PROVIDER_BLOCKED'
  | 'PROVIDER_ERROR';

interface ErrorDefinition {
  message: string;
  hint?: string;
}

const DEFINITIONS: Record<ProviderErrorCode, ErrorDefinition> = {
  PROVIDER_NOT_CONFIGURED: {
    message: 'No AI provider is configured for this local node.',
    hint: 'Connect a provider in Settings → Models & usage.',
  },
  PROVIDER_AUTH_ERROR: {
    message: 'The AI provider rejected the API key.',
    hint: 'Check or rotate the key in Settings → Models & usage.',
  },
  PROVIDER_CONFIG_ERROR: {
    message: 'The AI provider rejected the request configuration.',
    hint: 'Check the model, endpoint and provider settings, then try again.',
  },
  PROVIDER_MODEL_NOT_FOUND: {
    message: 'The provider could not find the selected model.',
    hint: 'Choose a model returned by that provider, or test the connection again.',
  },
  PROVIDER_RATE_LIMITED: {
    message: 'The provider reported a rate limit or quota limit.',
    hint: 'Wait and retry, review your provider plan, or choose another configured model.',
  },
  PROVIDER_TIMEOUT: {
    message: 'The AI provider did not finish before the local timeout.',
    hint: 'Try a shorter prompt or retry. The timeout is configurable with CAERA_PROVIDER_TIMEOUT_MS.',
  },
  PROVIDER_UNAVAILABLE: {
    message: 'The AI provider is temporarily unavailable.',
    hint: 'This is an upstream service problem. Retry in a moment.',
  },
  PROVIDER_UNREACHABLE: {
    message: 'The local node could not reach the AI provider.',
    hint: 'Check this machine’s connection and the provider endpoint, then retry.',
  },
  PROVIDER_BLOCKED: {
    message: 'The provider did not return a text reply.',
    hint: 'The prompt may have been blocked by the provider. Try a different prompt.',
  },
  PROVIDER_ERROR: {
    message: 'The AI provider could not complete the reply.',
    hint: 'Try again. The prompt was not retried automatically.',
  },
};

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly hint?: string;
  readonly httpStatus?: number;

  constructor(
    code: ProviderErrorCode,
    options: { message?: string; hint?: string; httpStatus?: number } = {},
  ) {
    const definition = DEFINITIONS[code];
    super(options.message ?? definition.message);
    this.name = 'ProviderError';
    this.code = code;
    this.hint = options.hint ?? definition.hint;
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
  }

  toApiErrorBody(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
    };
  }
}

function readStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    error?: { code?: unknown };
    cause?: { code?: unknown };
  };

  const values = [
    candidate.status,
    candidate.statusCode,
    candidate.code,
    candidate.error?.code,
    candidate.cause?.code,
  ];

  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value < 600) {
      return value;
    }
  }

  return null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

function bodyOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('body' in error)) return '';
  const body = (error as { body?: unknown }).body;
  return typeof body === 'string' ? body.toLowerCase() : '';
}

/**
 * Converts provider/SDK failures into safe, stable messages. Raw SDK messages
 * are used only for classification and are never returned or logged.
 */
export function normalizeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const status = readStatus(error);
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name)
    : '';
  const raw = messageOf(error);
  const normalized = `${raw} ${bodyOf(error)}`.toLowerCase();

  if (name === 'AbortError' || normalized.includes('aborted') || normalized.includes('timeout')) {
    return new ProviderError('PROVIDER_TIMEOUT', { httpStatus: status ?? undefined });
  }

  if (
    status === 401 ||
    status === 403 ||
    (status === 400 && (normalized.includes('api key') || normalized.includes('api_key')))
  ) {
    return new ProviderError('PROVIDER_AUTH_ERROR', { httpStatus: status ?? undefined });
  }

  if (status === 404) {
    return new ProviderError('PROVIDER_MODEL_NOT_FOUND', { httpStatus: 404 });
  }

  if (status === 429) {
    return new ProviderError('PROVIDER_RATE_LIMITED', { httpStatus: 429 });
  }

  if (status === 408) {
    return new ProviderError('PROVIDER_TIMEOUT', { httpStatus: 408 });
  }

  if (status !== null && status >= 500) {
    return new ProviderError('PROVIDER_UNAVAILABLE', { httpStatus: status });
  }

  if (status === 400) {
    return new ProviderError('PROVIDER_CONFIG_ERROR', { httpStatus: 400 });
  }

  if (
    normalized.includes('fetch failed') ||
    normalized.includes('enotfound') ||
    normalized.includes('econnrefused') ||
    normalized.includes('econnreset') ||
    normalized.includes('network') ||
    normalized.includes('socket')
  ) {
    return new ProviderError('PROVIDER_UNREACHABLE');
  }

  return new ProviderError('PROVIDER_ERROR', { httpStatus: status ?? undefined });
}

import type {
  ProviderConfigInput,
  ProviderConfiguration,
  ProviderSettingsResult,
  ProviderStatus,
} from '@shared';
import { env } from '../config/env';
import { ProviderError, normalizeProviderError, type ProviderErrorCode } from '../providers/errors';
import { GeminiProvider } from '../providers/geminiProvider';
import type { AiProvider } from '../providers/types';
import { publish } from './eventBus';
import { logger } from './logger';
import {
  removeStoredProviderKey as removeStoredKey,
  resolveProviderConfig,
  toPublicProviderConfiguration,
  updateStoredProviderConfig,
} from './providerConfigService';

interface ProviderFailure {
  code: ProviderErrorCode;
  message: string;
  hint?: string;
  at: string;
}

interface ProviderRuntime {
  lastSuccessAt: string | null;
  lastCheckedAt: string | null;
  lastFailure: ProviderFailure | null;
}

const provider: AiProvider = new GeminiProvider();
const runtime: ProviderRuntime = {
  lastSuccessAt: null,
  lastCheckedAt: null,
  lastFailure: null,
};

function resetRuntime(): void {
  runtime.lastSuccessAt = null;
  runtime.lastCheckedAt = null;
  runtime.lastFailure = null;
}

function sourceLabel(source: ProviderStatus['keySource']): string {
  if (source === 'settings') return 'Settings → Models & usage';
  if (source === 'environment') return 'server/.env';
  return 'nowhere';
}

export function getAiProvider(): AiProvider {
  return provider;
}

export function getProviderConfiguration(): ProviderConfiguration {
  return toPublicProviderConfiguration(resolveProviderConfig());
}

export function getProviderStatus(): ProviderStatus {
  const config = resolveProviderConfig();
  const configured = Boolean(config.apiKey);

  let state: ProviderStatus['state'];
  let detail: string;

  if (!configured) {
    state = 'not-configured';
    detail =
      'No Gemini key is configured. Add one in Settings → Models & usage, or set GEMINI_API_KEY in server/.env.';
  } else if (runtime.lastFailure) {
    state = 'error';
    detail = runtime.lastFailure.message;
  } else if (runtime.lastSuccessAt) {
    state = 'connected';
    detail = `Gemini answered successfully with ${config.model}.`;
  } else {
    state = 'configured';
    detail = `Key loaded from ${sourceLabel(config.keySource)}. Send a message or run a connection check.`;
  }

  return {
    id: 'gemini',
    label: env.provider.label,
    state,
    model: config.model,
    endpoint: env.provider.endpoint,
    detail,
    requiredEnvVars: ['GEMINI_API_KEY'],
    keySource: config.keySource,
    hasStoredKey: config.hasStoredKey,
    checkedAt: runtime.lastCheckedAt ?? new Date().toISOString(),
  };
}

export function getProviderSettings(): ProviderSettingsResult {
  return {
    provider: getProviderStatus(),
    configuration: getProviderConfiguration(),
  };
}

export function recordProviderSuccess(): void {
  const now = new Date().toISOString();
  runtime.lastSuccessAt = now;
  runtime.lastCheckedAt = now;
  runtime.lastFailure = null;
}

export function recordProviderFailure(error: ProviderError): void {
  const now = new Date().toISOString();
  runtime.lastCheckedAt = now;
  runtime.lastFailure = {
    code: error.code,
    message: error.message,
    ...(error.hint ? { hint: error.hint } : {}),
    at: now,
  };
}

export async function checkProvider(): Promise<ProviderStatus> {
  const config = resolveProviderConfig();
  runtime.lastCheckedAt = new Date().toISOString();

  if (!config.apiKey) {
    runtime.lastSuccessAt = null;
    runtime.lastFailure = null;
    publish({
      kind: 'provider',
      status: 'info',
      summary: 'Provider check: no key configured',
      detail: 'Add a key in Settings → Models & usage. Nothing was sent to Gemini.',
      meta: { provider: 'gemini' },
    });
    return getProviderStatus();
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, env.provider.checkTimeoutMs);
  timer.unref();

  try {
    await provider.checkConnection({
      apiKey: config.apiKey,
      endpoint: env.provider.endpoint,
      model: config.model,
      signal: controller.signal,
      timeoutMs: env.provider.checkTimeoutMs,
    });

    recordProviderSuccess();
    publish({
      kind: 'provider',
      status: 'completed',
      summary: 'Gemini connection verified',
      detail: `Model lookup succeeded · ${config.model}`,
      meta: { provider: 'gemini', model: config.model },
    });
  } catch (cause) {
    const error = timedOut ? new ProviderError('PROVIDER_TIMEOUT') : normalizeProviderError(cause);
    recordProviderFailure(error);

    logger.warn('provider_check_failed', {
      code: error.code,
      httpStatus: error.httpStatus ?? null,
    });
    publish({
      kind: 'provider',
      status: 'failed',
      summary: 'Gemini connection check failed',
      detail: error.message,
      meta: { provider: 'gemini', model: config.model, code: error.code },
    });
  } finally {
    clearTimeout(timer);
    runtime.lastCheckedAt = new Date().toISOString();
  }

  return getProviderStatus();
}

export function updateProviderSettings(input: ProviderConfigInput): ProviderSettingsResult {
  const config = updateStoredProviderConfig(input);
  resetRuntime();

  publish({
    kind: 'provider',
    status: 'completed',
    summary: 'Provider settings updated',
    detail: `Gemini · ${config.model} · key ${config.apiKey ? 'configured' : 'not configured'}`,
    meta: { provider: 'gemini', model: config.model },
  });

  return {
    provider: getProviderStatus(),
    configuration: toPublicProviderConfiguration(config),
  };
}

export function removeProviderKey(): ProviderSettingsResult {
  const config = removeStoredKey();
  resetRuntime();

  publish({
    kind: 'provider',
    status: 'info',
    summary: 'Saved provider key removed',
    detail: config.apiKey
      ? 'The environment key remains available.'
      : 'No Gemini key is configured.',
    meta: { provider: 'gemini' },
  });

  return {
    provider: getProviderStatus(),
    configuration: toPublicProviderConfiguration(config),
  };
}

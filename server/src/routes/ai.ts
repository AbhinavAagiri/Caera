import { Router } from 'express';
import type { AiProviderId, AiSettingsInput, AiRouteRequest, UsageMode } from '@shared';
import { env } from '../config/env';
import { sendOk } from '../lib/http';
import { isRecord } from '../lib/validate';
import { HttpError } from '../middleware/errors';
import {
  assertProviderId,
  getAiSnapshot,
  previewAiRoute,
  refreshProviderModels,
  removeProviderCredential,
  saveProviderCredential,
  updateAiSettings,
} from '../ai/aiService';
import { RouteError } from '../ai/router';

export const aiRouter = Router();

function routeError(cause: unknown): never {
  if (cause instanceof RouteError) {
    throw new HttpError(
      cause.code === 'AI_SPENDING_CONFIRMATION_REQUIRED' ? 409 : 409,
      cause.code,
      cause.message,
      cause.hint,
    );
  }
  if (cause instanceof Error) {
    throw new HttpError(500, 'INTERNAL_ERROR', cause.message);
  }
  throw new HttpError(500, 'INTERNAL_ERROR', 'The model service failed.');
}

function providerId(value: string): AiProviderId {
  try {
    return assertProviderId(value);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Unknown AI provider.');
  }
}

function optionalMode(value: unknown): UsageMode | undefined {
  return value === 'economy' || value === 'balanced' || value === 'maximum' ? value : undefined;
}

function failedOrBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

aiRouter.get('/', (_req, res) => {
  sendOk(res, getAiSnapshot());
});

aiRouter.put('/settings', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const mode = optionalMode(body.mode);
  const defaultModel =
    body.defaultModel === null
      ? null
      : typeof body.defaultModel === 'string'
        ? body.defaultModel
        : undefined;
  const autoPreferredModel =
    body.autoPreferredModel === null
      ? null
      : typeof body.autoPreferredModel === 'string'
        ? body.autoPreferredModel
        : undefined;
  const preferredProviders = Array.isArray(body.preferredProviders)
    ? body.preferredProviders.filter((value): value is AiProviderId =>
        ['gemini', 'openai', 'anthropic', 'deepseek', 'ollama'].includes(String(value)),
      )
    : undefined;
  const excludedModels = Array.isArray(body.excludedModels)
    ? body.excludedModels.filter((value): value is string => typeof value === 'string')
    : undefined;
  const fallbackEnabled = failedOrBoolean(body.fallbackEnabled);
  const dailyLimitUsd =
    body.dailyLimitUsd === null
      ? null
      : typeof body.dailyLimitUsd === 'number'
        ? body.dailyLimitUsd
        : undefined;
  const monthlyLimitUsd =
    body.monthlyLimitUsd === null
      ? null
      : typeof body.monthlyLimitUsd === 'number'
        ? body.monthlyLimitUsd
        : undefined;

  if (
    (body.dailyLimitUsd !== undefined && dailyLimitUsd === undefined) ||
    (body.monthlyLimitUsd !== undefined && monthlyLimitUsd === undefined) ||
    (typeof dailyLimitUsd === 'number' &&
      (!Number.isFinite(dailyLimitUsd) || dailyLimitUsd < 0 || dailyLimitUsd > 100_000)) ||
    (typeof monthlyLimitUsd === 'number' &&
      (!Number.isFinite(monthlyLimitUsd) || monthlyLimitUsd < 0 || monthlyLimitUsd > 100_000))
  ) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Spending limits must be null or a number between 0 and 100000.',
    );
  }

  const input: AiSettingsInput = {
    ...(mode ? { mode } : {}),
    ...(defaultModel !== undefined ? { defaultModel } : {}),
    ...(autoPreferredModel !== undefined ? { autoPreferredModel } : {}),
    ...(preferredProviders ? { preferredProviders } : {}),
    ...(excludedModels ? { excludedModels } : {}),
    ...(fallbackEnabled !== undefined ? { fallbackEnabled } : {}),
    ...(dailyLimitUsd !== undefined ? { dailyLimitUsd } : {}),
    ...(monthlyLimitUsd !== undefined ? { monthlyLimitUsd } : {}),
    ...(body.confirmSpendingChange === true ? { confirmSpendingChange: true } : {}),
  };

  try {
    sendOk(res, { settings: updateAiSettings(input), snapshot: getAiSnapshot() });
  } catch (cause) {
    routeError(cause);
  }
});

aiRouter.put('/providers/:id/credential', async (req, res) => {
  const id = providerId(req.params.id);
  const body = isRecord(req.body) ? req.body : {};
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined;
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : undefined;

  if (apiKey && (apiKey.length < 20 || apiKey.length > 500 || /\s/.test(apiKey))) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'The API key is not in a recognized format.',
      'Paste the complete key without spaces or quotes.',
    );
  }

  if (id !== 'ollama' && !apiKey) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'An API key is required for this provider.');
  }
  if (id === 'ollama' && !endpoint) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'A loopback Ollama endpoint is required.');
  }

  try {
    sendOk(
      res,
      await saveProviderCredential(id, {
        ...(apiKey ? { apiKey } : {}),
        ...(endpoint ? { endpoint } : {}),
      }),
    );
  } catch (cause) {
    routeError(cause);
  }
});

aiRouter.delete('/providers/:id/credential', (req, res) => {
  const id = providerId(req.params.id);
  try {
    sendOk(res, removeProviderCredential(id));
  } catch (cause) {
    routeError(cause);
  }
});

aiRouter.post('/providers/:id/test', async (req, res) => {
  const id = providerId(req.params.id);
  try {
    const provider = await refreshProviderModels(id);
    sendOk(res, { provider, snapshot: getAiSnapshot() });
  } catch (cause) {
    routeError(cause);
  }
});

aiRouter.post('/route/preview', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (typeof body.content !== 'string' || !body.content.trim()) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'content is required.');
  }
  if (body.content.length > env.limits.messageChars) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'content is too long.');
  }

  const request: AiRouteRequest = {
    content: body.content,
    ...(typeof body.overrideModel === 'string' ? { overrideModel: body.overrideModel } : {}),
    ...(optionalMode(body.mode) ? { mode: optionalMode(body.mode) } : {}),
  };
  sendOk(res, previewAiRoute(request));
});

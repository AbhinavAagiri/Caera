import type {
  AiModel,
  AiProviderId,
  AiProviderSnapshot,
  AiRouteRequest,
  AiSettings,
  AiSettingsInput,
  AiSnapshot,
  AiUsageRecord as UsageRecord,
  ModelRoute,
  ProviderStatus,
  RoutePreview,
  SpendingSummary,
} from '@shared';
import { env } from '../config/env';
import { ProviderError, normalizeProviderError } from '../providers/errors';
import { AnthropicProvider } from '../providers/anthropicProvider';
import { GeminiProvider, isChatCapableGeminiModel } from '../providers/geminiProvider';
import { OpenAiCompatibleProvider } from '../providers/openaiCompatible';
import type { AiProvider, DiscoveredProviderModel } from '../providers/types';
import { resolveProviderConfig } from '../services/providerConfigService';
import { publish } from '../services/eventBus';
import { logger } from '../services/logger';
import { classifyTask, type TaskClassification } from './classifier';
import {
  PROVIDER_DESCRIPTIONS,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  curatedFor,
  discoveredModel,
} from './registry';
import {
  affordable,
  estimateCost,
  isAutoVerified,
  routeTask,
  RouteError,
} from './router';
import { DEFAULT_AI_SETTINGS, readAiSettings, writeAiSettings } from './settings';
import {
  providerAccess,
  removeProviderAccess,
  saveProviderAccess,
  saveProviderDiscovery,
  saveProviderFailure,
  type ProviderAccess,
} from './providerStore';
import { insertUsage, listUsage, spendingSummary } from './usageRepository';

const adapters: Record<AiProviderId, AiProvider> = {
  gemini: new GeminiProvider(),
  openai: new OpenAiCompatibleProvider({ id: 'openai', label: 'OpenAI', requiresKey: true }),
  anthropic: new AnthropicProvider(),
  deepseek: new OpenAiCompatibleProvider({
    id: 'deepseek',
    label: 'DeepSeek',
    requiresKey: true,
  }),
  ollama: new OpenAiCompatibleProvider({
    id: 'ollama',
    label: 'Ollama',
    requiresKey: false,
  }),
};

function adapterFor(provider: AiProviderId): AiProvider {
  return adapters[provider];
}

function defaultModelFor(provider: AiProviderId, access: ProviderAccess): string | null {
  if (provider === 'gemini') return resolveProviderConfig().model;
  if (provider === 'openai') return env.ai.defaults.openai;
  if (provider === 'anthropic') return env.ai.defaults.anthropic;
  if (provider === 'deepseek') return env.ai.defaults.deepseek;
  return access.discovered[0]?.id ?? null;
}

function mergeMetadata(model: AiModel, discovered: DiscoveredProviderModel | undefined): AiModel {
  const known = curatedFor(model.provider, model.id);
  if (!known) return model;
  if (!discovered) return { ...known, availability: model.availability, source: model.source };

  return {
    ...known,
    availability: model.availability,
    source: model.source,
    contextWindow: discovered.contextWindow ?? known.contextWindow,
    maxOutputTokens: discovered.maxOutputTokens ?? known.maxOutputTokens,
    capabilities: {
      streaming: known.capabilities.streaming,
      vision: discovered.vision ?? known.capabilities.vision,
      tools: discovered.tools ?? known.capabilities.tools,
      json: discovered.json ?? known.capabilities.json,
    },
  };
}

function modelsForProvider(provider: AiProviderId, access: ProviderAccess): AiModel[] {
  if (!access.configured) return [];

  const discovered =
    provider === 'gemini'
      ? access.discovered.filter((entry) => isChatCapableGeminiModel(entry.id))
      : access.discovered;
  if (discovered.length > 0) {
    return discovered.map((entry) => {
      const base = discoveredModel(provider, entry.id, entry.displayName);
      return mergeMetadata(
        {
          ...base,
          contextWindow: entry.contextWindow ?? base.contextWindow,
          maxOutputTokens: entry.maxOutputTokens ?? base.maxOutputTokens,
          capabilities: {
            streaming: base.capabilities.streaming,
            vision: entry.vision ?? base.capabilities.vision,
            tools: entry.tools ?? base.capabilities.tools,
            json: entry.json ?? base.capabilities.json,
          },
        },
        entry,
      );
    });
  }

  const defaultId = defaultModelFor(provider, access);
  if (!defaultId) return [];
  const base = discoveredModel(provider, defaultId);
  return [
    mergeMetadata(
      {
        ...base,
        // A configured default is exercised by the first reply or connection
        // test; until then its presence is a registry entry, not a live probe.
        capabilities: { ...base.capabilities },
      },
      undefined,
    ),
  ];
}

function providerSnapshot(provider: AiProviderId): AiProviderSnapshot {
  const access = providerAccess(provider);
  const models = modelsForProvider(provider, access);
  let state: AiProviderSnapshot['state'];
  let detail: string;

  if (!access.configured) {
    state = 'not-configured';
    detail =
      provider === 'ollama'
        ? 'Save the loopback Ollama endpoint to make local models available.'
        : `No ${PROVIDER_LABELS[provider]} credential is configured.`;
  } else if (access.lastError) {
    state = 'error';
    detail = access.lastError;
  } else if (access.lastCheckedAt) {
    state = 'connected';
    detail = `${models.length} ${models.length === 1 ? 'model' : 'models'} discovered.`;
  } else {
    state = 'configured';
    detail =
      provider === 'ollama'
        ? 'Local endpoint saved. Run a connection test to discover models.'
        : `Credential loaded from ${access.keySource === 'environment' ? 'the node environment' : 'this device'}. Test the connection or send a message.`;
  }

  return {
    id: provider,
    label: PROVIDER_LABELS[provider],
    description: PROVIDER_DESCRIPTIONS[provider],
    state,
    configured: access.configured,
    requiresKey: provider !== 'ollama',
    keySource: access.keySource,
    hasStoredKey: access.hasStoredKey,
    endpoint: access.endpoint,
    detail,
    lastCheckedAt: access.lastCheckedAt,
    models,
    discoveryError: access.lastError,
  };
}

function mergedSpending(settings: AiSettings): SpendingSummary {
  const summary = spendingSummary();
  return {
    ...summary,
    dailyLimitUsd: settings.dailyLimitUsd,
    monthlyLimitUsd: settings.monthlyLimitUsd,
  };
}

export function getAiSnapshot(): AiSnapshot {
  const settings = readAiSettings();
  const providers = PROVIDER_IDS.map(providerSnapshot);
  const providerConfig = resolveProviderConfig();
  return {
    providers,
    models: providers.flatMap((provider) => provider.models),
    settings,
    spending: mergedSpending(settings),
    usage: listUsage(30),
    systemInstruction: providerConfig.systemInstruction,
    defaultSystemInstruction: providerConfig.defaultSystemInstruction,
    timeoutMs: providerConfig.timeoutMs,
    maxOutputTokens: providerConfig.maxOutputTokens,
  };
}

export function getAvailableModels(): AiModel[] {
  return getAiSnapshot().models;
}

export function hasUsableModel(): boolean {
  return getAvailableModels().length > 0;
}

export function primaryProviderStatus(): ProviderStatus {
  const settings = readAiSettings();
  const snapshot = getAiSnapshot();
  const preferredRef = settings.defaultModel ?? settings.autoPreferredModel;
  const preferred = preferredRef
    ? snapshot.providers.find((provider) =>
        provider.models.some((model) => model.ref === preferredRef),
      )
    : undefined;
  const selected =
    preferred ??
    snapshot.providers.find((provider) => provider.models.length > 0) ??
    snapshot.providers.find((provider) => provider.configured);

  if (!selected) {
    return {
      id: 'none',
      label: 'No model provider',
      state: 'not-configured',
      model: null,
      endpoint: null,
      detail: 'Connect a provider in Settings → Models & usage.',
      requiredEnvVars: [],
      keySource: 'none',
      hasStoredKey: false,
      checkedAt: new Date().toISOString(),
    };
  }

  const chosenModel =
    (preferredRef
      ? selected.models.find((model) => model.ref === preferredRef)
      : undefined) ??
    selected.models[0];

  return {
    id: selected.id,
    label: selected.label,
    state: selected.state,
    model: chosenModel?.id ?? null,
    endpoint: selected.endpoint,
    detail: selected.detail,
    requiredEnvVars: providerEnvVars(selected.id),
    keySource: selected.keySource,
    hasStoredKey: selected.hasStoredKey,
    checkedAt: selected.lastCheckedAt ?? new Date().toISOString(),
  };
}

function providerEnvVars(provider: AiProviderId): string[] {
  if (provider === 'gemini') return ['GEMINI_API_KEY'];
  if (provider === 'openai') return ['OPENAI_API_KEY'];
  if (provider === 'anthropic') return ['ANTHROPIC_API_KEY'];
  if (provider === 'deepseek') return ['DEEPSEEK_API_KEY'];
  return ['OLLAMA_URL'];
}

export async function refreshProviderModels(provider: AiProviderId): Promise<AiProviderSnapshot> {
  const access = providerAccess(provider);
  if (!access.configured) {
    throw new RouteError('AI_MODEL_UNAVAILABLE', `${PROVIDER_LABELS[provider]} is not configured.`);
  }

  const controller = new AbortController();
  try {
    const discovered = await adapterFor(provider).discoverModels({
      apiKey: access.apiKey,
      endpoint: access.endpoint,
      signal: controller.signal,
      timeoutMs: env.ai.checkTimeoutMs,
    });
    saveProviderDiscovery(
      provider,
      discovered.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        vision: model.vision,
        tools: model.tools,
        json: model.json,
      })),
    );
    publish({
      kind: 'provider',
      status: 'completed',
      summary: `${PROVIDER_LABELS[provider]} connected`,
      detail: `${discovered.length} ${discovered.length === 1 ? 'model' : 'models'} discovered. No prompt was sent.`,
      meta: { provider },
    });
    return providerSnapshot(provider);
  } catch (cause) {
    const error = normalizeProviderError(cause);
    saveProviderFailure(provider, error.message);
    logger.warn('ai_provider_test_failed', {
      provider,
      code: error.code,
      httpStatus: error.httpStatus ?? null,
    });
    publish({
      kind: 'provider',
      status: 'failed',
      summary: `${PROVIDER_LABELS[provider]} connection check failed`,
      detail: error.message,
      meta: { provider, code: error.code },
    });
    return providerSnapshot(provider);
  }
}

export async function saveProviderCredential(
  provider: AiProviderId,
  input: { apiKey?: string; endpoint?: string },
): Promise<AiSnapshot> {
  try {
    saveProviderAccess(provider, input);
  } catch (cause) {
    throw new RouteError(
      'AI_MODEL_UNAVAILABLE',
      cause instanceof Error ? cause.message : 'The provider credential could not be saved.',
    );
  }

  publish({
    kind: 'provider',
    status: 'completed',
    summary: `${PROVIDER_LABELS[provider]} configuration saved`,
    detail: 'Credential is stored server-side. A model discovery check will run next.',
    meta: { provider },
  });
  await refreshProviderModels(provider);
  return getAiSnapshot();
}

export function removeProviderCredential(provider: AiProviderId): AiSnapshot {
  removeProviderAccess(provider);
  const settings = readAiSettings();
  const clearsDefault = settings.defaultModel?.startsWith(`${provider}/`) === true;
  const clearsAutomatic = settings.autoPreferredModel?.startsWith(`${provider}/`) === true;
  if (clearsDefault || clearsAutomatic) {
    writeAiSettings({
      ...settings,
      ...(clearsDefault ? { defaultModel: null } : {}),
      ...(clearsAutomatic ? { autoPreferredModel: null } : {}),
    });
  }
  publish({
    kind: 'provider',
    status: 'info',
    summary: `${PROVIDER_LABELS[provider]} disconnected`,
    detail: 'The saved key and discovered model list were removed.',
    meta: { provider },
  });
  return getAiSnapshot();
}

function assertProvider(value: string): asserts value is AiProviderId {
  if (!PROVIDER_IDS.includes(value as AiProviderId)) {
    throw new RouteError('AI_MODEL_UNAVAILABLE', 'Unknown AI provider.');
  }
}

export function assertProviderId(value: string): AiProviderId {
  assertProvider(value);
  return value;
}

export function updateAiSettings(input: AiSettingsInput): AiSettings {
  const current = readAiSettings();
  const next: AiSettings = {
    ...DEFAULT_AI_SETTINGS,
    ...current,
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
    ...(input.autoPreferredModel !== undefined
      ? { autoPreferredModel: input.autoPreferredModel }
      : {}),
    ...(input.preferredProviders !== undefined
      ? { preferredProviders: input.preferredProviders }
      : {}),
    ...(input.excludedModels !== undefined ? { excludedModels: input.excludedModels } : {}),
    ...(input.fallbackEnabled !== undefined ? { fallbackEnabled: input.fallbackEnabled } : {}),
    ...(input.dailyLimitUsd !== undefined ? { dailyLimitUsd: input.dailyLimitUsd } : {}),
    ...(input.monthlyLimitUsd !== undefined ? { monthlyLimitUsd: input.monthlyLimitUsd } : {}),
  };

  const availableModels = getAvailableModels();
  if (
    next.defaultModel !== null &&
    !availableModels.some((model) => model.ref === next.defaultModel)
  ) {
    throw new RouteError(
      'AI_MODEL_UNAVAILABLE',
      'The default model is not available from a connected provider.',
      'Connect its provider or choose Auto or another verified model.',
    );
  }

  if (
    input.autoPreferredModel !== undefined &&
    next.autoPreferredModel !== null &&
    next.autoPreferredModel !== current.autoPreferredModel
  ) {
    const candidate = availableModels.find((model) => model.ref === next.autoPreferredModel);
    if (!candidate || !isAutoVerified(candidate)) {
      throw new RouteError(
        'AI_MODEL_UNAVAILABLE',
        'The automatic preference is not a verified model from a connected provider.',
        'Choose a curated model with verified streaming support, or turn the preference off.',
      );
    }
  }

  if (next.dailyLimitUsd !== current.dailyLimitUsd || next.monthlyLimitUsd !== current.monthlyLimitUsd) {
    if (input.confirmSpendingChange !== true) {
      throw new RouteError(
        'AI_SPENDING_CONFIRMATION_REQUIRED',
        'Changing spending limits needs explicit confirmation.',
        'Confirm the new daily or monthly limit in Models & usage before saving.',
      );
    }
  }

  writeAiSettings(next);
  publish({
    kind: 'provider',
    status: 'completed',
    summary: 'Model routing preferences updated',
    detail: `${next.mode} mode · ${next.defaultModel ? 'default model set' : 'automatic selection'}`,
  });
  return next;
}

export function previewAiRoute(request: AiRouteRequest): RoutePreview {
  const classification = classifyTask(request.content);
  try {
    const snapshot = getAiSnapshot();
    const route = routeTask({
      request,
      classification,
      models: snapshot.models,
      settings: snapshot.settings,
      spending: snapshot.spending,
      maxOutputTokens: snapshot.maxOutputTokens,
    });
    return {
      route,
      error: null,
      category: classification.category,
      complexity: classification.complexity,
    };
  } catch (cause) {
    return {
      route: null,
      error: cause instanceof Error ? cause.message : 'No route is available.',
      category: classification.category,
      complexity: classification.complexity,
    };
  }
}

export function resolveChatRoute(
  request: AiRouteRequest,
  classification?: TaskClassification,
): ModelRoute {
  const snapshot = getAiSnapshot();
  return routeTask({
    request,
    classification: classification ?? classifyTask(request.content),
    models: snapshot.models,
    settings: snapshot.settings,
    spending: snapshot.spending,
    maxOutputTokens: snapshot.maxOutputTokens,
  });
}

export function getRouteContext(): {
  settings: AiSettings;
  spending: SpendingSummary;
  models: AiModel[];
  maxOutputTokens: number;
  timeoutMs: number;
} {
  const snapshot = getAiSnapshot();
  return {
    settings: snapshot.settings,
    spending: snapshot.spending,
    models: snapshot.models,
    maxOutputTokens: snapshot.maxOutputTokens,
    timeoutMs: snapshot.timeoutMs,
  };
}

export function recordAiUsage(input: Parameters<typeof insertUsage>[0]): UsageRecord {
  return insertUsage(input);
}

export function estimateModelCost(
  model: AiModel,
  inputTokens: number | null,
  outputTokens: number | null,
  cachedTokens: number | null,
): number | null {
  return estimateCost(model, inputTokens, outputTokens, cachedTokens);
}

export function isModelAffordable(
  model: AiModel,
  content: string,
  maxOutputTokens: number,
): boolean {
  const context = getRouteContext();
  return affordable(model, context.settings, context.spending, Buffer.byteLength(content), maxOutputTokens).ok;
}

export function providerErrorForTest(cause: unknown): ProviderError {
  return normalizeProviderError(cause);
}

export function serviceAdapter(provider: AiProviderId): AiProvider {
  return adapters[provider];
}

export { adapters };

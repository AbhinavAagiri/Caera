import type { AiProviderId, AiSettings, UsageMode } from '@shared';
import { getSetting, setSetting } from '../db/repositories/settings';
import { PROVIDER_IDS } from './registry';

const SETTINGS_KEY = 'ai.settings.v1';

/**
 * The known-good automatic primary. It is deliberately a setting rather than a
 * router constant: the operator can change it without a code change, and the
 * router still applies every verification, capability and budget check.
 */
export const DEFAULT_AUTO_PREFERRED_MODEL = 'gemini/gemini-3.6-flash';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  mode: 'balanced',
  defaultModel: null,
  autoPreferredModel: DEFAULT_AUTO_PREFERRED_MODEL,
  preferredProviders: [],
  excludedModels: [],
  fallbackEnabled: false,
  dailyLimitUsd: null,
  monthlyLimitUsd: null,
};

function isProvider(value: unknown): value is AiProviderId {
  return typeof value === 'string' && PROVIDER_IDS.includes(value as AiProviderId);
}

function limit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function modelRef(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  const ref = value.trim();
  if (!/^[a-z]+\/[a-zA-Z0-9._:/-]{1,160}$/.test(ref)) return null;
  return ref;
}

export function readAiSettings(): AiSettings {
  const raw = getSetting(SETTINGS_KEY);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_AI_SETTINGS;
  const value = raw as Record<string, unknown>;

  const mode: UsageMode =
    value.mode === 'economy' || value.mode === 'maximum' ? value.mode : 'balanced';

  const autoPreferredModel = Object.prototype.hasOwnProperty.call(value, 'autoPreferredModel')
    ? modelRef(value.autoPreferredModel)
    : DEFAULT_AUTO_PREFERRED_MODEL;

  return {
    mode,
    defaultModel: modelRef(value.defaultModel),
    autoPreferredModel,
    preferredProviders: stringList(value.preferredProviders).filter(isProvider),
    excludedModels: stringList(value.excludedModels),
    fallbackEnabled: value.fallbackEnabled === true,
    dailyLimitUsd: limit(value.dailyLimitUsd),
    monthlyLimitUsd: limit(value.monthlyLimitUsd),
  };
}

export function writeAiSettings(settings: AiSettings): AiSettings {
  setSetting(SETTINGS_KEY, settings);
  return settings;
}

export function parseModelRef(ref: string): { provider: AiProviderId; model: string } | null {
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) return null;
  const provider = ref.slice(0, slash);
  const model = ref.slice(slash + 1);
  if (!isProvider(provider) || !/^[a-zA-Z0-9._:/-]{1,160}$/.test(model)) return null;
  return { provider, model };
}

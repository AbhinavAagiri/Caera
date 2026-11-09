import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AiProviderId, ProviderKeySource } from '@shared';
import { env } from '../config/env';
import {
  removeStoredProviderKey,
  resolveProviderConfig,
  updateStoredProviderConfig,
} from '../services/providerConfigService';
import { logger } from '../services/logger';
import { PROVIDER_IDS } from './registry';

interface StoredDiscovery {
  id: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  vision: boolean | null;
  tools: boolean | null;
  json: boolean | null;
}

interface StoredProvider {
  apiKey?: string;
  endpoint?: string;
  enabled?: boolean;
  discovered?: StoredDiscovery[];
  lastCheckedAt?: string;
  lastError?: string;
}

interface ProviderFile {
  version: 1;
  updatedAt: string;
  providers: Partial<Record<AiProviderId, StoredProvider>>;
}

export interface ProviderAccess {
  provider: AiProviderId;
  apiKey: string;
  keySource: ProviderKeySource;
  hasStoredKey: boolean;
  endpoint: string;
  configured: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  discovered: StoredDiscovery[];
}

const file = path.join(env.dataDir, 'ai-providers.json');
let loaded = false;
let cache: ProviderFile = {
  version: 1,
  updatedAt: new Date().toISOString(),
  providers: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (key.length < 20 || key.length > 500 || /\s/.test(key)) return null;
  return key;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sanitizeDiscovery(value: unknown): StoredDiscovery[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): StoredDiscovery | null => {
      if (!isRecord(entry) || typeof entry.id !== 'string') return null;
      return {
        id: entry.id.slice(0, 200),
        displayName:
          typeof entry.displayName === 'string' ? entry.displayName.slice(0, 200) : entry.id,
        contextWindow:
          typeof entry.contextWindow === 'number' && entry.contextWindow > 0
            ? Math.floor(entry.contextWindow)
            : null,
        maxOutputTokens:
          typeof entry.maxOutputTokens === 'number' && entry.maxOutputTokens > 0
            ? Math.floor(entry.maxOutputTokens)
            : null,
        vision: typeof entry.vision === 'boolean' ? entry.vision : null,
        tools: typeof entry.tools === 'boolean' ? entry.tools : null,
        json: typeof entry.json === 'boolean' ? entry.json : null,
      };
    })
    .filter((entry): entry is StoredDiscovery => entry !== null)
    .slice(0, 500);
}

function readFile(): ProviderFile {
  if (loaded) return cache;
  loaded = true;

  if (!existsSync(file)) return cache;

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.providers)) return cache;

    const providers: ProviderFile['providers'] = {};
    for (const id of PROVIDER_IDS) {
      const raw = parsed.providers[id];
      if (!isRecord(raw)) continue;
      const apiKey = validKey(raw.apiKey);
      providers[id] = {
        ...(apiKey ? { apiKey } : {}),
        ...(typeof raw.endpoint === 'string' ? { endpoint: raw.endpoint } : {}),
        ...(raw.enabled === true ? { enabled: true } : {}),
        discovered: sanitizeDiscovery(raw.discovered),
        ...(safeString(raw.lastCheckedAt) ? { lastCheckedAt: raw.lastCheckedAt as string } : {}),
        ...(safeString(raw.lastError) ? { lastError: raw.lastError as string } : {}),
      };
    }

    cache = { version: 1, updatedAt: safeString(parsed.updatedAt) ?? new Date().toISOString(), providers };
  } catch {
    logger.warn('ai_provider_store_ignored', { reason: 'unreadable_or_invalid_json' });
  }

  return cache;
}

function write(next: ProviderFile): void {
  mkdirSync(env.dataDir, { recursive: true, mode: 0o700 });
  const payload = `${JSON.stringify(next, null, 2)}\n`;
  const temporary = path.join(env.dataDir, `.ai-providers-${process.pid}-${randomUUID()}.tmp`);
  writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o600 });

  try {
    renameSync(temporary, file);
  } catch {
    writeFileSync(file, payload, { encoding: 'utf8', mode: 0o600 });
    try {
      unlinkSync(temporary);
    } catch {
      // Best-effort cleanup.
    }
  }

  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ACLs inherit from the local user's profile.
  }

  cache = next;
  loaded = true;
}

function defaultEndpoint(provider: AiProviderId, stored: StoredProvider | undefined): string {
  if (provider === 'gemini') return env.provider.endpoint;
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'anthropic') return 'https://api.anthropic.com/v1';
  if (provider === 'deepseek') return 'https://api.deepseek.com';
  return stored?.endpoint ?? env.ai.ollamaUrl;
}

function normalizeEndpoint(provider: AiProviderId, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('The provider endpoint must be a valid URL.');
  }

  if (provider === 'ollama') {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('The Ollama endpoint must use http or https.');
    }
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) {
      throw new Error('The Ollama endpoint must stay on loopback.');
    }
    if (url.username || url.password) throw new Error('The endpoint cannot contain credentials.');
    return url.toString().replace(/\/+$/, '');
  }

  return defaultEndpoint(provider, undefined);
}

export function providerAccess(provider: AiProviderId): ProviderAccess {
  const state = readFile();
  const stored = state.providers[provider];

  if (provider === 'gemini') {
    const legacy = resolveProviderConfig();
    return {
      provider,
      apiKey: legacy.apiKey ?? '',
      keySource: legacy.keySource,
      hasStoredKey: legacy.hasStoredKey,
      endpoint: env.provider.endpoint,
      configured: Boolean(legacy.apiKey),
      lastCheckedAt: stored?.lastCheckedAt ?? null,
      lastError: stored?.lastError ?? null,
      discovered: stored?.discovered ?? [],
    };
  }

  const environmentKey =
    provider === 'openai'
      ? env.ai.environmentKeys.openai
      : provider === 'anthropic'
        ? env.ai.environmentKeys.anthropic
        : provider === 'deepseek'
          ? env.ai.environmentKeys.deepseek
          : null;
  const storedKey = stored?.apiKey ?? null;
  const apiKey = storedKey ?? environmentKey ?? '';
  const endpoint = defaultEndpoint(provider, stored);
  const configured =
    provider === 'ollama' ? stored?.enabled === true : Boolean(apiKey);

  return {
    provider,
    apiKey,
    keySource: storedKey ? 'settings' : environmentKey ? 'environment' : 'none',
    hasStoredKey: Boolean(storedKey),
    endpoint,
    configured,
    lastCheckedAt: stored?.lastCheckedAt ?? null,
    lastError: stored?.lastError ?? null,
    discovered: stored?.discovered ?? [],
  };
}

export function saveProviderAccess(
  provider: AiProviderId,
  input: { apiKey?: string; endpoint?: string },
): ProviderAccess {
  readFile();

  if (provider === 'gemini') {
    const key = validKey(input.apiKey);
    if (!key) throw new Error('The Gemini API key is not in a recognized format.');
    updateStoredProviderConfig({ apiKey: key });
    return providerAccess(provider);
  }

  const state = { ...cache, providers: { ...cache.providers } };
  const current = state.providers[provider] ?? {};
  const next: StoredProvider = {
    ...current,
    discovered: [],
    enabled: true,
  };
  delete next.lastCheckedAt;
  delete next.lastError;

  if (provider === 'ollama') {
    const endpoint = input.endpoint?.trim();
    if (!endpoint) throw new Error('An Ollama loopback endpoint is required.');
    next.endpoint = normalizeEndpoint(provider, endpoint);
  } else {
    const apiKey = validKey(input.apiKey);
    if (!apiKey) throw new Error('The API key is not in a recognized format.');
    next.apiKey = apiKey;
  }

  state.providers[provider] = next;
  write({ ...state, updatedAt: new Date().toISOString() });
  return providerAccess(provider);
}

export function removeProviderAccess(provider: AiProviderId): ProviderAccess {
  readFile();

  if (provider === 'gemini') {
    removeStoredProviderKey();
  }

  const state = { ...cache, providers: { ...cache.providers } };
  delete state.providers[provider];
  write({ ...state, updatedAt: new Date().toISOString() });
  return providerAccess(provider);
}

export function saveProviderDiscovery(
  provider: AiProviderId,
  discovered: StoredDiscovery[],
): ProviderAccess {
  readFile();
  const state = { ...cache, providers: { ...cache.providers } };
  const current = state.providers[provider] ?? {};
  const nextProvider = {
    ...current,
    discovered: sanitizeDiscovery(discovered),
    lastCheckedAt: new Date().toISOString(),
    enabled: provider === 'ollama' ? true : current.enabled,
  };
  delete nextProvider.lastError;
  state.providers[provider] = nextProvider;
  write({ ...state, updatedAt: new Date().toISOString() });
  return providerAccess(provider);
}

export function saveProviderFailure(provider: AiProviderId, message: string): ProviderAccess {
  readFile();
  const state = { ...cache, providers: { ...cache.providers } };
  const current = state.providers[provider] ?? {};
  state.providers[provider] = {
    ...current,
    lastCheckedAt: new Date().toISOString(),
    lastError: message.slice(0, 500),
  };
  write({ ...state, updatedAt: new Date().toISOString() });
  return providerAccess(provider);
}

export type { StoredDiscovery };

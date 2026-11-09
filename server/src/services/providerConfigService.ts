import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { ProviderConfiguration, ProviderKeySource } from '@shared';
import { env } from '../config/env';
import { DEFAULT_SYSTEM_INSTRUCTION } from '../providers/personality';
import { logger } from './logger';

interface StoredProviderConfig {
  version: 1;
  apiKey?: string;
  model?: string;
  systemInstruction?: string;
  updatedAt: string;
}

export interface ResolvedProviderConfig {
  apiKey: string | null;
  keySource: ProviderKeySource;
  hasStoredKey: boolean;
  model: string;
  systemInstruction: string;
  defaultModel: string;
  defaultSystemInstruction: string;
  timeoutMs: number;
  maxOutputTokens: number;
  contextMessages: number;
  contextChars: number;
}

const configFile = path.join(env.dataDir, 'provider.json');
let loaded = false;
let cached: StoredProviderConfig | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (key.length < 20 || key.length > 500 || /\s/.test(key)) return null;
  return key;
}

function validModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const model = value.trim();
  if (!/^[a-zA-Z0-9._-]{2,80}$/.test(model)) return null;
  return model;
}

function validInstruction(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const instruction = value.trim();
  if (!instruction || instruction.length > 8000) return null;
  return instruction;
}

function sanitize(value: unknown): StoredProviderConfig | null {
  if (!isRecord(value)) return null;

  const apiKey = validKey(value.apiKey);
  const model = validModel(value.model);
  const systemInstruction = validInstruction(value.systemInstruction);

  return {
    version: 1,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
    ...(systemInstruction ? { systemInstruction } : {}),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

function readStored(): StoredProviderConfig | null {
  if (loaded) return cached;
  loaded = true;

  if (!existsSync(configFile)) {
    cached = null;
    return null;
  }

  try {
    cached = sanitize(JSON.parse(readFileSync(configFile, 'utf8')));
    if (!cached) logger.warn('provider_config_ignored', { reason: 'invalid_shape' });
  } catch {
    cached = null;
    logger.warn('provider_config_ignored', { reason: 'unreadable_or_invalid_json' });
  }

  return cached;
}

function writeStored(next: StoredProviderConfig): void {
  mkdirSync(env.dataDir, { recursive: true, mode: 0o700 });

  const payload = `${JSON.stringify(next, null, 2)}\n`;
  const temporary = path.join(env.dataDir, `.provider-${process.pid}-${randomUUID()}.tmp`);
  writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o600 });

  try {
    renameSync(temporary, configFile);
  } catch {
    // Windows can reject replacing an existing file with rename. The direct
    // write still keeps the key out of the browser and logs.
    writeFileSync(configFile, payload, { encoding: 'utf8', mode: 0o600 });
    try {
      unlinkSync(temporary);
    } catch {
      // Best-effort cleanup of the temporary file.
    }
  }

  try {
    chmodSync(configFile, 0o600);
  } catch {
    // Windows permissions are inherited from the user's profile.
  }

  cached = next;
  loaded = true;
}

function sourceFor(storedKey: string | null): ProviderKeySource {
  if (storedKey) return 'settings';
  return env.provider.apiKey ? 'environment' : 'none';
}

export function resolveProviderConfig(): ResolvedProviderConfig {
  const stored = readStored();
  const storedKey = stored?.apiKey ?? null;
  const apiKey = storedKey ?? env.provider.apiKey;

  return {
    apiKey,
    keySource: sourceFor(storedKey),
    hasStoredKey: Boolean(storedKey),
    model: stored?.model ?? env.provider.model,
    systemInstruction:
      stored?.systemInstruction ??
      env.provider.systemInstruction ??
      DEFAULT_SYSTEM_INSTRUCTION,
    defaultModel: env.provider.model,
    defaultSystemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
    timeoutMs: env.provider.timeoutMs,
    maxOutputTokens: env.provider.maxOutputTokens,
    contextMessages: env.provider.contextMessages,
    contextChars: env.provider.contextChars,
  };
}

export function toPublicProviderConfiguration(
  config: ResolvedProviderConfig,
): ProviderConfiguration {
  return {
    provider: 'gemini',
    model: config.model,
    defaultModel: config.defaultModel,
    systemInstruction: config.systemInstruction,
    defaultSystemInstruction: config.defaultSystemInstruction,
    keySource: config.keySource,
    hasStoredKey: config.hasStoredKey,
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens,
    contextMessages: config.contextMessages,
  };
}

export function updateStoredProviderConfig(input: {
  apiKey?: string;
  model?: string;
  systemInstruction?: string;
}): ResolvedProviderConfig {
  const current = readStored();
  const next: StoredProviderConfig = {
    ...(current ?? {}),
    version: 1,
    updatedAt: new Date().toISOString(),
  };

  if (input.apiKey !== undefined) next.apiKey = input.apiKey;

  if (input.model !== undefined) {
    if (input.model) next.model = input.model;
    else delete next.model;
  }

  if (input.systemInstruction !== undefined) {
    const instruction = input.systemInstruction.trim();
    if (instruction && instruction !== DEFAULT_SYSTEM_INSTRUCTION) {
      next.systemInstruction = instruction;
    } else {
      delete next.systemInstruction;
    }
  }

  writeStored(next);
  return resolveProviderConfig();
}

export function removeStoredProviderKey(): ResolvedProviderConfig {
  const current = readStored();
  if (current) {
    const next: StoredProviderConfig = {
      ...current,
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    delete next.apiKey;
    writeStored(next);
  }

  return resolveProviderConfig();
}

import type { Capability } from './api.js';
import type { IsoTimestamp } from './conversations.js';
import type { VoiceStatus } from './voice.js';

export type ProviderState = 'not-configured' | 'configured' | 'connected' | 'error';
export type ProviderKeySource = 'environment' | 'settings' | 'none';

export interface ProviderStatus {
  id: 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'ollama' | 'none';
  label: string;
  state: ProviderState;
  model: string | null;
  endpoint: string | null;
  detail: string;
  requiredEnvVars: string[];
  keySource: ProviderKeySource;
  hasStoredKey: boolean;
  checkedAt: IsoTimestamp;
}

export interface ProviderConfiguration {
  provider: 'gemini';
  /** Retained for backward compatibility with the legacy provider config endpoint. */
  model: string;
  defaultModel: string;
  systemInstruction: string;
  defaultSystemInstruction: string;
  keySource: ProviderKeySource;
  hasStoredKey: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  contextMessages: number;
}

export interface ProviderConfigInput {
  apiKey?: string;
  model?: string;
  systemInstruction?: string;
}

export interface ProviderSettingsResult {
  provider: ProviderStatus;
  configuration: ProviderConfiguration;
}

export interface MemoryStatus {
  /** Collection can be paused while existing approved entries remain available. */
  state: 'paused' | 'ready';
  entries: number;
  detail: string;
}

export interface DatabaseStatus {
  engine: 'sqlite';
  state: 'ready' | 'unavailable';
  schemaVersion: number;
  appliedMigrations: number;
  file: string;
  sizeBytes: number | null;
}

export interface StorageStatus {
  conversations: number;
  messages: number;
  dataDirectory: string;
  persisted: boolean;
}

export interface HealthReport {
  service: 'caera-local';
  version: string;
  phase: 'phase-2';
  startedAt: IsoTimestamp;
  uptimeSeconds: number;
  platform: string;
  provider: ProviderStatus;
  voice: VoiceStatus;
  memory: MemoryStatus;
  database: DatabaseStatus;
  storage: StorageStatus;
  capabilities: Capability[];
}

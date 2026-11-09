import type { IsoTimestamp } from './conversations.js';

/** Connection state of the local VoiceStudio service. */
export type VoiceStudioState =
  | 'unknown'
  | 'unreachable'
  | 'starting'
  | 'incompatible'
  | 'error'
  | 'ready';

/** How the VoiceStudio process relates to CAERA. */
export type VoiceLifecyclePhase =
  | 'unavailable'
  | 'stopped'
  | 'starting'
  | 'managed'
  | 'external'
  | 'failed';

export type VoiceStartMode = 'on-demand' | 'startup';

export interface VoiceLifecycle {
  phase: VoiceLifecyclePhase;
  autoStart: boolean;
  startMode: VoiceStartMode;
  /** True only for a process CAERA spawned and still owns. */
  managed: boolean;
  pid: number | null;
  launcher: 'source-checkout' | 'command' | null;
  detail: string;
  lastError: string | null;
  startedAt: IsoTimestamp | null;
  canStart: boolean;
  canStop: boolean;
}

export type VoiceContractState = 'unknown' | 'verified' | 'unsupported' | 'unreachable';

/** What CAERA verified against VoiceStudio's own OpenAPI document. */
export interface VoiceContract {
  state: VoiceContractState;
  openapiVersion: string | null;
  checkedAt: IsoTimestamp | null;
  missing: string[];
}

export type VoiceTranscriptionAvailability = 'unknown' | 'ready' | 'unsupported';

export interface VoiceTranscriptionStatus {
  state: VoiceTranscriptionAvailability;
  detail: string;
}

export interface VoiceStatus {
  engine: 'voicestudio';
  state: VoiceStudioState;
  /** Voice output is a separate switch; the service can be ready while output is off. */
  enabled: boolean;
  url: string;
  version: string | null;
  device: string | null;
  detail: string;
  checkedAt: IsoTimestamp;
  contract: VoiceContract;
  voiceCount: number | null;
  transcription: VoiceTranscriptionStatus;
  lifecycle: VoiceLifecycle;
}

export type VoiceKind = 'default' | 'profile' | 'openai_alias' | 'preset';

export interface VoiceOption {
  id: string;
  name: string;
  kind: VoiceKind;
  language: string | null;
  description: string | null;
}

export interface VoiceEngine {
  id: string;
  name: string;
  available: boolean;
  supportsCloning: boolean | null;
}

export interface VoiceCatalog {
  voices: VoiceOption[];
  engines: VoiceEngine[];
  /** Set when the service answered but its voice list could not be read. */
  error: string | null;
}

export type VoiceFormat = 'mp3' | 'wav';

export interface VoiceConfiguration {
  enabled: boolean;
  url: string;
  defaultUrl: string;
  voiceId: string;
  voiceName: string;
  speed: number;
  format: VoiceFormat;
  autoSpeak: boolean;
  autoStart: boolean;
  startMode: VoiceStartMode;
  /** Absolute path to a VoiceStudio source checkout, or null. */
  voiceStudioDir: string | null;
  timeoutMs: number;
  maxInputChars: number;
}

export interface VoiceConfigInput {
  enabled?: boolean;
  url?: string;
  voiceId?: string;
  voiceName?: string;
  speed?: number;
  format?: VoiceFormat;
  autoSpeak?: boolean;
  autoStart?: boolean;
  startMode?: VoiceStartMode;
  /** Set to null to clear a saved source-checkout path. */
  voiceStudioDir?: string | null;
}

export interface VoiceSettingsResult {
  voice: VoiceStatus;
  configuration: VoiceConfiguration;
  catalog: VoiceCatalog;
}

export interface VoiceTestInput {
  voiceId?: string;
  speed?: number;
  format?: VoiceFormat;
}

export interface VoiceSpeechInput {
  conversationId: string;
  messageId: string;
}

export interface VoiceTranscriptionResult {
  text: string;
  model: string | null;
  language: string | null;
}

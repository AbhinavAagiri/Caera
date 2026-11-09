import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { VoiceConfiguration, VoiceConfigInput, VoiceFormat, VoiceStartMode } from '@shared';
import { env } from '../config/env';
import { logger } from './logger';

interface StoredVoiceConfig {
  version: 1;
  enabled?: boolean;
  url?: string;
  voiceId?: string;
  voiceName?: string;
  speed?: number;
  format?: VoiceFormat;
  autoSpeak?: boolean;
  autoStart?: boolean;
  startMode?: VoiceStartMode;
  voiceStudioDir?: string | null;
  updatedAt: string;
}

const configFile = path.join(env.dataDir, 'voice.json');
let loaded = false;
let cached: StoredVoiceConfig | null = null;

export class VoiceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * VoiceStudio must stay on this machine. CAERA refuses LAN or public hosts so
 * the local API is never reachable through a misconfigured address.
 */
export function normalizeVoiceUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new VoiceConfigError('The VoiceStudio URL cannot be empty.');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new VoiceConfigError('The VoiceStudio URL must be a complete address, such as http://localhost:3900.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new VoiceConfigError('The VoiceStudio URL must use http or https.');
  }

  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
    throw new VoiceConfigError(
      'VoiceStudio must stay on this machine. Use localhost, 127.0.0.1 or ::1 only.',
    );
  }

  if (url.username || url.password) {
    throw new VoiceConfigError('The VoiceStudio URL cannot include credentials.');
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new VoiceConfigError('Use the service origin only, such as http://localhost:3900.');
  }

  return url.origin;
}

export function normalizeVoiceId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(id)) {
    throw new VoiceConfigError('That voice identifier contains characters VoiceStudio does not accept.');
  }
  return id;
}

function normalizeVoiceName(value: string): string {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return name.slice(0, 120) || 'VoiceStudio voice';
}

function normalizeSpeed(value: number): number {
  if (!Number.isFinite(value) || value < 0.25 || value > 4) {
    throw new VoiceConfigError('Speed must be a number between 0.25 and 4.');
  }
  return Math.round(value * 100) / 100;
}

function normalizeStartMode(value: string): VoiceStartMode {
  if (value === 'startup' || value === 'on-demand') return value;
  throw new VoiceConfigError('Start mode must be startup or on-demand.');
}

/** A path is stored, not executed. It must already exist and be absolute. */
function normalizeVoiceStudioDir(value: string | null): string | null {
  if (value === null) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) {
    throw new VoiceConfigError('The VoiceStudio folder path is too long.');
  }
  if (trimmed.includes('\u0000')) {
    throw new VoiceConfigError('The VoiceStudio folder path contains an invalid character.');
  }
  if (!path.isAbsolute(trimmed)) {
    throw new VoiceConfigError('Use an absolute path to the VoiceStudio source folder.');
  }

  const resolved = path.resolve(trimmed);
  try {
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new VoiceConfigError('That VoiceStudio folder does not exist.');
    }
  } catch (cause) {
    if (cause instanceof VoiceConfigError) throw cause;
    throw new VoiceConfigError('That VoiceStudio folder could not be read.');
  }

  return resolved;
}

function sanitize(value: unknown): StoredVoiceConfig | null {
  if (!isRecord(value)) return null;

  const next: StoredVoiceConfig = {
    version: 1,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };

  if (typeof value.enabled === 'boolean') next.enabled = value.enabled;
  if (typeof value.autoSpeak === 'boolean') next.autoSpeak = value.autoSpeak;
  if (typeof value.autoStart === 'boolean') next.autoStart = value.autoStart;
  if (value.startMode === 'startup' || value.startMode === 'on-demand') {
    next.startMode = value.startMode;
  }

  if (typeof value.url === 'string') {
    try {
      next.url = normalizeVoiceUrl(value.url);
    } catch {
      logger.warn('voice_config_ignored_field', { field: 'url' });
    }
  }

  if (typeof value.voiceId === 'string') {
    try {
      next.voiceId = normalizeVoiceId(value.voiceId);
    } catch {
      logger.warn('voice_config_ignored_field', { field: 'voiceId' });
    }
  }

  if (typeof value.voiceName === 'string') next.voiceName = normalizeVoiceName(value.voiceName);
  if (typeof value.speed === 'number' && Number.isFinite(value.speed)) {
    next.speed = Math.min(4, Math.max(0.25, value.speed));
  }
  if (value.format === 'mp3' || value.format === 'wav') next.format = value.format;

  if (value.voiceStudioDir === null) {
    next.voiceStudioDir = null;
  } else if (typeof value.voiceStudioDir === 'string') {
    try {
      next.voiceStudioDir = normalizeVoiceStudioDir(value.voiceStudioDir);
    } catch {
      logger.warn('voice_config_ignored_field', { field: 'voiceStudioDir' });
    }
  }

  return next;
}

function readStored(): StoredVoiceConfig | null {
  if (loaded) return cached;
  loaded = true;

  if (!existsSync(configFile)) {
    cached = null;
    return null;
  }

  try {
    cached = sanitize(JSON.parse(readFileSync(configFile, 'utf8')));
    if (!cached) logger.warn('voice_config_ignored', { reason: 'invalid_shape' });
  } catch {
    cached = null;
    logger.warn('voice_config_ignored', { reason: 'unreadable_or_invalid_json' });
  }

  return cached;
}

function writeStored(next: StoredVoiceConfig): void {
  mkdirSync(env.dataDir, { recursive: true, mode: 0o700 });

  const payload = `${JSON.stringify(next, null, 2)}\n`;
  const temporary = path.join(env.dataDir, `.voice-${process.pid}-${randomUUID()}.tmp`);
  writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o600 });

  try {
    renameSync(temporary, configFile);
  } catch {
    // Windows can reject replacing an existing file with rename.
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

export function resolveVoiceConfig(): VoiceConfiguration {
  const stored = readStored();

  return {
    enabled: stored?.enabled ?? env.voice.enabled,
    url: stored?.url ?? env.voice.endpoint,
    defaultUrl: env.voice.endpoint,
    voiceId: stored?.voiceId ?? 'default',
    voiceName: stored?.voiceName ?? 'VoiceStudio default',
    speed: stored?.speed ?? 1,
    format: stored?.format ?? 'mp3',
    autoSpeak: stored?.autoSpeak ?? false,
    autoStart: stored?.autoStart ?? env.voice.autoStart,
    startMode: stored?.startMode ?? env.voice.startMode,
    voiceStudioDir:
      stored && 'voiceStudioDir' in stored
        ? (stored.voiceStudioDir ?? null)
        : env.voice.studioDir,
    timeoutMs: env.voice.timeoutMs,
    maxInputChars: env.voice.maxInputChars,
  };
}

export function updateStoredVoiceConfig(input: VoiceConfigInput): VoiceConfiguration {
  const current = readStored();
  const next: StoredVoiceConfig = {
    ...(current ?? {}),
    version: 1,
    updatedAt: new Date().toISOString(),
  };

  if (input.enabled !== undefined) next.enabled = input.enabled;
  if (input.autoSpeak !== undefined) next.autoSpeak = input.autoSpeak;
  if (input.url !== undefined) next.url = normalizeVoiceUrl(input.url);
  if (input.voiceId !== undefined) next.voiceId = normalizeVoiceId(input.voiceId);
  if (input.voiceName !== undefined) next.voiceName = normalizeVoiceName(input.voiceName);
  if (input.speed !== undefined) next.speed = normalizeSpeed(input.speed);
  if (input.autoStart !== undefined) next.autoStart = input.autoStart;
  if (input.startMode !== undefined) next.startMode = normalizeStartMode(input.startMode);
  if (input.voiceStudioDir !== undefined) {
    next.voiceStudioDir = normalizeVoiceStudioDir(input.voiceStudioDir);
  }
  if (input.format !== undefined) {
    if (input.format !== 'mp3' && input.format !== 'wav') {
      throw new VoiceConfigError('Audio format must be MP3 or WAV.');
    }
    next.format = input.format;
  }

  writeStored(next);
  return resolveVoiceConfig();
}

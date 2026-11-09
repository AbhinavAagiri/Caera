import type {
  VoiceCatalog,
  VoiceConfiguration,
  VoiceContract,
  VoiceFormat,
  VoiceSettingsResult,
  VoiceSpeechInput,
  VoiceStatus,
  VoiceTestInput,
  VoiceTranscriptionResult,
} from '@shared';
import {
  beginVoiceStudioStart,
  getVoiceLifecycle,
  stopManagedVoiceStudio,
} from './voiceLifecycleService';
import { env } from '../config/env';
import { HttpError } from '../middleware/errors';
import { getConversation } from './conversationService';
import { publish } from './eventBus';
import { logger } from './logger';
import {
  normalizeVoiceId,
  resolveVoiceConfig,
  updateStoredVoiceConfig,
  VoiceConfigError,
} from './voiceConfigService';
import {
  discoverContract,
  fetchCatalog,
  probeHealth,
  synthesize,
  transcribe,
  VoiceClientError,
  type VoiceContractInfo,
} from '../voice/voiceStudioClient';

const REFRESH_TTL_MS = 15_000;
const TEST_TEXT = 'CAERA voice check. This is VoiceStudio speaking on your machine.';
const TROUBLESHOOT =
  'CAERA can start VoiceStudio from a prepared source checkout. Configure its folder in Settings → Voice, or start the headless service yourself, then check again.';

export interface VoiceAudio {
  bytes: Buffer;
  contentType: string;
  format: VoiceFormat;
  voiceId: string;
  voiceName: string;
  truncated: boolean;
}

interface OperationalVoice {
  config: VoiceConfiguration;
  contract: VoiceContractInfo;
}

let contractInfo: VoiceContractInfo | null = null;
let contract: VoiceContract = {
  state: 'unknown',
  openapiVersion: null,
  checkedAt: null,
  missing: [],
};
let catalog: VoiceCatalog = { voices: [], engines: [], error: null };
let refreshedAt = 0;
let refreshing: Promise<void> | null = null;

function transcriptionStatusFor(info: VoiceContractInfo | null): VoiceStatus['transcription'] {
  if (!info) {
    return {
      state: 'unknown',
      detail: 'Speech recognition has not been checked against VoiceStudio yet.',
    };
  }

  if (!info.transcription.available) {
    return {
      state: 'unsupported',
      detail: `This VoiceStudio build does not document speech recognition (${info.transcription.missing.join(', ')}).`,
    };
  }

  return {
    state: 'ready',
    detail:
      'VoiceStudio documents POST /v1/audio/transcriptions. Its active ASR model handles the recording.',
  };
}

function initialStatus(): VoiceStatus {
  const config = resolveVoiceConfig();

  return {
    engine: 'voicestudio',
    state: 'unknown',
    enabled: config.enabled,
    url: config.url,
    version: null,
    device: null,
    detail: 'VoiceStudio has not been checked yet.',
    checkedAt: new Date().toISOString(),
    contract,
    voiceCount: null,
    transcription: transcriptionStatusFor(null),
    lifecycle: getVoiceLifecycle(config, false),
  };
}

let snapshot: VoiceStatus = initialStatus();

function readConfig(): VoiceConfiguration {
  return resolveVoiceConfig();
}

function applyFailure(config: VoiceConfiguration, at: string, cause: unknown): VoiceClientError {
  const error =
    cause instanceof VoiceClientError
      ? cause
      : new VoiceClientError('VOICE_ERROR', 'VoiceStudio status could not be read.');

  let state: VoiceStatus['state'];
  switch (error.code) {
    case 'VOICE_UNREACHABLE':
    case 'VOICE_TIMEOUT':
      state = 'unreachable';
      break;
    case 'VOICE_UNAVAILABLE':
      state = 'starting';
      break;
    case 'VOICE_UNSUPPORTED':
      state = 'incompatible';
      break;
    default:
      state = 'error';
  }

  const lifecycle = getVoiceLifecycle(config, false);
  if (lifecycle.phase === 'starting') state = 'starting';

  const transcription: VoiceStatus['transcription'] =
    state === 'incompatible'
      ? {
          state: 'unsupported',
          detail: 'This VoiceStudio build does not expose the transcription API CAERA needs.',
        }
      : {
          state: 'unknown',
          detail: 'VoiceStudio is unavailable, so speech recognition cannot run.',
        };

  if (state === 'incompatible') {
    contractInfo = null;
    contract = {
      state: 'unsupported',
      openapiVersion: null,
      checkedAt: at,
      missing: error.missing,
    };
    catalog = { voices: [], engines: [], error: null };
  } else if (state === 'unreachable') {
    contract = {
      ...contract,
      state: 'unreachable',
      checkedAt: at,
    };
    catalog = { voices: [], engines: [], error: null };
  }

  snapshot = {
    engine: 'voicestudio',
    state,
    enabled: config.enabled,
    url: config.url,
    version: contractInfo ? snapshot.version : null,
    device: contractInfo ? snapshot.device : null,
    detail:
      state === 'starting'
        ? lifecycle.detail
        : `${error.message} ${TROUBLESHOOT}`,
    checkedAt: at,
    contract,
    voiceCount: null,
    transcription,
    lifecycle,
  };

  return error;
}

async function refreshInternal(): Promise<void> {
  const config = readConfig();
  const at = new Date().toISOString();

  try {
    const health = await probeHealth(config.url);
    const info = await discoverContract(config.url);
    const transcription = transcriptionStatusFor(info);

    contractInfo = info;
    contract = {
      state: 'verified',
      openapiVersion: info.openapiVersion,
      checkedAt: at,
      missing: [],
    };

    let nextCatalog: VoiceCatalog = { voices: [], engines: [], error: null };
    try {
      const fetched = await fetchCatalog(config.url);
      nextCatalog = { voices: fetched.voices, engines: fetched.engines, error: null };
    } catch (cause) {
      const error =
        cause instanceof VoiceClientError
          ? cause
          : new VoiceClientError('VOICE_ERROR', 'VoiceStudio returned an unreadable voice list.');

      if (error.code === 'VOICE_UNSUPPORTED') throw error;

      logger.warn('voice_catalog_failed', { code: error.code });
      nextCatalog = { voices: [], engines: [], error: error.message };
    }

    catalog = nextCatalog;

    const versionLabel = health.version ? `VoiceStudio ${health.version}` : 'VoiceStudio';
    snapshot = {
      engine: 'voicestudio',
      state: 'ready',
      enabled: config.enabled,
      url: config.url,
      version: health.version,
      device: health.device,
      detail: nextCatalog.error
        ? `${versionLabel} is running at ${config.url}, but its voice list could not be read.`
        : `${versionLabel} is running at ${config.url}. ${nextCatalog.voices.length} voices reported.`,
      checkedAt: at,
      contract,
      voiceCount: nextCatalog.error ? null : nextCatalog.voices.length,
      transcription,
      lifecycle: getVoiceLifecycle(config, true),
    };
  } catch (cause) {
    const error = applyFailure(config, at, cause);
    logger.warn('voice_status_failed', {
      code: error.code,
      url: config.url,
    });
  } finally {
    refreshedAt = Date.now();
  }
}

/** Refresh the cached status. Concurrent callers share one probe. */
export function refreshVoiceStatus(force = false): Promise<void> {
  if (refreshing) return refreshing;
  if (!force && refreshedAt > 0 && Date.now() - refreshedAt < REFRESH_TTL_MS) {
    return Promise.resolve();
  }

  const run = refreshInternal();
  refreshing = run;
  void run.finally(() => {
    if (refreshing === run) refreshing = null;
  });
  return run;
}

/** Starts a background check at startup without delaying the node's listen. */
export function primeVoiceStatus(): void {
  void (async () => {
    await refreshVoiceStatus(true);

    const config = readConfig();
    const current = getVoiceStatus();
    if (current.state === 'ready' || current.state === 'incompatible') return;
    if (!config.autoStart || config.startMode !== 'startup') return;

    const pending = beginVoiceStudioStart(config, 'boot');
    markVoiceStarting(config);
    const started = await pending;
    await refreshVoiceStatus(true);

    publish({
      kind: 'voice',
      status: started ? 'completed' : 'failed',
      summary: started ? 'VoiceStudio started with CAERA' : 'VoiceStudio did not start',
      detail: getVoiceStatus().lifecycle.detail,
      meta: { lifecycle: getVoiceStatus().lifecycle.phase },
    });
  })().catch((cause: unknown) => {
    logger.warn('voice_startup_failed', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
  });
}

export function getVoiceStatus(): VoiceStatus {
  const config = readConfig();

  if (snapshot.enabled !== config.enabled || snapshot.url !== config.url) {
    snapshot = { ...snapshot, enabled: config.enabled, url: config.url };
  }

  if (!refreshing && (refreshedAt === 0 || Date.now() - refreshedAt > REFRESH_TTL_MS)) {
    void refreshVoiceStatus();
  }

  return snapshot;
}

export async function getVoiceSettings(refresh = false): Promise<VoiceSettingsResult> {
  if (refresh || snapshot.state === 'unknown' || Date.now() - refreshedAt > REFRESH_TTL_MS) {
    await refreshVoiceStatus(refresh || snapshot.state === 'unknown');
  }

  return {
    voice: getVoiceStatus(),
    configuration: readConfig(),
    catalog,
  };
}

export async function checkVoice(): Promise<VoiceSettingsResult> {
  await refreshVoiceStatus(true);
  const result = await getVoiceSettings(false);

  if (result.voice.state === 'ready') {
    publish({
      kind: 'voice',
      status: 'completed',
      summary: 'VoiceStudio connection verified',
      detail: `${result.voice.version ? `v${result.voice.version} · ` : ''}${result.catalog.voices.length} voices`,
      meta: {
        version: result.voice.version ?? 'unknown',
        voices: result.catalog.voices.length,
      },
    });
  } else {
    publish({
      kind: 'voice',
      status: 'failed',
      summary: 'VoiceStudio is not ready',
      detail: result.voice.detail,
      meta: { state: result.voice.state },
    });
  }

  return result;
}

export async function updateVoiceSettings(
  input: Parameters<typeof updateStoredVoiceConfig>[0],
): Promise<VoiceSettingsResult> {
  let config: VoiceConfiguration;

  try {
    config = updateStoredVoiceConfig(input);
  } catch (cause) {
    if (cause instanceof VoiceConfigError) {
      throw new HttpError(400, 'VALIDATION_ERROR', cause.message);
    }
    throw cause;
  }

  snapshot = {
    ...snapshot,
    enabled: config.enabled,
    url: config.url,
    state: 'unknown',
    detail: 'Checking VoiceStudio at the saved configuration…',
    checkedAt: new Date().toISOString(),
    contract: { state: 'unknown', openapiVersion: null, checkedAt: null, missing: [] },
    voiceCount: null,
    transcription: transcriptionStatusFor(null),
    lifecycle: getVoiceLifecycle(config, false),
  };
  contractInfo = null;
  contract = { state: 'unknown', openapiVersion: null, checkedAt: null, missing: [] };
  refreshedAt = 0;

  await refreshVoiceStatus(true);

  publish({
    kind: 'voice',
    status: 'completed',
    summary: 'Voice settings updated',
    detail: `${config.voiceName} · ${config.format.toUpperCase()} · ${config.enabled ? 'output on' : 'output off'}`,
    meta: { enabled: config.enabled, autoSpeak: config.autoSpeak, speed: config.speed },
  });

  return getVoiceSettings(false);
}

function toHttpError(cause: unknown, unsupportedStatus = 503): HttpError {
  if (cause instanceof HttpError) return cause;

  const error =
    cause instanceof VoiceClientError
      ? cause
      : new VoiceClientError('VOICE_ERROR', 'VoiceStudio could not complete the request.');

  const status =
    error.code === 'VOICE_UNSUPPORTED'
      ? unsupportedStatus
      : error.code === 'VOICE_TIMEOUT'
        ? 504
        : error.code === 'VOICE_ERROR'
          ? 502
          : 503;

  return new HttpError(status, error.code, error.message, error.hint ?? TROUBLESHOOT);
}

function markVoiceStarting(config: VoiceConfiguration): void {
  snapshot = {
    ...snapshot,
    state: 'starting',
    enabled: config.enabled,
    url: config.url,
    detail: getVoiceLifecycle(config, false).detail,
    checkedAt: new Date().toISOString(),
    lifecycle: getVoiceLifecycle(config, false),
  };
}

async function connectVoice(config: VoiceConfiguration, at: string): Promise<OperationalVoice> {
  const health = await probeHealth(config.url);

  let info = contractInfo;
  if (!info || contract.state !== 'verified') {
    info = await discoverContract(config.url);
    contractInfo = info;
    contract = {
      state: 'verified',
      openapiVersion: info.openapiVersion,
      checkedAt: at,
      missing: [],
    };
  }

  snapshot = {
    ...snapshot,
    state: 'ready',
    enabled: config.enabled,
    url: config.url,
    version: health.version,
    device: health.device,
    detail: `${health.version ? `VoiceStudio ${health.version}` : 'VoiceStudio'} is running at ${config.url}.`,
    checkedAt: at,
    contract,
    transcription: transcriptionStatusFor(info),
    lifecycle: getVoiceLifecycle(config, true),
  };
  refreshedAt = Date.now();

  return { config, contract: info };
}

async function ensureOperational(): Promise<OperationalVoice> {
  const config = readConfig();
  const at = new Date().toISOString();

  try {
    return await connectVoice(config, at);
  } catch (cause) {
    const error =
      cause instanceof VoiceClientError
        ? cause
        : new VoiceClientError('VOICE_ERROR', 'VoiceStudio status could not be read.');

    if (
      config.autoStart &&
      (error.code === 'VOICE_UNREACHABLE' || error.code === 'VOICE_TIMEOUT')
    ) {
      const pending = beginVoiceStudioStart(config, 'demand');
      markVoiceStarting(config);
      const started = await pending;

      if (started) {
        try {
          return await connectVoice(config, new Date().toISOString());
        } catch (next) {
          applyFailure(config, new Date().toISOString(), next);
          throw toHttpError(next);
        }
      }

      const lifecycle = getVoiceLifecycle(config, false);
      applyFailure(config, at, cause);
      throw new HttpError(
        503,
        'VOICE_START_FAILED',
        lifecycle.lastError ?? 'VoiceStudio could not be started.',
        'Check the VoiceStudio folder or launch command in Settings → Voice.',
      );
    }

    applyFailure(config, at, cause);
    throw toHttpError(cause);
  }
}

export async function startVoiceStudioManually(): Promise<VoiceSettingsResult> {
  const config = readConfig();
  const pending = beginVoiceStudioStart(config, 'manual');
  markVoiceStarting(config);

  void pending
    .then(async (started) => {
      await refreshVoiceStatus(true);
      publish({
        kind: 'voice',
        status: started ? 'completed' : 'failed',
        summary: started ? 'VoiceStudio started' : 'VoiceStudio did not start',
        detail: getVoiceStatus().lifecycle.detail,
        meta: { lifecycle: getVoiceStatus().lifecycle.phase },
      });
    })
    .catch((cause: unknown) => {
      logger.warn('voice_manual_start_failed', {
        message: cause instanceof Error ? cause.message : String(cause),
      });
    });

  return getVoiceSettings(false);
}

export async function stopVoiceStudioManually(): Promise<VoiceSettingsResult> {
  const result = await stopManagedVoiceStudio();

  if (!result.stopped) {
    throw new HttpError(
      409,
      'VOICE_NOT_MANAGED',
      result.message ?? 'CAERA is not managing a running VoiceStudio process.',
      'CAERA only stops the process it started. A service that was already running is left alone.',
    );
  }

  await refreshVoiceStatus(true);
  publish({
    kind: 'voice',
    status: 'completed',
    summary: 'VoiceStudio stopped',
    detail: `CAERA stopped the process it started (PID ${result.pid ?? 'unknown'}).`,
    meta: { lifecycle: getVoiceStatus().lifecycle.phase },
  });

  return getVoiceSettings(false);
}

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(0.25, Math.round(value * 100) / 100));
}

function resolveVoiceId(value: string): string {
  try {
    return normalizeVoiceId(value);
  } catch (cause) {
    if (cause instanceof VoiceConfigError) {
      throw new HttpError(400, 'VALIDATION_ERROR', cause.message);
    }
    throw cause;
  }
}

/** Strips markdown so CAERA reads the reply, not its syntax or code. */
export function toSpeakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateForSpeech(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false };

  const slice = value.slice(0, limit);
  const boundary = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('\n'),
    slice.lastIndexOf(' '),
  );
  const text = (boundary > limit * 0.6 ? slice.slice(0, boundary + 1) : slice).trim();

  return { text: text || slice.trim(), truncated: true };
}

export async function testSpeech(
  input: VoiceTestInput,
  signal?: AbortSignal,
): Promise<VoiceAudio> {
  const { config, contract: info } = await ensureOperational();
  const voiceId = resolveVoiceId(input.voiceId ?? config.voiceId);
  const format = input.format ?? config.format;

  if (!info.formats.includes(format)) {
    throw new HttpError(
      400,
      'VOICE_UNSUPPORTED',
      `This VoiceStudio build does not advertise ${format.toUpperCase()} output.`,
      `Choose ${info.formats.map((value) => value.toUpperCase()).join(' or ')} in Settings → Voice.`,
    );
  }

  try {
    const audio = await synthesize(
      config.url,
      {
        voice: voiceId,
        input: TEST_TEXT,
        format,
        speed: clampSpeed(input.speed ?? config.speed),
        supportsSpeed: info.supportsSpeed,
        timeoutMs: config.timeoutMs,
      },
      signal,
    );

    publish({
      kind: 'voice',
      status: 'completed',
      summary: 'Voice test generated audio',
      detail: `${voiceId} · ${format.toUpperCase()}`,
      meta: { format, bytes: audio.bytes.length },
    });

    return {
      ...audio,
      format,
      voiceId,
      voiceName: voiceId === 'default' ? 'VoiceStudio default' : voiceId,
      truncated: false,
    };
  } catch (cause) {
    const error =
      cause instanceof VoiceClientError
        ? cause
        : new VoiceClientError('VOICE_ERROR', 'VoiceStudio could not generate audio.');

    publish({
      kind: 'voice',
      status: 'failed',
      summary: 'Voice test failed',
      detail: error.message,
      meta: { format, code: error.code },
    });

    throw toHttpError(cause);
  }
}

export async function speakMessage(
  input: VoiceSpeechInput,
  signal?: AbortSignal,
): Promise<VoiceAudio> {
  const config = readConfig();

  if (!config.enabled) {
    throw new HttpError(
      409,
      'VOICE_DISABLED',
      'Voice output is turned off.',
      'Enable voice output in Settings → Voice.',
    );
  }

  const conversation = await getConversation(input.conversationId);
  if (!conversation) {
    throw new HttpError(404, 'NOT_FOUND', 'That conversation is not in the local store.');
  }

  const message = conversation.messages.find((entry) => entry.id === input.messageId);
  if (!message || message.role !== 'assistant' || message.kind !== 'text') {
    throw new HttpError(
      404,
      'NOT_FOUND',
      'That assistant reply is not in this conversation.',
    );
  }

  const speakable = toSpeakable(message.content);
  if (!speakable) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'This reply has no text that can be spoken.');
  }

  const { contract: info } = await ensureOperational();
  const format: VoiceFormat = info.formats.includes(config.format)
    ? config.format
    : (info.formats[0] ?? 'mp3');
  const limit = Math.max(200, Math.min(config.maxInputChars, info.maxInputChars));
  const cut = truncateForSpeech(speakable, limit);

  try {
    const audio = await synthesize(
      config.url,
      {
        voice: config.voiceId,
        input: cut.text,
        format,
        speed: clampSpeed(config.speed),
        supportsSpeed: info.supportsSpeed,
        timeoutMs: config.timeoutMs,
      },
      signal,
    );

    publish({
      kind: 'voice',
      status: 'completed',
      summary: 'Reply spoken locally',
      detail: `${config.voiceName} · ${format.toUpperCase()}${cut.truncated ? ' · truncated' : ''}`,
      meta: {
        format,
        characters: cut.text.length,
        truncated: cut.truncated,
        bytes: audio.bytes.length,
      },
    });

    return {
      ...audio,
      format,
      voiceId: config.voiceId,
      voiceName: config.voiceName,
      truncated: cut.truncated,
    };
  } catch (cause) {
    const error =
      cause instanceof VoiceClientError
        ? cause
        : new VoiceClientError('VOICE_ERROR', 'VoiceStudio could not generate audio.');

    publish({
      kind: 'voice',
      status: 'failed',
      summary: 'Voice playback failed',
      detail: error.message,
      meta: { format, code: error.code },
    });

    throw toHttpError(cause);
  }
}

export async function transcribeAudio(
  audio: Buffer,
  signal?: AbortSignal,
): Promise<VoiceTranscriptionResult> {
  const { config, contract: info } = await ensureOperational();

  if (!info.transcription.available) {
    throw new HttpError(
      400,
      'VOICE_UNSUPPORTED',
      'This VoiceStudio build does not expose speech recognition.',
      'Update VoiceStudio to a build that documents POST /v1/audio/transcriptions, then check again.',
    );
  }

  try {
    const result = await transcribe(
      config.url,
      audio,
      {
        supportsModel: info.transcription.supportsModel,
        supportsResponseFormat: info.transcription.supportsResponseFormat,
        timeoutMs: env.voice.transcriptionTimeoutMs,
      },
      signal,
    );

    publish({
      kind: 'voice',
      status: 'completed',
      summary: 'Voice input transcribed',
      detail: `${result.text.length} characters${result.language ? ` · ${result.language}` : ''}`,
      meta: {
        characters: result.text.length,
        language: result.language ?? 'unknown',
      },
    });

    return {
      ...result,
      model: info.transcription.supportsModel ? 'whisper-1' : null,
    };
  } catch (cause) {
    const error =
      cause instanceof VoiceClientError
        ? cause
        : new VoiceClientError('VOICE_ERROR', 'VoiceStudio could not transcribe the recording.');

    publish({
      kind: 'voice',
      status: 'failed',
      summary: 'Voice transcription failed',
      detail: error.message,
      meta: { code: error.code },
    });

    throw toHttpError(cause, 400);
  }
}

/** Clears an in-flight status probe when the node shuts down. */
export function stopVoiceRefresh(): void {
  refreshing = null;
}

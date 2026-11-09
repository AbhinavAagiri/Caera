import type { VoiceEngine, VoiceFormat, VoiceKind, VoiceOption } from '@shared';
import { env } from '../config/env';

type VoiceClientErrorCode =
  | 'VOICE_UNREACHABLE'
  | 'VOICE_TIMEOUT'
  | 'VOICE_UNAVAILABLE'
  | 'VOICE_UNSUPPORTED'
  | 'VOICE_ERROR';

/**
 * A failure while talking to VoiceStudio. Messages are safe to show to the
 * user: they never include response bodies, prompts or generated audio.
 */
export class VoiceClientError extends Error {
  readonly code: VoiceClientErrorCode;
  readonly hint?: string;
  readonly missing: string[];

  constructor(
    code: VoiceClientErrorCode,
    message: string,
    options: { hint?: string; missing?: string[] } = {},
  ) {
    super(message);
    this.name = 'VoiceClientError';
    this.code = code;
    if (options.hint) this.hint = options.hint;
    this.missing = options.missing ?? [];
  }
}

export interface VoiceHealth {
  version: string | null;
  device: string | null;
  engine: string | null;
}

/**
 * The subset of VoiceStudio's OpenAPI document CAERA depends on. Every field
 * is read from the live document; nothing here is assumed about a newer build.
 */
export interface VoiceContractInfo {
  openapiVersion: string;
  formats: VoiceFormat[];
  supportsSpeed: boolean;
  maxInputChars: number;
  transcription: {
    available: boolean;
    supportsModel: boolean;
    supportsResponseFormat: boolean;
    missing: string[];
  };
}

export interface VoiceCatalogResult {
  voices: VoiceOption[];
  engines: VoiceEngine[];
}

export interface SynthesizedAudio {
  bytes: Buffer;
  contentType: string;
}

const MAX_AUDIO_BYTES = 40 * 1024 * 1024;
const TROUBLESHOOT_HINT =
  'Start VoiceStudio on this machine, confirm its local API is listening, then check again in Settings → Voice.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function baseWithoutTrailingSlash(base: string): string {
  return base.replace(/\/+$/, '');
}

function requestUrl(base: string, pathname: string): string {
  const url = new URL(baseWithoutTrailingSlash(base));
  // Node can resolve "localhost" to ::1 while VoiceStudio listens on IPv4.
  // The connection stays loopback either way.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return new URL(pathname, url).toString();
}

async function call(
  base: string,
  pathname: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    return await fetch(requestUrl(base, pathname), {
      ...init,
      redirect: 'error',
      signal: combined,
      headers: {
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (cause) {
    if (signal?.aborted) {
      throw new VoiceClientError('VOICE_UNAVAILABLE', 'VoiceStudio was cancelled.');
    }
    if (timeout.aborted) {
      throw new VoiceClientError(
        'VOICE_TIMEOUT',
        `VoiceStudio did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
        { hint: 'The local engine may still be loading. Wait a moment, then retry.' },
      );
    }
    throw new VoiceClientError('VOICE_UNREACHABLE', `VoiceStudio is not reachable at ${base}.`, {
      hint: TROUBLESHOOT_HINT,
    });
  }
}

/** GET /health — always called before a speech operation. */
export async function probeHealth(base: string, signal?: AbortSignal): Promise<VoiceHealth> {
  const response = await call(base, '/health', { method: 'GET' }, env.voice.healthTimeoutMs, signal);

  if (response.status === 503) {
    let label = '';
    try {
      const body: unknown = await response.json();
      if (isRecord(body) && typeof body.label === 'string') label = body.label.slice(0, 120);
    } catch {
      // A startup response without a readable label is still a startup response.
    }
    throw new VoiceClientError(
      'VOICE_UNAVAILABLE',
      label
        ? `VoiceStudio is still starting (${label}).`
        : 'VoiceStudio is still starting its speech engine.',
      { hint: 'Wait for VoiceStudio to finish loading, then check again.' },
    );
  }

  if (!response.ok) {
    throw new VoiceClientError(
      'VOICE_ERROR',
      `VoiceStudio answered HTTP ${response.status} on its health endpoint.`,
      { hint: TROUBLESHOOT_HINT },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new VoiceClientError('VOICE_ERROR', 'VoiceStudio returned an unreadable health response.', {
      hint: TROUBLESHOOT_HINT,
    });
  }

  if (!isRecord(body) || body.status !== 'ok') {
    throw new VoiceClientError('VOICE_UNAVAILABLE', 'VoiceStudio reports that it is not ready.', {
      hint: 'Wait for the engine to finish loading, then check again.',
    });
  }

  return {
    version: text(body.version),
    device: text(body.device),
    engine: text(body.engine),
  };
}

function resolveRequestBodySchema(
  document: Record<string, unknown>,
  pathname: string,
  contentType: string,
): Record<string, unknown> | null {
  const paths = document.paths;
  if (!isRecord(paths)) return null;

  const operation = paths[pathname];
  if (!isRecord(operation) || !isRecord(operation.post)) return null;

  const requestBody = operation.post.requestBody;
  if (!isRecord(requestBody) || !isRecord(requestBody.content)) return null;

  const content = requestBody.content[contentType];
  if (!isRecord(content) || !isRecord(content.schema)) return null;

  const schema = content.schema;
  if (typeof schema.$ref === 'string') {
    const prefix = '#/components/schemas/';
    if (!schema.$ref.startsWith(prefix)) return null;
    const name = schema.$ref.slice(prefix.length);
    const components = document.components;
    if (!isRecord(components) || !isRecord(components.schemas)) return null;
    const resolved = components.schemas[name];
    return isRecord(resolved) ? resolved : null;
  }

  return isRecord(schema) ? schema : null;
}

/**
 * GET /openapi.json — discovers the running build's contract and validates
 * the paths and request fields CAERA uses. Nothing is called unless this
 * succeeds.
 */
export async function discoverContract(
  base: string,
  signal?: AbortSignal,
): Promise<VoiceContractInfo> {
  const response = await call(
    base,
    '/openapi.json',
    { method: 'GET' },
    env.voice.discoveryTimeoutMs,
    signal,
  );

  if (!response.ok) {
    throw new VoiceClientError(
      'VOICE_UNSUPPORTED',
      `VoiceStudio did not expose an API document (HTTP ${response.status}).`,
      {
        hint: 'CAERA needs the OpenAPI document from VoiceStudio 0.5 or newer. Update the app and retry.',
        missing: ['GET /openapi.json'],
      },
    );
  }

  let document: unknown;
  try {
    document = await response.json();
  } catch {
    throw new VoiceClientError(
      'VOICE_UNSUPPORTED',
      'VoiceStudio returned an unreadable API document.',
      {
        hint: 'Update VoiceStudio, then check again.',
        missing: ['GET /openapi.json'],
      },
    );
  }

  if (!isRecord(document)) {
    throw new VoiceClientError('VOICE_UNSUPPORTED', 'VoiceStudio returned an unexpected API document.');
  }

  const paths = document.paths;
  const missing: string[] = [];

  if (typeof document.openapi !== 'string') missing.push('OpenAPI version');
  if (!isRecord(paths)) {
    missing.push('paths');
  } else {
    const voices = paths['/v1/audio/voices'];
    if (!isRecord(voices) || !isRecord(voices.get)) missing.push('GET /v1/audio/voices');
    const speech = paths['/v1/audio/speech'];
    if (!isRecord(speech) || !isRecord(speech.post)) missing.push('POST /v1/audio/speech');
    if (!isRecord(paths['/health']) || !isRecord(paths['/health'].get)) {
      missing.push('GET /health');
    }
  }

  const schema = resolveRequestBodySchema(document, '/v1/audio/speech', 'application/json');
  if (!schema) {
    missing.push('SpeechRequest schema');
  } else {
    const properties = schema.properties;
    if (!isRecord(properties)) {
      missing.push('SpeechRequest properties');
    } else {
      if (typeof properties.input !== 'object' || properties.input === null) {
        missing.push('SpeechRequest.input');
      }
      if (typeof properties.model !== 'object' || properties.model === null) {
        missing.push('SpeechRequest.model');
      }
      if (typeof properties.voice !== 'object' || properties.voice === null) {
        missing.push('SpeechRequest.voice');
      }
      if (typeof properties.response_format !== 'object' || properties.response_format === null) {
        missing.push('SpeechRequest.response_format');
      }
      if (typeof properties.speed !== 'object' || properties.speed === null) {
        missing.push('SpeechRequest.speed');
      }
    }
  }

  if (missing.length > 0) {
    throw new VoiceClientError(
      'VOICE_UNSUPPORTED',
      `VoiceStudio is running, but its API is missing ${missing.join(', ')}.`,
      {
        hint: 'Update VoiceStudio to a build that documents the OpenAI-compatible speech API, then check again.',
        missing,
      },
    );
  }

  const properties = schema?.properties;
  const input = isRecord(properties) && isRecord(properties.input) ? properties.input : {};
  const format = isRecord(properties) && isRecord(properties.response_format) ? properties.response_format : {};
  const enumValues = Array.isArray(format.enum) ? format.enum : [];
  const formats: VoiceFormat[] = [];
  if (enumValues.includes('mp3')) formats.push('mp3');
  if (enumValues.includes('wav')) formats.push('wav');

  if (formats.length === 0) {
    throw new VoiceClientError(
      'VOICE_UNSUPPORTED',
      "VoiceStudio's contract does not advertise MP3 or WAV output.",
      {
        hint: 'CAERA only plays browser-supported speech formats. Update VoiceStudio.',
        missing: ['SpeechRequest.response_format enum'],
      },
    );
  }

  const maxLength = typeof input.maxLength === 'number' ? input.maxLength : env.voice.maxInputChars;

  const transcriptionMissing: string[] = [];
  const transcriptionSchema = resolveRequestBodySchema(
    document,
    '/v1/audio/transcriptions',
    'multipart/form-data',
  );

  if (transcriptionSchema === null) {
    transcriptionMissing.push('POST /v1/audio/transcriptions');
  } else {
    const transcriptionProperties = transcriptionSchema.properties;
    if (!isRecord(transcriptionProperties)) {
      transcriptionMissing.push('TranscriptionRequest properties');
    } else if (typeof transcriptionProperties.file !== 'object' || transcriptionProperties.file === null) {
      transcriptionMissing.push('TranscriptionRequest.file');
    }
  }

  const transcriptionProperties =
    transcriptionSchema && isRecord(transcriptionSchema.properties)
      ? transcriptionSchema.properties
      : {};

  return {
    openapiVersion: String(document.openapi),
    formats,
    supportsSpeed: isRecord(properties) && isRecord(properties.speed),
    maxInputChars: Math.max(200, Math.min(env.voice.maxInputChars, Math.floor(maxLength))),
    transcription: {
      available: transcriptionMissing.length === 0,
      supportsModel:
        typeof transcriptionProperties.model === 'object' && transcriptionProperties.model !== null,
      supportsResponseFormat:
        typeof transcriptionProperties.response_format === 'object' &&
        transcriptionProperties.response_format !== null,
      missing: transcriptionMissing,
    },
  };
}

function toVoiceKind(value: string | null): VoiceKind {
  if (value === 'profile') return 'profile';
  if (value === 'openai_alias') return 'openai_alias';
  return 'preset';
}

function toVoiceOption(raw: unknown): VoiceOption | null {
  if (!isRecord(raw)) return null;

  const id = text(raw.voice_id) ?? text(raw.id);
  if (!id || id.length > 120) return null;

  return {
    id,
    name: text(raw.name) ?? id,
    kind: toVoiceKind(text(raw.type)),
    language: text(raw.language),
    description: text(raw.description),
  };
}

function toVoiceEngine(raw: unknown): VoiceEngine | null {
  if (!isRecord(raw)) return null;

  const id = text(raw.id);
  if (!id || id.length > 120) return null;

  return {
    id,
    name: text(raw.display_name) ?? id,
    available: raw.available === true,
    supportsCloning: typeof raw.supports_cloning === 'boolean' ? raw.supports_cloning : null,
  };
}

/** GET /v1/audio/voices — voices and installed engines from the running app. */
export async function fetchCatalog(
  base: string,
  signal?: AbortSignal,
): Promise<VoiceCatalogResult> {
  const response = await call(
    base,
    '/v1/audio/voices',
    { method: 'GET' },
    env.voice.catalogTimeoutMs,
    signal,
  );

  if (!response.ok) {
    throw new VoiceClientError(
      'VOICE_UNSUPPORTED',
      `VoiceStudio answered HTTP ${response.status} when listing voices.`,
      {
        hint: 'Update VoiceStudio, then check again.',
        missing: ['GET /v1/audio/voices'],
      },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new VoiceClientError('VOICE_UNSUPPORTED', 'VoiceStudio returned an unreadable voice list.');
  }

  if (!isRecord(body) || !Array.isArray(body.voices)) {
    throw new VoiceClientError(
      'VOICE_UNSUPPORTED',
      "VoiceStudio's voice list does not use the documented shape.",
      { hint: 'Update VoiceStudio, then check again.' },
    );
  }

  const voices = body.voices
    .map(toVoiceOption)
    .filter((voice): voice is VoiceOption => voice !== null)
    .slice(0, 300);

  const engines = Array.isArray(body.engines)
    ? body.engines
        .map(toVoiceEngine)
        .filter((engine): engine is VoiceEngine => engine !== null)
        .slice(0, 40)
    : [];

  return { voices, engines };
}

function httpFailure(status: number): VoiceClientError {
  if (status === 400 || status === 422) {
    return new VoiceClientError(
      'VOICE_UNSUPPORTED',
      'VoiceStudio rejected the speech request.',
      {
        hint: 'The selected voice, format or speed may not be supported by the active engine.',
      },
    );
  }
  if (status === 401 || status === 403) {
    return new VoiceClientError(
      'VOICE_ERROR',
      `VoiceStudio refused the request (HTTP ${status}).`,
      { hint: 'CAERA connects over loopback only. Check VoiceStudio’s access settings.' },
    );
  }
  if (status === 409) {
    return new VoiceClientError(
      'VOICE_UNAVAILABLE',
      'VoiceStudio needs a speech model installed or selected.',
      { hint: 'Open VoiceStudio, install an engine model, then try again.' },
    );
  }
  if (status === 429) {
    return new VoiceClientError('VOICE_UNAVAILABLE', 'The VoiceStudio speech queue is full.', {
      hint: 'Wait for the current generation to finish, then retry.',
    });
  }
  if (status === 503) {
    return new VoiceClientError('VOICE_UNAVAILABLE', 'VoiceStudio is loading its speech engine.', {
      hint: 'Wait a moment, then try again.',
    });
  }
  if (status === 504) {
    return new VoiceClientError('VOICE_TIMEOUT', 'VoiceStudio timed out while generating speech.');
  }
  return new VoiceClientError('VOICE_ERROR', `VoiceStudio could not generate speech (HTTP ${status}).`);
}

export interface SynthesisRequest {
  voice: string;
  input: string;
  format: VoiceFormat;
  speed: number;
  supportsSpeed: boolean;
  timeoutMs?: number;
}

/** POST /v1/audio/speech — returns the audio bytes, never the request text. */
export interface TranscriptionResult {
  text: string;
  language: string | null;
}

function transcriptionFailure(status: number): VoiceClientError {
  if (status === 400 || status === 422) {
    return new VoiceClientError(
      'VOICE_UNSUPPORTED',
      'VoiceStudio rejected the recording for transcription.',
      {
        hint: 'Check that a speech-recognition model is selected in VoiceStudio and that the recording contains speech.',
      },
    );
  }
  if (status === 401 || status === 403) {
    return new VoiceClientError('VOICE_ERROR', `VoiceStudio refused the transcription (HTTP ${status}).`, {
      hint: 'CAERA connects over loopback only. Check VoiceStudio’s access settings.',
    });
  }
  if (status === 409) {
    return new VoiceClientError(
      'VOICE_UNAVAILABLE',
      'VoiceStudio needs an ASR (speech recognition) model installed or selected.',
      {
        hint: 'Open VoiceStudio’s Model Catalogue, install an ASR model such as Whisper, select it, then try again.',
      },
    );
  }
  if (status === 413) {
    return new VoiceClientError('VOICE_ERROR', 'The recording is too large for VoiceStudio.', {
      hint: 'Keep push-to-talk recordings under a minute, then retry.',
    });
  }
  if (status === 429) {
    return new VoiceClientError('VOICE_UNAVAILABLE', 'The VoiceStudio transcription queue is full.', {
      hint: 'Wait for the current transcription to finish, then retry.',
    });
  }
  if (status === 503) {
    return new VoiceClientError('VOICE_UNAVAILABLE', 'VoiceStudio is loading its speech-recognition engine.', {
      hint: 'Wait a moment, then try again.',
    });
  }
  if (status === 504) {
    return new VoiceClientError('VOICE_TIMEOUT', 'VoiceStudio timed out while transcribing.');
  }
  return new VoiceClientError('VOICE_ERROR', `VoiceStudio could not transcribe the recording (HTTP ${status}).`);
}

/**
 * POST /v1/audio/transcriptions — the documented OpenAI-compatible batch
 * endpoint. Audio is sent only over loopback and never written to disk.
 */
export async function transcribe(
  base: string,
  audio: Buffer,
  options: {
    supportsModel: boolean;
    supportsResponseFormat: boolean;
    timeoutMs?: number;
  },
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'caera-push-to-talk.wav');
  if (options.supportsModel) form.append('model', 'whisper-1');
  if (options.supportsResponseFormat) form.append('response_format', 'json');

  const response = await call(
    base,
    '/v1/audio/transcriptions',
    { method: 'POST', body: form, headers: { Accept: 'application/json' } },
    options.timeoutMs ?? env.voice.transcriptionTimeoutMs,
    signal,
  );

  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // The error response can be discarded best-effort.
    }
    throw transcriptionFailure(response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new VoiceClientError('VOICE_ERROR', 'VoiceStudio returned an unreadable transcript.', {
      hint: 'Update VoiceStudio, then try again.',
    });
  }

  if (!isRecord(body) || typeof body.text !== 'string') {
    throw new VoiceClientError('VOICE_ERROR', 'VoiceStudio returned a transcript in an unexpected shape.');
  }

  const transcript = body.text.replace(/\s+/g, ' ').trim();
  if (!transcript) {
    throw new VoiceClientError('VOICE_ERROR', 'No speech was detected in that recording.', {
      hint: 'Hold the microphone a little longer and speak clearly, then retry.',
    });
  }

  return { text: transcript, language: text(body.language) };
}

export async function synthesize(
  base: string,
  request: SynthesisRequest,
  signal?: AbortSignal,
): Promise<SynthesizedAudio> {
  const body: Record<string, string | number> = {
    model: 'tts-1',
    voice: request.voice,
    input: request.input,
    response_format: request.format,
  };
  if (request.supportsSpeed) body.speed = request.speed;

  const response = await call(
    base,
    '/v1/audio/speech',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/*' },
      body: JSON.stringify(body),
    },
    request.timeoutMs ?? env.voice.timeoutMs,
    signal,
  );

  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // The error response can be discarded best-effort.
    }
    throw httpFailure(response.status);
  }

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!contentType.startsWith('audio/')) {
    try {
      await response.body?.cancel();
    } catch {
      // Discard the unexpected payload.
    }
    throw new VoiceClientError(
      'VOICE_ERROR',
      'VoiceStudio returned a non-audio response for a speech request.',
      { hint: 'Update VoiceStudio, or check its terminal for the failing engine.' },
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new VoiceClientError('VOICE_ERROR', 'VoiceStudio returned an empty audio file.');
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new VoiceClientError('VOICE_ERROR', 'VoiceStudio returned an audio file that is too large.');
  }

  return { bytes: buffer, contentType };
}

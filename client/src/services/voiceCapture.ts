export type VoiceCaptureErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'no-microphone'
  | 'in-use'
  | 'too-short'
  | 'failed';

/** A microphone failure with a safe message and an actionable next step. */
export class VoiceCaptureError extends Error {
  readonly code: VoiceCaptureErrorCode;
  readonly hint?: string;

  constructor(code: VoiceCaptureErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'VoiceCaptureError';
    this.code = code;
    if (hint) this.hint = hint;
  }
}

export interface VoiceCaptureResult {
  audio: Blob;
  durationMs: number;
}

export interface VoiceCaptureSession {
  stop(): Promise<VoiceCaptureResult>;
  cancel(): void;
}

const MIN_DURATION_MS = 300;
const TARGET_SAMPLE_RATE = 16_000;

function mapMediaError(cause: unknown): VoiceCaptureError {
  if (cause instanceof VoiceCaptureError) return cause;

  if (typeof DOMException !== 'undefined' && cause instanceof DOMException) {
    switch (cause.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new VoiceCaptureError(
          'permission-denied',
          'Microphone access was denied.',
          'Allow microphone access for this page, and in Windows check Settings → Privacy & security → Microphone, then try again.',
        );
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return new VoiceCaptureError(
          'no-microphone',
          'No microphone was found on this device.',
          'Connect a microphone, then check Windows sound settings and try again.',
        );
      case 'NotReadableError':
      case 'TrackStartError':
      case 'AbortError':
        return new VoiceCaptureError(
          'in-use',
          'The microphone could not be opened.',
          'Another application may be using it. Close that application and try again.',
        );
      default:
        break;
    }
  }

  return new VoiceCaptureError(
    'failed',
    'The microphone could not start.',
    'Check the Windows microphone privacy setting and the browser’s site permissions, then try again.',
  );
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

/** Encodes the decoded microphone buffer as 16-bit mono PCM WAV. */
function encodeWav(buffer: AudioBuffer): Blob {
  const frames = Math.max(1, Math.round(buffer.duration * TARGET_SAMPLE_RATE));
  const bytes = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(bytes);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, frames * 2, true);

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );

  for (let frame = 0; frame < frames; frame += 1) {
    let sample = 0;
    for (const channel of channels) {
      const position = Math.min(channel.length - 1, Math.floor((frame * buffer.sampleRate) / TARGET_SAMPLE_RATE));
      sample += channel[position] ?? 0;
    }
    sample = Math.max(-1, Math.min(1, sample / channels.length));
    view.setInt16(44 + frame * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return new Blob([bytes], { type: 'audio/wav' });
}

function supportedMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Starts a real push-to-talk capture session. The analyser reports actual
 * time-domain microphone levels; nothing is synthesised when the input is
 * quiet or permission is denied.
 */
export async function beginVoiceCapture(
  onLevel: (level: number) => void,
): Promise<VoiceCaptureSession> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new VoiceCaptureError(
      'unsupported',
      'This browser cannot capture microphone audio.',
      'Use a current version of Chrome or Edge on Windows.',
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (cause) {
    throw mapMediaError(cause);
  }

  let context: AudioContext;
  try {
    context = new AudioContext({ latencyHint: 'interactive' });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    throw new VoiceCaptureError(
      'unsupported',
      'The browser could not open an audio processing context.',
      'Use a current version of Chrome or Edge and try again.',
    );
  }

  await context.resume().catch(() => {
    // MediaRecorder can still capture; the analyser may remain silent.
  });

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.65;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  const startedAt = performance.now();
  let animation = 0;
  let levelPublishedAt = 0;
  let closed = false;
  let stopPromise: Promise<VoiceCaptureResult> | null = null;

  const readLevel = (now: number): void => {
    if (closed) return;

    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) {
      const centred = (value - 128) / 128;
      sum += centred * centred;
    }
    const rms = Math.sqrt(sum / samples.length);

    if (now - levelPublishedAt >= 50) {
      levelPublishedAt = now;
      onLevel(Math.min(1, rms * 6));
    }

    animation = requestAnimationFrame(readLevel);
  };
  animation = requestAnimationFrame(readLevel);

  const mimeType = supportedMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (cause) {
    cancelAnimationFrame(animation);
    stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => undefined);
    throw new VoiceCaptureError(
      'unsupported',
      'The browser could not start an audio recorder.',
      'Use a current version of Chrome or Edge and try again.',
    );
  }

  const chunks: Blob[] = [];
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => {
      reject(new VoiceCaptureError('failed', 'The microphone recording failed.'));
    };
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
    };
  });

  const release = (): void => {
    closed = true;
    cancelAnimationFrame(animation);
    stream.getTracks().forEach((track) => track.stop());
    onLevel(0);
    void context.close().catch(() => undefined);
  };

  recorder.start(250);

  const cancel = (): void => {
    if (closed) return;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      // The recorder can already be inactive.
    }
    release();
  };

  const stop = (): Promise<VoiceCaptureResult> => {
    if (stopPromise) return stopPromise;
    if (closed) {
      return Promise.reject(new VoiceCaptureError('failed', 'The recording has already ended.'));
    }

    stopPromise = (async () => {
      const durationMs = performance.now() - startedAt;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // If the recorder stopped itself, the promise may already be settled.
      }

      const blob = await stopped;
      cancelAnimationFrame(animation);
      stream.getTracks().forEach((track) => track.stop());
      onLevel(0);

      if (durationMs < MIN_DURATION_MS) {
        throw new VoiceCaptureError(
          'too-short',
          'That recording was too short.',
          'Hold the microphone for at least a moment, speak, then release.',
        );
      }

      let decoded: AudioBuffer;
      try {
        decoded = await context.decodeAudioData(await blob.arrayBuffer());
      } catch {
        throw new VoiceCaptureError(
          'failed',
          'The recording could not be decoded.',
          'Try again. If it keeps failing, use a current Chrome or Edge build.',
        );
      }

      if (decoded.duration < 0.25) {
        throw new VoiceCaptureError(
          'too-short',
          'No speech was captured.',
          'Hold the microphone a little longer and speak clearly.',
        );
      }

      return { audio: encodeWav(decoded), durationMs: Math.round(durationMs) };
    })();

    // Release tracks even when too-short/decode rejects; use both handlers so the
    // returned promise stays the only rejection path the caller needs to handle.
    void stopPromise.then(release, release);
    return stopPromise;
  };

  return { stop, cancel };
}

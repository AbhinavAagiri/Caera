import { useCallback, useEffect, useRef, useState } from 'react';
import {
  beginVoiceCapture,
  VoiceCaptureError,
  type VoiceCaptureResult,
  type VoiceCaptureSession,
} from '@/services/voiceCapture';

export type PushToTalkStatus = 'idle' | 'requesting' | 'recording' | 'encoding' | 'error';

export interface PushToTalk {
  status: PushToTalkStatus;
  level: number;
  durationMs: number;
  error: VoiceCaptureError | null;
  supported: boolean;
  start: () => Promise<boolean>;
  stop: () => Promise<VoiceCaptureResult | null>;
  cancel: () => void;
  clearError: () => void;
}

function asCaptureError(cause: unknown): VoiceCaptureError {
  if (cause instanceof VoiceCaptureError) return cause;
  return new VoiceCaptureError(
    'failed',
    'The microphone could not start.',
    'Check the Windows microphone privacy setting and the browser’s site permissions, then try again.',
  );
}

/** Owns one push-to-talk recording at a time. */
export function usePushToTalk(): PushToTalk {
  const [status, setStatus] = useState<PushToTalkStatus>('idle');
  const [level, setLevel] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<VoiceCaptureError | null>(null);

  const statusRef = useRef<PushToTalkStatus>('idle');
  const sessionRef = useRef<VoiceCaptureSession | null>(null);
  const stopPromiseRef = useRef<Promise<VoiceCaptureResult | null> | null>(null);
  const cancelRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const updateStatus = useCallback((next: PushToTalkStatus): void => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRef.current = true;
      clearTimer();
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, [clearTimer]);

  const start = useCallback(async (): Promise<boolean> => {
    if (
      statusRef.current === 'requesting' ||
      statusRef.current === 'recording' ||
      statusRef.current === 'encoding'
    ) {
      return false;
    }

    cancelRef.current = false;
    setError(null);
    setLevel(0);
    setDurationMs(0);
    updateStatus('requesting');

    try {
      const session = await beginVoiceCapture((next) => {
        if (mountedRef.current) setLevel(next);
      });

      if (!mountedRef.current || cancelRef.current) {
        session.cancel();
        updateStatus('idle');
        return false;
      }

      sessionRef.current = session;
      startedAtRef.current = performance.now();
      updateStatus('recording');
      clearTimer();
      timerRef.current = window.setInterval(() => {
        if (mountedRef.current) setDurationMs(performance.now() - startedAtRef.current);
      }, 100);
      return true;
    } catch (cause) {
      sessionRef.current = null;
      updateStatus('error');
      if (mountedRef.current) {
        setError(asCaptureError(cause));
        setLevel(0);
        setDurationMs(0);
      }
      return false;
    }
  }, [clearTimer, updateStatus]);

  const stop = useCallback(async (): Promise<VoiceCaptureResult | null> => {
    if (stopPromiseRef.current) return stopPromiseRef.current;

    if (statusRef.current === 'requesting') {
      cancelRef.current = true;
      updateStatus('idle');
      return null;
    }

    const session = sessionRef.current;
    if (!session) return null;

    clearTimer();
    updateStatus('encoding');

    const promise = (async (): Promise<VoiceCaptureResult | null> => {
      try {
        const result = await session.stop();
        sessionRef.current = null;
        updateStatus('idle');
        if (mountedRef.current) {
          setDurationMs(result.durationMs);
          setLevel(0);
        }
        return result;
      } catch (cause) {
        sessionRef.current = null;
        updateStatus('error');
        if (mountedRef.current) {
          setError(asCaptureError(cause));
          setLevel(0);
        }
        return null;
      } finally {
        stopPromiseRef.current = null;
      }
    })();

    stopPromiseRef.current = promise;
    return promise;
  }, [clearTimer, updateStatus]);

  const cancel = useCallback((): void => {
    cancelRef.current = true;
    clearTimer();
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.cancel();
    updateStatus('idle');
    if (mountedRef.current) {
      setLevel(0);
      setDurationMs(0);
    }
  }, [clearTimer, updateStatus]);

  const clearError = useCallback((): void => {
    setError(null);
    if (statusRef.current === 'error') updateStatus('idle');
  }, [updateStatus]);

  return {
    status,
    level,
    durationMs,
    error,
    supported:
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== 'undefined',
    start,
    stop,
    cancel,
    clearError,
  };
}

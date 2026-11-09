import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiSnapshot } from '@shared';
import { api, isAbortError, toApiError } from '@/services/api';

export interface AiState {
  snapshot: AiSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setSnapshot: (snapshot: AiSnapshot) => void;
}

export function useAi(): AiState {
  const [snapshot, setSnapshotState] = useState<AiSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const next = await api.aiSnapshot(controller.signal);
      if (controller.signal.aborted) return;
      setSnapshotState(next);
      setError(null);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(toApiError(cause).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);

  const setSnapshot = useCallback((next: AiSnapshot) => {
    setSnapshotState(next);
    setError(null);
  }, []);

  return { snapshot, loading, error, refresh, setSnapshot };
}

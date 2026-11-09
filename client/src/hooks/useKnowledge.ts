import { useCallback, useEffect, useState } from 'react';
import type {
  KnowledgeClearResult,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeSettingsInput,
  KnowledgeSnapshot,
  KnowledgeSyncResult,
} from '@shared';
import { api, isAbortError, toApiError, type ApiRequestError } from '@/services/api';

interface KnowledgeState {
  snapshot: KnowledgeSnapshot | null;
  loading: boolean;
  error: ApiRequestError | null;
  refresh: () => void;
  updateSettings: (input: KnowledgeSettingsInput) => Promise<KnowledgeSnapshot>;
  sync: (sources?: string[]) => Promise<KnowledgeSyncResult>;
  search: (input: KnowledgeSearchInput) => Promise<KnowledgeSearchResult>;
  clear: (source?: string) => Promise<KnowledgeClearResult>;
}

export function useKnowledge(): KnowledgeState {
  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    api
      .knowledge(controller.signal)
      .then((data) => {
        if (!alive) return;
        setSnapshot(data);
        setError(null);
      })
      .catch((cause) => {
        if (!alive || isAbortError(cause)) return;
        setError(toApiError(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [revision]);

  const updateSettings = useCallback(async (input: KnowledgeSettingsInput) => {
    const next = await api.updateKnowledgeSettings(input);
    setSnapshot(next);
    return next;
  }, []);

  const sync = useCallback(
    async (sources?: string[]) => {
      const result = await api.syncKnowledge(sources);
      const next = await api.knowledge();
      setSnapshot(next);
      return result;
    },
    [],
  );

  const search = useCallback((input: KnowledgeSearchInput) => api.searchKnowledge(input), []);

  const clear = useCallback(async (source?: string) => {
    const result = await api.clearKnowledge(source);
    const next = await api.knowledge();
    setSnapshot(next);
    return result;
  }, []);

  return { snapshot, loading, error, refresh, updateSettings, sync, search, clear };
}

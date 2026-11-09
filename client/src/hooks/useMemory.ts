import { useCallback, useEffect, useState } from 'react';
import type {
  MemoryEntry,
  MemoryEntryInput,
  MemoryKind,
  MemoryUpdateInput,
} from '@shared';
import { api, isAbortError, toApiError, type ApiRequestError } from '@/services/api';

interface MemoryState {
  entries: MemoryEntry[];
  total: number;
  paused: boolean;
  loading: boolean;
  error: ApiRequestError | null;
  refresh: () => void;
  create: (input: MemoryEntryInput) => Promise<MemoryEntry>;
  update: (id: string, input: MemoryUpdateInput) => Promise<MemoryEntry>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<number>;
  setPaused: (paused: boolean) => Promise<void>;
}

export function useMemory(options: { query?: string; kind?: MemoryKind } = {}): MemoryState {
  const query = options.query?.trim() ?? '';
  const kind = options.kind;
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [paused, setPausedState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    setLoading(true);
    api
      .listMemory(
        { ...(query ? { query } : {}), ...(kind ? { kind } : {}) },
        controller.signal,
      )
      .then((data) => {
        if (!alive) return;
        setEntries(data.entries);
        setTotal(data.total);
        setPausedState(data.paused);
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
  }, [query, kind, revision]);

  const create = useCallback(
    async (input: MemoryEntryInput): Promise<MemoryEntry> => {
      const result = await api.createMemory(input);
      refresh();
      return result.entry;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, input: MemoryUpdateInput): Promise<MemoryEntry> => {
      const result = await api.updateMemory(id, input);
      refresh();
      return result.entry;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await api.deleteMemory(id);
      refresh();
    },
    [refresh],
  );

  const clear = useCallback(async (): Promise<number> => {
    const result = await api.clearMemories();
    refresh();
    return result.deleted;
  }, [refresh]);

  const setPaused = useCallback(
    async (next: boolean): Promise<void> => {
      const result = await api.updateMemorySettings(next);
      setPausedState(result.paused);
      refresh();
    },
    [refresh],
  );

  return { entries, total, paused, loading, error, refresh, create, update, remove, clear, setPaused };
}

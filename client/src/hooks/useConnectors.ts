import { useCallback, useEffect, useState } from 'react';
import type {
  ConnectorPermissionInput,
  ConnectorSnapshot,
  ConnectorTestResult,
} from '@shared';
import { api, isAbortError, toApiError, type ApiRequestError } from '@/services/api';

interface ConnectorsState {
  snapshot: ConnectorSnapshot | null;
  loading: boolean;
  error: ApiRequestError | null;
  refresh: () => void;
  connect: (id: string, configuration: Record<string, string>) => Promise<ConnectorSnapshot>;
  test: (id: string) => Promise<ConnectorTestResult>;
  updatePermissions: (
    id: string,
    input: ConnectorPermissionInput,
  ) => Promise<ConnectorSnapshot>;
  disconnect: (id: string) => Promise<ConnectorSnapshot>;
}

export function useConnectors(): ConnectorsState {
  const [snapshot, setSnapshot] = useState<ConnectorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    setLoading(true);
    api
      .connectors(controller.signal)
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

  const connect = useCallback(
    async (id: string, configuration: Record<string, string>): Promise<ConnectorSnapshot> => {
      const next = await api.connectConnector(id, configuration);
      setSnapshot(next);
      return next;
    },
    [],
  );

  const test = useCallback(async (id: string): Promise<ConnectorTestResult> => {
    return api.testConnector(id);
  }, []);

  const updatePermissions = useCallback(
    async (id: string, input: ConnectorPermissionInput): Promise<ConnectorSnapshot> => {
      const next = await api.updateConnectorPermissions(id, input);
      setSnapshot(next);
      return next;
    },
    [],
  );

  const disconnect = useCallback(async (id: string): Promise<ConnectorSnapshot> => {
    const next = await api.disconnectConnector(id);
    setSnapshot(next);
    return next;
  }, []);

  return { snapshot, loading, error, refresh, connect, test, updatePermissions, disconnect };
}

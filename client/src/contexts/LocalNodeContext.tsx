import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { HealthReport } from '@shared';
import { api, isAbortError, toApiError, type ApiRequestError } from '@/services/api';

export type NodeStatus = 'checking' | 'online' | 'offline';

interface LocalNodeValue {
  status: NodeStatus;
  report: HealthReport | null;
  error: ApiRequestError | null;
  isRefreshing: boolean;
  refresh: () => void;
}

const LocalNodeContext = createContext<LocalNodeValue | null>(null);
const POLL_INTERVAL = 15_000;

export function LocalNodeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<NodeStatus>('checking');
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const probeRef = useRef<() => Promise<void>>(async () => undefined);

  const refresh = useCallback(() => {
    void probeRef.current();
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;

    const probe = async (): Promise<void> => {
      controller?.abort();
      const local = new AbortController();
      controller = local;
      setIsRefreshing(true);

      try {
        const next = await api.health(local.signal);
        if (!alive) return;
        setReport(next);
        setStatus('online');
        setError(null);
      } catch (cause) {
        if (!alive || isAbortError(cause)) return;
        setStatus('offline');
        setReport(null);
        setError(toApiError(cause));
      } finally {
        if (alive) {
          setIsRefreshing(false);
          timer = setTimeout(() => void probe(), POLL_INTERVAL);
        }
      }
    };

    probeRef.current = probe;
    void probe();

    const onFocus = (): void => {
      void probe();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      alive = false;
      controller?.abort();
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const value = useMemo(
    () => ({ status, report, error, isRefreshing, refresh }),
    [status, report, error, isRefreshing, refresh],
  );

  return <LocalNodeContext.Provider value={value}>{children}</LocalNodeContext.Provider>;
}

export function useLocalNode(): LocalNodeValue {
  const value = useContext(LocalNodeContext);
  if (!value) throw new Error('useLocalNode must be used inside LocalNodeProvider');
  return value;
}

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
import type {
  ActivityEvent,
  ActivityStatus,
  ActivityStreamEvent,
  ActivityStreamHello,
} from '@shared';

export type StreamState = 'connecting' | 'live' | 'reconnecting';

interface ActivityValue {
  events: ActivityEvent[];
  stream: StreamState;
  clear: () => void;
}

const ActivityContext = createContext<ActivityValue | null>(null);
const MAX_EVENTS = 160;

function mergeEvents(incoming: ActivityEvent[], current: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  for (const event of [...incoming, ...current]) byId.set(event.id, event);
  return [...byId.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_EVENTS);
}

function clientEvent(
  summary: string,
  status: ActivityStatus = 'info',
): ActivityEvent {
  return {
    id: `client-${crypto.randomUUID()}`,
    kind: 'connection',
    status,
    summary,
    detail: 'Browser session',
    at: new Date().toISOString(),
    source: 'client',
  };
}

export function ActivityProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [stream, setStream] = useState<StreamState>('connecting');
  const wasLive = useRef(false);

  useEffect(() => {
    const source = new EventSource('/api/events');

    source.addEventListener('open', () => {
      setStream('live');
      if (!wasLive.current) {
        wasLive.current = true;
        setEvents((current) => mergeEvents([clientEvent('Activity stream connected')], current));
      }
    });

    source.addEventListener('hello', (raw) => {
      try {
        const message = JSON.parse((raw as MessageEvent<string>).data) as ActivityStreamHello;
        setEvents((current) => mergeEvents(message.events, current));
      } catch {
        // Malformed frames are ignored; the stream stays open.
      }
    });

    source.addEventListener('activity', (raw) => {
      try {
        const message = JSON.parse((raw as MessageEvent<string>).data) as ActivityStreamEvent;
        setEvents((current) => mergeEvents([message.event], current));
      } catch {
        // See above.
      }
    });

    source.addEventListener('error', () => {
      setStream('reconnecting');
      if (wasLive.current) {
        wasLive.current = false;
        setEvents((current) =>
          mergeEvents([clientEvent('Activity stream disconnected', 'failed')], current),
        );
      }
    });

    return () => {
      source.close();
      wasLive.current = false;
    };
  }, []);

  const clear = useCallback(() => setEvents([]), []);

  const value = useMemo(() => ({ events, stream, clear }), [events, stream, clear]);

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity(): ActivityValue {
  const value = useContext(ActivityContext);
  if (!value) throw new Error('useActivity must be used inside ActivityProvider');
  return value;
}

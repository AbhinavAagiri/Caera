import { randomUUID } from 'node:crypto';
import type { ActivityEvent, ActivityKind, ActivityStatus } from '@shared';

type ActivityInput = {
  kind: ActivityKind;
  status: ActivityStatus;
  summary: string;
  detail?: string | null;
  meta?: Record<string, string | number | boolean>;
};

const HISTORY_LIMIT = 120;
const history: ActivityEvent[] = [];
const clients = new Set<(event: ActivityEvent) => void>();

/** Records a real node event. The bus only publishes events that actually happened. */
export function publish(input: ActivityInput): ActivityEvent {
  const event: ActivityEvent = {
    id: randomUUID(),
    kind: input.kind,
    status: input.status,
    summary: input.summary,
    detail: input.detail ?? null,
    at: new Date().toISOString(),
    source: 'server',
    ...(input.meta ? { meta: input.meta } : {}),
  };

  history.unshift(event);
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;

  for (const client of clients) {
    client(event);
  }

  return event;
}

export function recentEvents(limit = 60): ActivityEvent[] {
  return history.slice(0, limit);
}

export function subscribe(listener: (event: ActivityEvent) => void): () => void {
  clients.add(listener);
  return () => {
    clients.delete(listener);
  };
}

export function streamCount(): number {
  return clients.size;
}

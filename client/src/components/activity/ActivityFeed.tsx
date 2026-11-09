import type { ActivityEvent } from '@shared';
import { formatClock } from '@/lib/format';

export function activityColor(event: Pick<ActivityEvent, 'status' | 'kind'>): string {
  if (event.status === 'failed') return 'var(--c-danger)';
  if (event.kind === 'confirmation') return 'var(--c-warn)';
  if (event.status === 'completed') return 'var(--c-ok)';
  return 'var(--c-ink-4)';
}

export function ActivityFeed({
  events,
  limit = 6,
  empty = 'No events yet. Real activity from this node appears here.',
}: {
  events: ActivityEvent[];
  limit?: number;
  empty?: string;
}): React.JSX.Element {
  if (events.length === 0) {
    return <p className="feed-empty">{empty}</p>;
  }

  return (
    <div className="feed">
      {events.slice(0, limit).map((event) => (
        <div key={event.id} className="feed-row">
          <span
            aria-hidden="true"
            className="feed-dot"
            style={{ backgroundColor: activityColor(event) }}
          />
          <div className="min-w-0">
            <p className="feed-summary" title={event.detail || event.summary}>
              {event.summary}
            </p>
          </div>
          <time dateTime={event.at} className="feed-time">
            {formatClock(event.at)}
          </time>
        </div>
      ))}
    </div>
  );
}

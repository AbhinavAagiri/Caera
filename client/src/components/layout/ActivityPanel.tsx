import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActivityEvent, ActivityKind } from '@shared';
import { activityColor } from '@/components/activity/ActivityFeed';
import { Icon } from '@/components/icons/Icon';
import { IconButton } from '@/components/ui/Button';
import { StatusDot } from '@/components/ui/Indicators';
import { Visualizer } from '@/components/visualizer/Visualizer';
import { useActivity } from '@/contexts/ActivityContext';
import { useInstrumentState } from '@/hooks/useInstrumentState';
import { cn } from '@/lib/cn';
import { formatClock, formatRelative, pluralize } from '@/lib/format';

type Filter = 'all' | 'errors';

const KIND_LABEL: Record<ActivityKind, string> = {
  agent: 'agent',
  confirmation: 'approval',
  connection: 'link',
  conversation: 'thread',
  message: 'message',
  provider: 'provider',
  tool: 'tool',
  voice: 'voice',
  memory: 'memory',
  research: 'research',
  error: 'error',
  system: 'system',
};

function AgentActivitySummary({ events }: { events: ActivityEvent[] }): React.JSX.Element | null {
  const navigate = useNavigate();
  const agentEvent = events.find((event) => typeof event.meta?.runId === 'string');
  if (!agentEvent) return null;

  const runId = String(agentEvent.meta?.runId ?? '');
  const scoped = events.filter((event) => String(event.meta?.runId ?? '') === runId);
  const taskEvent = scoped.find(
    (event) => event.kind === 'agent' && event.summary === 'Agent task started',
  );
  const stepEvent = scoped.find(
    (event) => event.kind === 'agent' && event.meta?.step !== undefined,
  );
  const toolEvent = scoped.find((event) => event.kind === 'tool' && event.meta?.tool !== undefined);
  const confirmation = agentEvent.kind === 'confirmation' ? agentEvent : null;
  const task =
    typeof taskEvent?.meta?.task === 'string' ? taskEvent.meta.task : (taskEvent?.detail ?? null);

  return (
    <section className="border-b border-line px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-ink-4">
          Latest agent run
        </p>
        <button
          type="button"
          onClick={() => navigate('/agent')}
          className="font-mono text-[8.5px] uppercase tracking-[0.05em] text-ink-3 t-ui hover:text-ink"
        >
          Open agent
        </button>
      </div>
      <div className="mt-2 space-y-1.5 text-[10.5px] leading-[1.5]">
        {task ? (
          <p className="truncate text-ink-2" title={task}>
            <span className="text-ink-4">Task </span>
            {task}
          </p>
        ) : null}
        <p className="truncate text-ink-3" title={stepEvent?.summary}>
          <span className="text-ink-4">Step </span>
          {stepEvent?.summary ?? 'Understanding or planning'}
        </p>
        <p className="truncate text-ink-3" title={toolEvent?.summary}>
          <span className="text-ink-4">Tool </span>
          {toolEvent?.summary ?? 'None selected yet'}
        </p>
        <p className="truncate text-ink-3" title={agentEvent.detail ?? undefined}>
          <span className="text-ink-4">Status </span>
          {agentEvent.summary}
        </p>
      </div>
      {confirmation ? (
        <p className="mt-2 rounded-[4px] border border-[color-mix(in_oklab,var(--c-warn)_28%,transparent)] bg-[color-mix(in_oklab,var(--c-warn)_7%,transparent)] px-2 py-1.5 text-[10px] leading-[1.5] text-warn">
          Waiting for exact-action approval. Nothing has run.
        </p>
      ) : null}
    </section>
  );
}

export function ActivityPanel({ onClose }: { onClose?: () => void }): React.JSX.Element {
  const { events, stream, clear } = useActivity();
  const [filter, setFilter] = useState<Filter>('all');
  const instrument = useInstrumentState({ allowPreview: false });

  const filtered = useMemo(
    () => (filter === 'errors' ? events.filter((event) => event.status === 'failed') : events),
    [events, filter],
  );

  const streamLabel =
    stream === 'live' ? 'live stream' : stream === 'connecting' ? 'connecting' : 'reconnecting';

  return (
    <div className="activity-panel">
      <header className="activity-head">
        <Visualizer state={instrument} size={28} compact />
        <div className="min-w-0 flex-1">
          <h2>Activity log</h2>
          <p>Local node / {streamLabel}</p>
        </div>
        {onClose ? (
          <IconButton icon="close" label="Close activity" size="sm" onClick={onClose} />
        ) : null}
      </header>

      <AgentActivitySummary events={events} />

      <div className="activity-filters">
        <button
          type="button"
          className="activity-filter"
          data-active={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          type="button"
          className="activity-filter"
          data-active={filter === 'errors'}
          onClick={() => setFilter('errors')}
        >
          Errors
        </button>
        <span className="activity-count">
          {filtered.length} / {events.length} {events.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      <div className="activity-list" aria-live="polite">
        {filtered.length === 0 ? (
          <div className="activity-empty">
            <span className="glyph">
              <Icon name={filter === 'errors' ? 'shield' : 'terminal'} size={15} />
            </span>
            <p>
              {filter === 'errors'
                ? 'No failed operations in this session.'
                : 'The log is quiet. Real local events appear here as the node works; nothing is simulated.'}
            </p>
          </div>
        ) : (
          filtered.map((event) => (
            <div key={event.id} className="activity-row">
              <time dateTime={event.at} className="activity-time">
                {formatClock(event.at)}
              </time>
              <span
                aria-hidden="true"
                className="activity-dot"
                style={{ backgroundColor: activityColor(event) }}
              />
              <div className="activity-body">
                <div className="activity-summary">
                  <strong title={event.summary}>{event.summary}</strong>
                  <span className="shrink-0 text-[10px] text-ink-4">
                    {formatRelative(event.at)}
                  </span>
                </div>
                {event.detail ? <p className="activity-detail">{event.detail}</p> : null}
                <p className="activity-tags">
                  <span>{event.source}</span>
                  <span aria-hidden="true">/</span>
                  <span>{KIND_LABEL[event.kind]}</span>
                  <span aria-hidden="true">/</span>
                  <span className={cn(event.status === 'failed' && 'failed')}>{event.status}</span>
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="activity-foot">
        <span className="flex items-center gap-1.5">
          <StatusDot tone={stream === 'live' ? 'online' : 'pending'} />
          {streamLabel} / {pluralize(events.length, 'event')}
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={events.length === 0}
          className="disabled:cursor-not-allowed disabled:opacity-35"
        >
          Clear view
        </button>
      </div>
    </div>
  );
}


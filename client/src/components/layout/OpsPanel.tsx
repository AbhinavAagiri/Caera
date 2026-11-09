import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Conversation } from '@shared';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { Icon } from '@/components/icons/Icon';
import { IconButton } from '@/components/ui/Button';
import { StatusDot, type StatusTone } from '@/components/ui/Indicators';
import { useActivity } from '@/contexts/ActivityContext';
import { useAppChrome } from '@/contexts/AppChromeContext';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { pluralize } from '@/lib/format';
import type { ApiRequestError } from '@/services/api';

interface OpsPanelProps {
  conversation: Conversation | null;
  pending: boolean;
  sendError: ApiRequestError | null;
  onOpenThread: () => void;
  onClose?: () => void;
}

export function OpsPanel({
  conversation,
  pending,
  sendError,
  onOpenThread,
  onClose,
}: OpsPanelProps): React.JSX.Element {
  const navigate = useNavigate();
  const node = useLocalNode();
  const { events } = useActivity();
  const { openActivity } = useAppChrome();
  const [activityOpen, setActivityOpen] = useState(true);

  const task = useMemo<{ label: string; detail: string; tone: StatusTone; active: boolean }>(() => {
    if (node.status === 'offline') {
      return {
        label: 'Signal lost',
        detail: 'The local node is unreachable. The field holds its last known light.',
        tone: 'error',
        active: false,
      };
    }
    if (node.status === 'checking') {
      return {
        label: 'Contacting node',
        detail: 'Checking the local service before accepting a command.',
        tone: 'pending',
        active: true,
      };
    }
    if (sendError) {
      return {
        label: 'Operation fault',
        detail: sendError.message,
        tone: 'error',
        active: false,
      };
    }
    if (pending) {
      return {
        label: 'Generating reply',
        detail: 'The local node is streaming a routed reply. Stop cancels the request.',
        tone: 'accent',
        active: true,
      };
    }
    return {
      label: 'Awaiting command',
      detail: conversation
        ? 'The thread is idle. The command deck is routed to the open conversation.'
        : 'The field is quiet. Issue a command or open a stored thread.',
      tone: 'online',
      active: false,
    };
  }, [conversation, node.status, pending, sendError]);

  const voiceReady = node.report?.voice.state === 'ready';
  const voiceEnabled = node.report?.voice.enabled ?? false;
  const memoryReady = node.report?.memory.state === 'ready';
  const memoryPaused = node.report?.memory.state === 'paused';
  const memoryEntries = node.report?.memory.entries ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onClose ? (
        <div className="side-tabs shrink-0">
          <span className="side-tab" data-active="true">
            Operations
          </span>
          <div className="side-spacer" />
          <IconButton icon="close" label="Close operations" size="sm" onClick={onClose} />
        </div>
      ) : null}

      <div className="ops-scroll">
        <section className="ops-section" aria-labelledby="ops-task">
          <div className="ops-section-head">
            <p id="ops-task" className="rail-title">
              Current task
            </p>
            <span className="text-[10px] text-ink-4">
              {task.active ? 'Active' : 'Standby'}
            </span>
          </div>

          <div className="ops-task">
            <div className="ops-task-state">
              <StatusDot tone={task.tone} />
              <span>{task.label}</span>
            </div>
            <p>{task.detail}</p>
            {pending ? <div className="scanline" aria-hidden="true" /> : null}
            <div className="ops-task-meta">
              <span>{conversation ? pluralize(conversation.messageCount, 'message') : 'No thread open'}</span>
              {conversation ? (
                <button
                  type="button"
                  onClick={onOpenThread}
                  className="inline-flex items-center gap-1 text-ink-3 transition-colors hover:text-ink"
                >
                  Open thread
                  <Icon name="chevronRight" size={9} />
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="ops-section" aria-labelledby="ops-activity">
          <div className="ops-section-head">
            <p id="ops-activity" className="rail-title">
              Live activity
            </p>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setActivityOpen((value) => !value)}
                aria-expanded={activityOpen}
                aria-controls="ops-feed"
                className="side-action"
                title={activityOpen ? 'Collapse activity' : 'Expand activity'}
              >
                <Icon
                  name="chevronDown"
                  size={12}
                  style={{ transform: activityOpen ? undefined : 'rotate(-90deg)' }}
                />
              </button>
              <button
                type="button"
                onClick={openActivity}
                className="side-action"
                title="Open the full activity log"
                aria-label="Open the full activity log"
              >
                <Icon name="arrowUpRight" size={12} />
              </button>
            </div>
          </div>

          <div id="ops-feed">
            {activityOpen ? (
              <ActivityFeed
                events={events}
                limit={4}
                empty="No local events yet. Commands and node operations appear here."
              />
            ) : (
              <p className="feed-empty">
                {events.length > 0
                  ? `${pluralize(events.length, 'event')} hidden. Expand to inspect.`
                  : 'Feed collapsed. Nothing stored.'}
              </p>
            )}
          </div>

        </section>

        <section className="ops-section" aria-labelledby="ops-capabilities">
          <div className="ops-section-head">
            <p id="ops-capabilities" className="rail-title">
              Capabilities
            </p>
          </div>
          <div className="caps-list">
            <button type="button" className="caps-row" onClick={() => navigate('/memory')}>
              <span className="flex items-center gap-1.5">
                <Icon name="memory" size={12} className="text-ink-4" />
                Local memory
              </span>
              <span>
                {memoryPaused
                  ? `${pluralize(memoryEntries, 'entry', 'entries')} · paused`
                  : memoryReady
                    ? pluralize(memoryEntries, 'entry', 'entries')
                    : 'Unknown'}
              </span>
            </button>
            <button type="button" className="caps-row" onClick={() => navigate('/settings/voice')}>
              <span className="flex items-center gap-1.5">
                <Icon name="mic" size={12} className="text-ink-4" />
                Voice channel
              </span>
              <span>{voiceReady ? (voiceEnabled ? 'Ready' : 'Output off') : 'Unavailable'}</span>
            </button>
            <button type="button" className="caps-row" onClick={() => navigate('/tools')}>
              <span className="flex items-center gap-1.5">
                <Icon name="shield" size={12} className="text-ink-4" />
                Tool runtime
              </span>
              <span>Planned</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

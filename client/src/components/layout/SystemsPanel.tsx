import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { IconButton } from '@/components/ui/Button';
import { StatusDot, type StatusTone } from '@/components/ui/Indicators';
import { useToast } from '@/components/ui/Toast';
import { useAppChrome } from '@/contexts/AppChromeContext';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { formatRelative, pluralize } from '@/lib/format';

function SystemRow({
  icon,
  label,
  value,
  tone,
  onClick,
  title,
}: {
  icon: IconName;
  label: string;
  value: string;
  tone: StatusTone;
  onClick?: () => void;
  title?: string;
}): React.JSX.Element {
  const content = (
    <>
      <span className="telemetry-key">
        <Icon name={icon} size={13} className="shrink-0 text-ink-4" />
        <span>{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <StatusDot tone={tone} />
        <span className="telemetry-value">{value}</span>
      </span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="telemetry-row" title={title}>
        {content}
      </button>
    );
  }

  return <div className="telemetry-row">{content}</div>;
}

export function SystemsPanel({ onClose }: { onClose?: () => void }): React.JSX.Element {
  const navigate = useNavigate();
  const node = useLocalNode();
  const { openNodeStatus } = useAppChrome();
  const { push } = useToast();

  const report = node.report;
  const providerState = report?.provider.state;
  const providerReady = providerState === 'configured' || providerState === 'connected';
  const providerTone: StatusTone =
    providerState === 'error' ? 'error' : providerReady ? 'online' : 'muted';
  const voiceReady = report?.voice.state === 'ready';
  const voiceEnabled = report?.voice.enabled ?? false;
  const nodeTone: StatusTone =
    node.status === 'online' ? 'online' : node.status === 'checking' ? 'pending' : 'error';

  const refresh = (): void => {
    node.refresh();
    push('Rechecking the local node', { detail: 'Systems update from the real health endpoint.' });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="systems-head shrink-0">
        <div>
          <p className="rail-title">Systems</p>
          <p className="mt-1 text-[10.5px] leading-[1.45] text-ink-4">
            {node.status === 'online'
              ? report
                ? `Node v${report.version}, started ${formatRelative(report.startedAt)}`
                : 'Node online'
              : node.status === 'checking'
                ? 'Contacting local node'
                : 'No local signal'}
          </p>
        </div>
        {onClose ? (
          <IconButton icon="close" label="Close systems" size="sm" onClick={onClose} />
        ) : (
          <StatusDot tone={nodeTone} className="mr-1" />
        )}
      </div>

      <div className="systems-body min-h-0 flex-1 overflow-y-auto">
        <section className="systems-section" aria-labelledby="systems-overview">
          <p id="systems-overview" className="rail-title mb-1">
            Overview
          </p>
          <SystemRow
            icon="node"
            label="Local node"
            value={node.status === 'online' ? 'Online' : node.status === 'checking' ? 'Checking' : 'Offline'}
            tone={nodeTone}
            onClick={openNodeStatus}
            title="Inspect the local service"
          />
          <SystemRow
            icon="globe"
            label="Model"
            value={
              !report
                ? 'Unknown'
                : providerState === 'configured'
                  ? 'Configured'
                  : providerState === 'connected'
                    ? 'Connected'
                    : providerState === 'error'
                      ? 'Fault'
                      : 'Not set'
            }
            tone={providerTone}
            onClick={() => navigate('/settings/provider')}
            title="Open provider settings"
          />
          <SystemRow
            icon="mic"
            label="VoiceStudio"
            value={
              !report
                ? 'Unknown'
                : voiceReady
                  ? voiceEnabled
                    ? 'Ready'
                    : 'Output off'
                  : 'Unavailable'
            }
            tone={voiceReady && voiceEnabled ? 'online' : 'muted'}
            onClick={() => navigate('/settings/voice')}
            title="Open voice settings"
          />
          <SystemRow
            icon="memory"
            label="Memory"
            value={
              !report
                ? 'Unknown'
                : report.memory.state === 'paused'
                  ? `${pluralize(report.memory.entries, 'entry', 'entries')} · paused`
                  : pluralize(report.memory.entries, 'entry', 'entries')
            }
            tone={report ? (report.memory.state === 'paused' ? 'pending' : 'online') : 'muted'}
            onClick={() => navigate('/memory')}
            title="Inspect memory"
          />
        </section>

        <section className="systems-section" aria-labelledby="systems-runtime">
          <p id="systems-runtime" className="rail-title mb-1">
            Runtime
          </p>
          <SystemRow
            icon="network"
            label="Local service"
            value={node.status === 'online' ? 'Up' : 'Down'}
            tone={nodeTone}
            onClick={openNodeStatus}
            title="Inspect the local service"
          />
          <SystemRow
            icon="storage"
            label="Local store"
            value={
              report
                ? `${report.storage.conversations} threads`
                : 'Unavailable'
            }
            tone={report ? 'online' : 'muted'}
            onClick={() => navigate('/settings/general')}
            title="Open local data settings"
          />
        </section>

        <div className="systems-foot">
          <div className="flex items-center justify-between gap-2">
            <span>This device, local only</span>
            <button
              type="button"
              onClick={refresh}
              disabled={node.isRefreshing}
              className="inline-flex items-center gap-1 text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
            >
              <Icon name="refresh" size={10} />
              {node.isRefreshing ? 'Checking' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

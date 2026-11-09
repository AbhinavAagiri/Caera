import type { ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Chip, StatusDot } from '@/components/ui/Indicators';
import { Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { formatDuration } from '@/lib/format';

function DetailRow({ label, value }: { label: string; value: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-[12px] text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right text-[12px] text-ink">{value}</dd>
    </div>
  );
}

export function NodeStatusDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { status, report, error, refresh, isRefreshing } = useLocalNode();
  const { push } = useToast();

  const copyDiagnostics = async (): Promise<void> => {
    const diagnostics = {
      capturedAt: new Date().toISOString(),
      status,
      error: error ? { code: error.code, message: error.message } : null,
      report,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      push('Diagnostics copied', { detail: 'Node status only. No conversations are included.', tone: 'success' });
    } catch {
      push('Clipboard unavailable', { detail: 'The browser blocked clipboard access.', tone: 'error' });
    }
  };

  return (
    <Modal open={open} onClose={onClose} label="Local node status" width={520}>
      <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5">
        <div>
          <h2 className="text-[14px] font-medium text-ink">Local node</h2>
          <p className="mt-0.5 font-mono text-[10.5px] text-ink-3">127.0.0.1:5174 · Express</p>
        </div>
        <IconButton icon="close" label="Close node status" onClick={onClose} size="sm" />
      </div>

      <div className="px-4 py-1">
        <dl className="divide-y divide-line">
          <DetailRow
            label="Status"
            value={
              <span className="inline-flex items-center gap-1.5">
                <StatusDot
                  tone={status === 'online' ? 'online' : status === 'checking' ? 'pending' : 'error'}
                />
                {status === 'online' ? 'Online' : status === 'checking' ? 'Checking' : 'Unreachable'}
              </span>
            }
          />
          <DetailRow
            label="Version"
            value={<span className="font-mono text-[11px]">{report?.version ?? '—'}</span>}
          />
          <DetailRow label="Phase" value={<span className="font-mono text-[11px]">{report?.phase ?? 'phase-2'}</span>} />
          <DetailRow
            label="Uptime"
            value={<span className="font-mono text-[11px]">{report ? formatDuration(report.uptimeSeconds) : '—'}</span>}
          />
          <DetailRow
            label="Store"
            value={
              report ? (
                <span className="font-mono text-[11px]">
                  {report.storage.conversations} conversations · {report.storage.messages} messages
                </span>
              ) : (
                '—'
              )
            }
          />
          <DetailRow
            label="Model"
            value={
              report ? (
                <Chip
                  tone={
                    report.provider.state === 'error'
                      ? 'danger'
                      : report.provider.state === 'connected'
                        ? 'ok'
                        : report.provider.state === 'not-configured'
                          ? 'neutral'
                          : 'accent'
                  }
                >
                  {report.provider.state === 'error'
                    ? 'Fault'
                    : report.provider.state === 'connected'
                      ? 'Connected'
                      : report.provider.state === 'configured'
                        ? 'Configured'
                        : 'Not connected'}
                </Chip>
              ) : (
                '—'
              )
            }
          />
          <DetailRow
            label="Data folder"
            value={
              <span className="break-all font-mono text-[10.5px] text-ink-2">
                {report?.storage.dataDirectory ?? '—'}
              </span>
            }
          />
        </dl>
      </div>

      {status === 'offline' && error ? (
        <div className="mx-4 mb-3 rounded-[8px] border border-[color-mix(in_oklab,var(--c-danger)_24%,transparent)] px-3 py-2 text-[11.5px] leading-[1.55] text-ink-2">
          {error.message} {error.hint}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
        <Button variant="ghost" size="sm" onClick={() => void copyDiagnostics()}>
          Copy diagnostics
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon="refresh"
          disabled={isRefreshing}
          onClick={() => {
            refresh();
            push('Checking the local node');
          }}
        >
          Check again
        </Button>
      </div>
    </Modal>
  );
}

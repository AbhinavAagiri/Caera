import { useEffect, useState } from 'react';
import type {
  ComputerOperationId,
  ComputerOperationPolicy,
  ComputerSettings,
  ComputerSnapshot,
} from '@shared';
import { Button } from '@/components/ui/Button';
import { Switch, TextField } from '@/components/ui/Controls';
import { Chip } from '@/components/ui/Indicators';
import { Note, Panel, PanelHeader } from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/format';
import { api, isAbortError, toApiError } from '@/services/api';

const RISK_TONE = { low: 'neutral', medium: 'warn', high: 'danger' } as const;

export function ComputerAccessPanel({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const { push } = useToast();
  const [snapshot, setSnapshot] = useState<ComputerSnapshot | null>(null);
  const [settings, setSettings] = useState<ComputerSettings | null>(null);
  const [applicationPath, setApplicationPath] = useState('');
  const [directoryPath, setDirectoryPath] = useState('');
  const [directoryWrite, setDirectoryWrite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .computer(controller.signal)
      .then((next) => {
        setSnapshot(next);
        setSettings(next.settings);
      })
      .catch((cause) => {
        // React development mode unmounts and remounts effects. An aborted
        // initial read is expected, not a permissions failure to show the user.
        if (isAbortError(cause)) return;
        setError(toApiError(cause).message);
      });
    return () => controller.abort();
  }, []);

  const updateOperation = (id: ComputerOperationId, patch: Partial<ComputerOperationPolicy>) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            operations: {
              ...current.operations,
              [id]: { ...current.operations[id], ...patch },
            },
          }
        : current,
    );
  };

  const save = async (): Promise<void> => {
    if (!settings || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api.updateComputerSettings({
        enabled: settings.enabled,
        operations: settings.operations,
        applications: settings.applications.map(({ path, label }) => ({ path, label })),
        directories: settings.directories.map(({ path, canRead, canCreate }) => ({
          path,
          canRead,
          canCreate,
        })),
      });
      setSnapshot(next);
      setSettings(next.settings);
      push('Computer permissions saved', {
        detail: 'The agent will recheck these values before every local action.',
        tone: 'success',
      });
    } catch (cause) {
      const apiError = toApiError(cause);
      setError(apiError.hint ? `${apiError.message} ${apiError.hint}` : apiError.message);
    } finally {
      setSaving(false);
    }
  };

  if (!settings || !snapshot) {
    return (
      <Panel>
        <div className="px-4 py-5 text-[11.5px] text-ink-3">
          {error ?? 'Loading local computer permissions…'}
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Local computer access"
          description="A closed operation list. There is no shell, arbitrary command, script execution or general filesystem API."
          action={
            <Switch
              checked={settings.enabled}
              onChange={(enabled) => setSettings({ ...settings, enabled })}
              label="Enable local computer access"
            />
          }
        />
        <div className="divide-y divide-line">
          {snapshot.operations.map((operation) => {
            const policy = settings.operations[operation.id];
            return (
              <div key={operation.id} className={compact ? 'px-4 py-2.5' : 'px-4 py-3.5'}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-[54ch]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] text-ink">{operation.label}</span>
                      <Chip tone={RISK_TONE[operation.risk]}>{operation.risk}</Chip>
                    </div>
                    <p className="mt-1 text-[11px] leading-[1.55] text-ink-3">{operation.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <label className="flex items-center gap-1.5 text-[10.5px] text-ink-3">
                      Confirm
                      <Switch
                        checked={operation.confirmationRequired || policy.requiresConfirmation}
                        disabled={operation.confirmationRequired}
                        onChange={(requiresConfirmation) =>
                          updateOperation(operation.id, { requiresConfirmation })
                        }
                        label={`Require confirmation for ${operation.label}`}
                      />
                    </label>
                    <Switch
                      checked={policy.enabled}
                      onChange={(enabled) => updateOperation(operation.id, { enabled })}
                      label={`Enable ${operation.label}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Approved applications"
            description="Only existing absolute .exe paths. Opening never passes arguments and never runs scripts."
            action={<Chip tone="neutral">{settings.applications.length}</Chip>}
          />
          <div className="space-y-2 px-4 py-3">
            {settings.applications.map((application) => (
              <div key={application.id} className="flex items-center justify-between gap-2 rounded-[4px] border border-line bg-base px-2.5 py-2">
                <div className="min-w-0">
                  <p className="text-[11.5px] text-ink">{application.label}</p>
                  <p className="truncate font-mono text-[9px] text-ink-4" title={application.path}>
                    {application.path}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      applications: settings.applications.filter((entry) => entry.id !== application.id),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <TextField
              label="Executable path"
              value={applicationPath}
              onChange={setApplicationPath}
              placeholder="C:\\Program Files\\App\\app.exe"
              hint="Use an absolute path to an existing .exe."
            />
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              disabled={!applicationPath.trim()}
              onClick={() => {
                const value = applicationPath.trim();
                if (!value) return;
                setSettings({
                  ...settings,
                  applications: [
                    ...settings.applications,
                    { id: `pending_${value}`, label: value.replaceAll('\\', '/').split('/').pop() ?? value, path: value },
                  ],
                });
                setApplicationPath('');
              }}
            >
              Add application
            </Button>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Approved directories"
            description="Every read, create, open and reveal is resolved inside one of these roots. Drive roots are rejected."
            action={<Chip tone="neutral">{settings.directories.length}</Chip>}
          />
          <div className="space-y-2 px-4 py-3">
            {settings.directories.map((directory) => (
              <div key={directory.id} className="rounded-[4px] border border-line bg-base px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-all font-mono text-[9.5px] text-ink-2">{directory.path}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    onClick={() =>
                      setSettings({
                        ...settings,
                        directories: settings.directories.filter((entry) => entry.id !== directory.id),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[10.5px] text-ink-3">
                  <label className="flex items-center gap-1.5">
                    <Switch
                      checked={directory.canRead}
                      onChange={(canRead) =>
                        setSettings({
                          ...settings,
                          directories: settings.directories.map((entry) =>
                            entry.id === directory.id ? { ...entry, canRead } : entry,
                          ),
                        })
                      }
                      label="Allow reads"
                    />
                    Read
                  </label>
                  <label className="flex items-center gap-1.5">
                    <Switch
                      checked={directory.canCreate}
                      onChange={(canCreate) =>
                        setSettings({
                          ...settings,
                          directories: settings.directories.map((entry) =>
                            entry.id === directory.id ? { ...entry, canCreate } : entry,
                          ),
                        })
                      }
                      label="Allow file creation"
                    />
                    Create new files
                  </label>
                </div>
              </div>
            ))}
            <TextField
              label="Folder path"
              value={directoryPath}
              onChange={setDirectoryPath}
              placeholder="D:\\CAERA\\workspace"
              hint="Use an existing folder, not a drive root."
            />
            <label className="flex items-center gap-2 text-[11px] text-ink-3">
              <Switch checked={directoryWrite} onChange={setDirectoryWrite} label="Allow file creation" />
              Allow creating new files in this folder
            </label>
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              disabled={!directoryPath.trim()}
              onClick={() => {
                const value = directoryPath.trim();
                if (!value) return;
                setSettings({
                  ...settings,
                  directories: [
                    ...settings.directories,
                    {
                      id: `pending_${value}`,
                      path: value,
                      canRead: true,
                      canCreate: directoryWrite,
                    },
                  ],
                });
                setDirectoryPath('');
                setDirectoryWrite(false);
              }}
            >
              Add directory
            </Button>
          </div>
        </Panel>
      </div>

      {error ? <Note tone="danger">{error}</Note> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[58ch] text-[10.5px] leading-[1.6] text-ink-3">
          Saving validates every path on this PC. Removed folders and applications stop working immediately.
          Consequential operations always keep confirmation enabled.
        </p>
        <Button size="sm" variant="primary" icon="check" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save permissions'}
        </Button>
      </div>

      <Panel>
        <PanelHeader title="Recent local actions" description="Real completed or failed operations recorded by the local node." />
        {snapshot.history.length === 0 ? (
          <p className="px-4 py-3 text-[11.5px] text-ink-3">No local computer actions have run yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {snapshot.history.slice(0, compact ? 5 : 20).map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[11.5px] text-ink-2">{entry.summary}</p>
                  <p className="mt-0.5 font-mono text-[8.5px] text-ink-4">
                    {entry.operation} · {formatRelative(entry.startedAt)}
                  </p>
                </div>
                <Chip tone={entry.status === 'completed' ? 'ok' : 'danger'}>{entry.status}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

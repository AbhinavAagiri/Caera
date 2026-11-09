import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  ConnectorCapability,
  ConnectorGrantSet,
  ConnectorIntegration,
  ConnectorPermissionKind,
  ConnectorToolDefinition,
  ConnectorViewStatus,
} from '@shared';
import { DirectoryPicker } from '@/components/connections/DirectoryPicker';
import { Icon, type IconName } from '@/components/icons/Icon';
import { ModulePage } from '@/components/layout/ModulePage';
import { Button, IconButton } from '@/components/ui/Button';
import { SelectField, Switch, TextAreaField, TextField } from '@/components/ui/Controls';
import { Chip } from '@/components/ui/Indicators';
import { Modal } from '@/components/ui/Overlay';
import {
  Note,
  Panel,
  PanelHeader,
  RowGroup,
  SectionHeading,
  SettingRow,
} from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { useLocalNode } from '@/contexts/LocalNodeContext';
import { useConnectors } from '@/hooks/useConnectors';
import { formatRelative, pluralize } from '@/lib/format';
import { toApiError } from '@/services/api';

const CONNECTOR_ICON: Record<string, IconName> = {
  obsidian: 'folder',
  notion: 'globe',
  logseq: 'network',
  anytype: 'node',
};

const CAPABILITY_LABEL: Record<ConnectorCapability, string> = {
  search: 'Search',
  read: 'Read',
  create: 'Create',
  append: 'Append',
  update: 'Update',
  delete: 'Delete',
  open: 'Open',
};

const PERMISSION_ORDER: readonly ConnectorPermissionKind[] = [
  'read',
  'create',
  'edit',
  'delete',
];

const PERMISSION_COPY: Record<
  ConnectorPermissionKind,
  { label: string; description: string }
> = {
  read: { label: 'Read', description: 'Search and read content.' },
  create: { label: 'Create', description: 'Add pages or objects without overwriting.' },
  edit: { label: 'Edit', description: 'Append to or update supported content.' },
  delete: { label: 'Delete', description: 'Remove content; always confirmed.' },
};

const WORKSPACE_CONNECTORS = new Set(['obsidian', 'notion', 'logseq', 'anytype']);
const LIVE_TEST_PENDING = new Set(['notion', 'logseq', 'anytype']);

const STATUS_META: Record<
  ConnectorViewStatus,
  { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' }
> = {
  connected: { label: 'Connected', tone: 'ok' },
  error: { label: 'Connection error', tone: 'danger' },
  disconnected: { label: 'Disconnected', tone: 'neutral' },
  'not-connected': { label: 'Not connected', tone: 'neutral' },
  planned: { label: 'Planned', tone: 'neutral' },
};

function hasWriteGrant(grants: ConnectorGrantSet): boolean {
  return grants.create || grants.edit || grants.delete;
}

function relative(iso: string | null, fallback: string): string {
  return iso ? formatRelative(iso) : fallback;
}

function StatusChip({ status }: { status: ConnectorViewStatus }): React.JSX.Element {
  const meta = STATUS_META[status];
  return <Chip tone={meta.tone}>{meta.label}</Chip>;
}

function CapabilityChips({
  capabilities,
}: {
  capabilities: ConnectorCapability[];
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {capabilities.map((capability) => (
        <Chip key={capability} tone="accent">
          {CAPABILITY_LABEL[capability]}
        </Chip>
      ))}
    </div>
  );
}

function ToolRow({ tool }: { tool: ConnectorToolDefinition }): React.JSX.Element {
  const argumentsLabel = Object.keys(tool.inputSchema.properties).join(' · ');
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2 px-4 py-3">
      <div className="min-w-0 max-w-[68ch]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10.5px] text-ink-2">{tool.id}</span>
          <Chip tone={tool.permission === 'read' ? 'neutral' : 'warn'}>{tool.permission}</Chip>
          {tool.destructive ? <Chip tone="danger">confirm</Chip> : null}
        </div>
        <p className="mt-1.5 text-[11.5px] leading-[1.55] text-ink-3">{tool.description}</p>
        <p className="mt-1 font-mono text-[9px] text-ink-4">
          {argumentsLabel || 'no arguments'}
        </p>
      </div>
      <span className="shrink-0 font-mono text-[8.5px] uppercase tracking-[0.05em] text-ink-4">
        {tool.operation}
      </span>
    </div>
  );
}

function ConnectorCard({
  integration,
  toolCount,
  busy,
  onConfigure,
  onCheck,
  onDisconnect,
  onTogglePermission,
  onOpenWorkspace,
}: {
  integration: ConnectorIntegration;
  toolCount: number;
  busy: boolean;
  onConfigure: (integration: ConnectorIntegration) => void;
  onCheck: (integration: ConnectorIntegration) => void;
  onDisconnect: (integration: ConnectorIntegration) => void;
  onTogglePermission: (
    integration: ConnectorIntegration,
    scope: ConnectorPermissionKind,
    next: boolean,
  ) => void;
  onOpenWorkspace: (integration: ConnectorIntegration) => void;
}): React.JSX.Element {
  const writes = hasWriteGrant(integration.grants);
  const configuration = Object.entries(integration.connection.configuration);
  const canCheck =
    integration.connection.status === 'connected' || integration.connection.status === 'error';

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-3.5">
        <div className="flex min-w-0 gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-[5px] border border-line bg-raised text-ink-3">
            <Icon name={CONNECTOR_ICON[integration.id] ?? 'network'} size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-medium text-ink">{integration.name}</h3>
              <StatusChip status={integration.connection.status} />
            </div>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.05em] text-ink-4">
              {integration.vendor} / {integration.auth.label}
            </p>
            <p className="mt-1.5 max-w-[70ch] text-[11.5px] leading-[1.6] text-ink-3">
              {integration.description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {integration.connection.status === 'connected' &&
          WORKSPACE_CONNECTORS.has(integration.id) ? (
            <Button
              size="sm"
              variant="primary"
              icon={CONNECTOR_ICON[integration.id] ?? 'network'}
              disabled={busy}
              onClick={() => onOpenWorkspace(integration)}
            >
              {integration.id === 'obsidian' ? 'Open vault' : 'Open workspace'}
            </Button>
          ) : null}
          {canCheck ? (
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              disabled={busy}
              onClick={() => onCheck(integration)}
            >
              Check
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            icon="edit"
            disabled={busy}
            onClick={() => onConfigure(integration)}
          >
            Configure
          </Button>
          <IconButton
            icon="trash"
            label={`Disconnect ${integration.name}`}
            size="sm"
            disabled={busy}
            onClick={() => onDisconnect(integration)}
          />
        </div>
      </div>

      {integration.connection.lastError ? (
        <div className="border-b border-line px-4 py-2.5">
          <Note tone="danger" icon={<Icon name="warning" size={13} />}>
            {integration.connection.lastError}
          </Note>
        </div>
      ) : null}

      <div className="grid gap-3 border-b border-line px-4 py-3 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-4">
            Configuration
          </p>
          {configuration.length === 0 ? (
            <p className="mt-1 text-[11px] text-ink-3">No configuration required.</p>
          ) : (
            configuration.map(([key, value]) => (
              <div key={key} className="mt-1">
                <p className="text-[10px] text-ink-4">
                  {integration.auth.fields.find((field) => field.key === key)?.label ?? key}
                </p>
                <p className="break-all font-mono text-[10.5px] leading-[1.5] text-ink-2">
                  {value}
                </p>
              </div>
            ))
          )}
          <p className="mt-1 text-[10px] text-ink-4">
            {integration.connection.hasCredentials
              ? 'Credentials are stored server-side only.'
              : 'No secret credential is exposed to the browser.'}
          </p>
        </div>
        <div>
          <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-4">
            Capabilities
          </p>
          <div className="mt-1.5">
            <CapabilityChips capabilities={integration.capabilities} />
          </div>
        </div>
      </div>

      <div className="px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[12px] text-ink">Permissions</p>
            <p className="mt-0.5 text-[10.5px] leading-[1.5] text-ink-4">
              Independent for {integration.name}; read-only until you grant more.
            </p>
          </div>
          <Chip tone={writes ? 'warn' : 'ok'}>{writes ? 'write access on' : 'read-only'}</Chip>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {PERMISSION_ORDER.map((scope) => (
            <div
              key={scope}
              className="flex items-start justify-between gap-3 rounded-[4px] border border-line bg-base/40 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-[11.5px] text-ink">{PERMISSION_COPY[scope].label}</p>
                <p className="mt-0.5 text-[10.5px] leading-[1.5] text-ink-4">
                  {PERMISSION_COPY[scope].description}
                </p>
              </div>
              <Switch
                label={`${integration.name} ${PERMISSION_COPY[scope].label.toLowerCase()} permission`}
                checked={integration.grants[scope]}
                disabled={busy}
                onChange={(next) => onTogglePermission(integration, scope, next)}
              />
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[10.5px] leading-[1.55] text-ink-4">
          {writes
            ? 'Write grants are active. Destructive operations still require a separate confirmation each time.'
            : 'Only reading is permitted. Enabling create, edit or delete requires a deliberate confirmation.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 font-mono text-[8.5px] uppercase tracking-[0.04em] text-ink-4">
        <span>{pluralize(toolCount, 'tool')} registered</span>
        <span>checked {relative(integration.connection.lastCheckedAt, 'never')}</span>
        <span>used {relative(integration.connection.lastUsedAt, 'never')}</span>
        {integration.connection.connectedAt ? (
          <span>since {relative(integration.connection.connectedAt, 'unknown')}</span>
        ) : null}
      </div>
    </Panel>
  );
}

function AvailableCard({
  integration,
  enabled,
  onConnect,
}: {
  integration: ConnectorIntegration;
  enabled: boolean;
  onConnect: (integration: ConnectorIntegration) => void;
}): React.JSX.Element {
  const planned = integration.availability === 'planned';
  return (
    <Panel className={planned ? 'bg-base/40' : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-3.5">
        <div className="flex min-w-0 gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-[5px] border border-line bg-raised text-ink-3">
            <Icon name={CONNECTOR_ICON[integration.id] ?? 'network'} size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-medium text-ink">{integration.name}</h3>
              <Chip tone={planned ? 'neutral' : 'accent'}>
                {planned ? 'Planned' : 'Available'}
              </Chip>
              {LIVE_TEST_PENDING.has(integration.id) ? (
                <Chip tone="warn">Live test pending</Chip>
              ) : null}
            </div>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.05em] text-ink-4">
              {integration.vendor} / {integration.auth.label}
            </p>
            <p className="mt-1.5 max-w-[70ch] text-[11.5px] leading-[1.6] text-ink-3">
              {integration.description}
            </p>
            {integration.capabilities.length > 0 ? (
              <div className="mt-2">
                <CapabilityChips capabilities={integration.capabilities} />
              </div>
            ) : (
              <p className="mt-2 max-w-[70ch] text-[10.5px] leading-[1.55] text-ink-4">
                {integration.availabilityDetail}
              </p>
            )}
            {LIVE_TEST_PENDING.has(integration.id) ? (
              <p className="mt-2 max-w-[70ch] text-[10.5px] leading-[1.55] text-ink-4">
                {integration.availabilityDetail}
              </p>
            ) : null}
          </div>
        </div>
        {planned ? (
          <span className="shrink-0 rounded-[4px] border border-line bg-raised px-2 py-1.5 font-mono text-[8.5px] uppercase tracking-[0.04em] text-ink-4">
            Adapter planned
          </span>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            disabled={!enabled}
            onClick={() => onConnect(integration)}
          >
            Connect
          </Button>
        )}
      </div>
    </Panel>
  );
}

export function ConnectionsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const node = useLocalNode();
  const { push } = useToast();
  const connectors = useConnectors();

  const [connectTarget, setConnectTarget] = useState<ConnectorIntegration | null>(null);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingWrite, setPendingWrite] = useState<{
    integration: ConnectorIntegration;
    grants: ConnectorGrantSet;
  } | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectorIntegration | null>(null);

  const snapshot = connectors.snapshot;
  const all = snapshot?.connectors ?? [];
  const configured = all.filter(
    (connector) =>
      connector.connection.status === 'connected' || connector.connection.status === 'error',
  );
  const available = all.filter(
    (connector) =>
      connector.connection.status !== 'connected' && connector.connection.status !== 'error',
  );
  const tools = snapshot?.tools ?? [];

  const openConnect = (integration: ConnectorIntegration): void => {
    setConnectTarget(integration);
    setConfigDraft(
      Object.fromEntries(
        integration.auth.fields.map((field) => [
          field.key,
          integration.connection.configuration[field.key] ??
            field.defaultValue ??
            (field.type === 'boolean' ? 'false' : ''),
        ]),
      ),
    );
    setPickerOpen(false);
    setFormError(null);
  };

  const closeConnect = (): void => {
    if (connecting) return;
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    setConnectTarget(null);
    setFormError(null);
  };

  const submitConnect = async (): Promise<void> => {
    if (!connectTarget || connecting) return;
    const missing = connectTarget.auth.fields.find(
      (field) =>
        field.required &&
        field.type !== 'boolean' &&
        !(configDraft[field.key] ?? '').trim(),
    );
    if (missing) {
      setFormError(`${missing.label} is required.`);
      return;
    }

    setConnecting(true);
    setFormError(null);
    try {
      await connectors.connect(connectTarget.id, configDraft);
      node.refresh();
      push(`${connectTarget.name} connected`, {
        detail: 'Read-only permissions are in place. Grant writes deliberately.',
        tone: 'success',
      });
      setConnectTarget(null);
    } catch (cause) {
      const error = toApiError(cause);
      setFormError(error.hint ? `${error.message} ${error.hint}` : error.message);
    } finally {
      setConnecting(false);
    }
  };

  const checkConnection = async (integration: ConnectorIntegration): Promise<void> => {
    if (busyId) return;
    setBusyId(integration.id);
    try {
      const result = await connectors.test(integration.id);
      connectors.refresh();
      node.refresh();
      push(result.status === 'connected' ? 'Connection check passed' : 'Connection check failed', {
        detail: result.detail,
        tone: result.status === 'connected' ? 'success' : 'error',
      });
    } catch (cause) {
      push('Could not check the connection', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const applyPermissions = async (
    integration: ConnectorIntegration,
    grants: ConnectorGrantSet,
    confirmWriteAccess = false,
  ): Promise<void> => {
    if (busyId) return;
    setBusyId(integration.id);
    try {
      await connectors.updatePermissions(integration.id, {
        ...grants,
        ...(confirmWriteAccess ? { confirmWriteAccess: true } : {}),
      });
      node.refresh();
      push('Permissions updated', {
        detail: `${integration.name} grants are stored on this device.`,
        tone: 'success',
      });
    } catch (cause) {
      push('Could not update permissions', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const togglePermission = (
    integration: ConnectorIntegration,
    scope: ConnectorPermissionKind,
    next: boolean,
  ): void => {
    const grants = { ...integration.grants, [scope]: next };
    if (scope !== 'read' && next && !integration.grants[scope]) {
      setPendingWrite({ integration, grants });
      return;
    }
    void applyPermissions(integration, grants);
  };

  const confirmWrite = async (): Promise<void> => {
    if (!pendingWrite) return;
    const target = pendingWrite;
    setPendingWrite(null);
    await applyPermissions(target.integration, target.grants, true);
  };

  const disconnect = async (): Promise<void> => {
    if (!disconnectTarget || busyId) return;
    const target = disconnectTarget;
    setBusyId(target.id);
    try {
      await connectors.disconnect(target.id);
      node.refresh();
      push(`${target.name} disconnected`, {
        detail:
          'The local connection and its permission grants were removed. Application data was not changed.',
        tone: 'success',
      });
      setDisconnectTarget(null);
    } catch (cause) {
      push('Could not disconnect', {
        detail: toApiError(cause).message,
        tone: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRefresh = (): void => {
    connectors.refresh();
    node.refresh();
  };

  const statusChip = !snapshot ? (
    <Chip tone="neutral">Loading</Chip>
  ) : !snapshot.enabled ? (
    <Chip tone="warn">Disabled</Chip>
  ) : snapshot.connected > 0 ? (
    <Chip tone="ok">{pluralize(snapshot.connected, 'connection')}</Chip>
  ) : configured.length > 0 ? (
    <Chip tone="warn">Needs attention</Chip>
  ) : (
    <Chip tone="neutral">No connections</Chip>
  );

  const writeScopes =
    pendingWrite === null
      ? []
      : (['create', 'edit', 'delete'] as const).filter((scope) => pendingWrite.grants[scope]);

  return (
    <ModulePage
      kicker={
        <>
          Integrations <span className="slash">/</span>{' '}
          <span className="accent">Connections</span>
        </>
      }
      title="Connections"
      description="Connect external second-brain applications through validated, local adapters. Permission grants are independent per app, read-only by default, and never broader than the app's real capabilities."
      actions={
        <div className="flex items-center gap-2">
          {statusChip}
          <IconButton
            icon="refresh"
            label="Refresh connections"
            size="sm"
            onClick={handleRefresh}
          />
        </div>
      }
    >
      {connectors.loading && !snapshot ? (
        <Panel>
          <div className="space-y-3 px-4 py-5" aria-hidden="true">
            <div className="h-3 w-[32%] animate-pulse rounded bg-raised" />
            <div className="h-3 w-[76%] animate-pulse rounded bg-raised" />
            <div className="h-3 w-[58%] animate-pulse rounded bg-raised" />
            <div className="mt-4 h-[120px] animate-pulse rounded-[5px] border border-line bg-raised/50" />
          </div>
        </Panel>
      ) : connectors.error && !snapshot ? (
        <Panel>
          <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-12 text-center">
            <span className="mb-3 text-danger">
              <Icon name="warning" size={20} />
            </span>
            <p className="font-serif text-[22px] leading-tight text-ink">Connections unavailable</p>
            <p className="mt-1.5 max-w-[42ch] text-[11.5px] leading-[1.6] text-ink-3">
              {connectors.error.message}
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              className="mt-4"
              onClick={handleRefresh}
            >
              Retry
            </Button>
          </div>
        </Panel>
      ) : snapshot ? (
        <>
          {!snapshot.enabled ? (
            <div className="mb-4">
              <Note tone="warn" icon={<Icon name="warning" size={13} />}>
                Connections are disabled by{' '}
                <span className="font-mono text-[11px]">CAERA_CONNECTORS_ENABLED=false</span>. Set it
                to <span className="font-mono text-[11px]">true</span> in{' '}
                <span className="font-mono text-[11px]">server/.env</span> and restart the node to
                manage connections. Existing grants remain stored.
              </Note>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_302px]">
            <div className="min-w-0 space-y-7">
              <section>
                <SectionHeading
                  title="Connected applications"
                  description="Each connection owns its configuration, status and permission grants. Disconnecting removes the local link and grants, never the application's data."
                  aside={<Chip tone="neutral">{pluralize(configured.length, 'configured')}</Chip>}
                />
                {configured.length === 0 ? (
                  <Panel>
                    <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
                      <div className="relative mb-4 grid size-[68px] place-items-center rounded-full border border-line">
                        <span
                          className="absolute inset-[7px] rounded-full border border-dashed border-line"
                          aria-hidden="true"
                        />
                        <Icon name="network" size={21} className="text-ink-3" />
                      </div>
                      <p className="font-serif text-[23px] leading-tight text-ink">
                        No applications connected
                      </p>
                      <p className="mx-auto mt-1.5 max-w-[44ch] text-[11.5px] leading-[1.7] text-ink-3">
                        Choose an available integration below. Obsidian stays local; Notion uses
                        the official API with a token kept on this node; Logseq and Anytype use
                        loopback-only local APIs.
                      </p>
                    </div>
                  </Panel>
                ) : (
                  <div className="space-y-3">
                    {configured.map((integration) => (
                      <ConnectorCard
                        key={integration.id}
                        integration={integration}
                        toolCount={tools.filter((tool) => tool.connectorId === integration.id).length}
                        busy={busyId !== null}
                        onConfigure={openConnect}
                        onCheck={(connector) => void checkConnection(connector)}
                        onDisconnect={setDisconnectTarget}
                        onTogglePermission={togglePermission}
                        onOpenWorkspace={(connector) =>
                          navigate(`/connections/${connector.id}`)
                        }
                      />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <SectionHeading
                  title="Available integrations"
                  description="Adapters expose only operations they actually implement. Planned applications contribute no permissions, tools or fake capability."
                  aside={
                    <Chip tone="neutral">
                      {pluralize(available.filter((connector) => connector.availability === 'available').length, 'available')}
                    </Chip>
                  }
                />
                <div className="space-y-3">
                  {available.map((integration) => (
                    <AvailableCard
                      key={integration.id}
                      integration={integration}
                      enabled={snapshot.enabled}
                      onConnect={openConnect}
                    />
                  ))}
                </div>
              </section>

              <section>
                <SectionHeading
                  title="Agent tool surface"
                  description="Executable definitions registered by connected adapters. The executor checks the connector, permission and every argument before calling an operation."
                  aside={
                    <Chip tone={tools.length > 0 ? 'ok' : 'neutral'}>
                      {pluralize(tools.length, 'tool')} registered
                    </Chip>
                  }
                />
                <Panel>
                  {tools.length === 0 ? (
                    <div className="flex min-h-[150px] flex-col items-center justify-center px-6 py-8 text-center">
                      <Icon name="tools" size={18} className="text-ink-3" />
                      <p className="mt-2 text-[12px] text-ink-2">No tools exposed yet</p>
                      <p className="mt-1 max-w-[44ch] text-[11px] leading-[1.6] text-ink-3">
                        Connect an application to register its validated tools here. Planned
                        integrations stay empty until a real adapter exists.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-line">
                      {tools.map((tool) => (
                        <ToolRow key={tool.id} tool={tool} />
                      ))}
                    </div>
                  )}
                </Panel>
                <div className="mt-3">
                  <Note tone="accent" icon={<Icon name="shield" size={13} />}>
                    The agent can select these registered operations only after the live grant is
                    checked. Writes and deletes pause for exact-action approval; no model can call an
                    arbitrary connector method or bypass the permissions shown above.
                  </Note>
                </div>
              </section>
            </div>

            <aside className="space-y-4">
              <Panel>
                <PanelHeader title="Access model" />
                <RowGroup>
                  <SettingRow label="Default access" description="Every new connection.">
                    <span className="font-mono text-[10.5px] text-ink-3">read-only</span>
                  </SettingRow>
                  <SettingRow label="Write access" description="Create, edit and delete.">
                    <span className="font-mono text-[10.5px] text-ink-3">explicit</span>
                  </SettingRow>
                  <SettingRow label="Destructive calls" description="Delete or replace content.">
                    <span className="font-mono text-[10.5px] text-ink-3">confirm each</span>
                  </SettingRow>
                  <SettingRow label="Grant scope" description="Independent for each app.">
                    <span className="font-mono text-[10.5px] text-ink-3">per connector</span>
                  </SettingRow>
                </RowGroup>
              </Panel>

              <Panel>
                <PanelHeader
                  title="Local boundary"
                  description="The browser never receives a secret token or direct filesystem access."
                />
                <div className="space-y-2.5 px-4 py-3 text-[11px] leading-[1.65] text-ink-3">
                  <p>
                    <span className="text-ink">Configuration</span> is stored in local SQLite;
                    credential fields are kept server-side and omitted from every response.
                  </p>
                  <p>
                    <span className="text-ink">Application data</span> stays with each app.
                    Obsidian files remain inside the chosen vault; Logseq and Anytype must resolve
                    to loopback addresses; Notion requests use the official API and only resources
                    shared with the integration.
                  </p>
                  <p>
                    <span className="text-ink">Execution records</span> keep operation metadata,
                    counts and status. Note content and document paths are not written to the
                    activity log.
                  </p>
                </div>
              </Panel>

              <Note icon={<Icon name="network" size={13} />}>
                Notion, Logseq and Anytype now use real adapters with independent tools. Each was
                built against its documented API; live verification still requires a real workspace,
                graph or running desktop app. Nothing is marked verified until that test succeeds.
              </Note>

              <Button
                size="sm"
                variant="ghost"
                icon="tools"
                onClick={() => navigate('/tools')}
              >
                Computer tool permissions
              </Button>
            </aside>
          </div>
        </>
      ) : null}

      <Modal
        open={Boolean(connectTarget)}
        onClose={closeConnect}
        label={connectTarget ? `Configure ${connectTarget.name}` : 'Configure connector'}
        width={480}
      >
        {connectTarget ? (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5">
              <div>
                <h2 className="text-[14px] font-medium text-ink">
                  {connectTarget.connection.status === 'not-connected'
                    ? `Connect ${connectTarget.name}`
                    : `Configure ${connectTarget.name}`}
                </h2>
                <p className="mt-1 text-[11.5px] leading-[1.6] text-ink-3">
                  {connectTarget.auth.description}
                </p>
              </div>
              <IconButton
                icon="close"
                label="Close connection form"
                size="sm"
                disabled={connecting}
                onClick={closeConnect}
              />
            </div>

            <div className="space-y-4 px-4 py-4">
              {connectTarget.auth.fields.map((field) => {
                const value = configDraft[field.key] ?? field.defaultValue ?? '';
                const setValue = (next: string): void =>
                  setConfigDraft((current) => ({ ...current, [field.key]: next }));

                if (field.type === 'boolean') {
                  return (
                    <div
                      key={field.key}
                      className="flex items-start justify-between gap-4 rounded-[5px] border border-line bg-base/40 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-[12px] text-ink">{field.label}</p>
                        {field.help ? (
                          <p className="mt-0.5 text-[10.5px] leading-[1.55] text-ink-4">
                            {field.help}
                          </p>
                        ) : null}
                      </div>
                      <Switch
                        label={`${connectTarget.name} ${field.label}`}
                        checked={value === 'true'}
                        disabled={connecting}
                        onChange={(next) => setValue(next ? 'true' : 'false')}
                      />
                    </div>
                  );
                }

                if (field.type === 'select') {
                  return (
                    <SelectField
                      key={field.key}
                      label={field.label}
                      value={value || field.defaultValue || field.options?.[0]?.value || ''}
                      options={field.options ?? []}
                      disabled={connecting}
                      onChange={setValue}
                    />
                  );
                }

                if (field.type === 'text' && field.multiline) {
                  return (
                    <TextAreaField
                      key={field.key}
                      label={field.label}
                      value={value}
                      onChange={setValue}
                      placeholder={field.placeholder}
                      hint={field.help}
                      rows={3}
                      disabled={connecting}
                      maxLength={1000}
                    />
                  );
                }

                return (
                  <div key={field.key}>                        <TextField
                      label={field.label}
                      value={value}
                      onChange={setValue}
                      placeholder={field.placeholder}
                      hint={field.help}
                      disabled={connecting}
                      autoFocus={field === connectTarget.auth.fields[0]}
                      maxLength={1000}
                      type={field.type === 'secret' ? 'password' : 'text'}
                      autoComplete={field.type === 'secret' ? 'new-password' : 'off'}
                    />
                    {field.type === 'path' ? (
                      <div className="mt-1.5 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="folder"
                          disabled={connecting}
                          onClick={() => setPickerOpen(true)}
                        >
                          Browse folders
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {connectTarget.auth.alternatives?.length ? (
                <div className="rounded-[5px] border border-line bg-base/40 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-4">
                      Alternative transport
                    </p>
                    <Chip tone="neutral">Planned</Chip>
                  </div>
                  {connectTarget.auth.alternatives.map((alternative) => (
                    <div key={alternative.method} className="mt-1.5">
                      <p className="text-[11.5px] text-ink-2">{alternative.label}</p>
                      <p className="mt-0.5 text-[10.5px] leading-[1.55] text-ink-4">
                        {alternative.description}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}              <Note icon={<Icon name="shield" size={13} />}>
                The configuration is validated before it is saved. Credentials are stored
                server-side; local transports must use loopback addresses; Notion access is limited
                to resources shared with the integration.
              </Note>

              {formError ? (
                <p className="rounded-[5px] border border-[color-mix(in_oklab,var(--c-danger)_24%,transparent)] bg-[color-mix(in_oklab,var(--c-danger)_7%,transparent)] px-3 py-2 text-[11.5px] leading-[1.55] text-danger">
                  {formError}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button size="sm" variant="ghost" disabled={connecting} onClick={closeConnect}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={connectTarget.connection.status === 'not-connected' ? 'plus' : 'check'}
                disabled={connecting}
                onClick={() => void submitConnect()}
              >
                {connecting
                  ? 'Checking…'
                  : connectTarget.connection.status === 'not-connected'
                    ? 'Connect'
                    : 'Save connection'}
              </Button>
            </div>
          </>
        ) : null}
      </Modal>

      <DirectoryPicker
        open={pickerOpen && Boolean(connectTarget)}
        connectorId={connectTarget?.id ?? 'obsidian'}
        initialPath={configDraft.vaultPath}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          setConfigDraft((current) => ({ ...current, vaultPath: path }));
          setPickerOpen(false);
        }}
      />

      <Modal
        open={Boolean(pendingWrite)}
        onClose={() => setPendingWrite(null)}
        label="Allow write access"
        width={460}
      >
        <div className="border-b border-line px-4 py-3.5">
          <h2 className="text-[14px] font-medium text-ink">
            Allow write access to {pendingWrite?.integration.name}?
          </h2>
          <p className="mt-1.5 text-[12px] leading-[1.65] text-ink-3">
            This is a standing permission for this connector. You can revoke it at any time.
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="flex flex-wrap gap-1.5">
            {writeScopes.map((scope) => (
              <Chip key={scope} tone="warn">
                {PERMISSION_COPY[scope].label}
              </Chip>
            ))}
          </div>
          <Note tone="warn" icon={<Icon name="warning" size={13} />}>
            Write operations can change application content. Destructive tools still require a
            separate confirmation at execution time, so this grant alone cannot silently delete or
            replace content.
          </Note>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button size="sm" variant="ghost" onClick={() => setPendingWrite(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="check"
            onClick={() => void confirmWrite()}
          >
            Allow write access
          </Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(disconnectTarget)}
        onClose={() => setDisconnectTarget(null)}
        label="Disconnect application"
        width={440}
      >
        <div className="border-b border-line px-4 py-3.5">
          <h2 className="text-[14px] font-medium text-ink">
            Disconnect {disconnectTarget?.name}?
          </h2>
          <p className="mt-1.5 text-[12px] leading-[1.65] text-ink-3">
            The local configuration and every permission grant will be removed. The application and
            its notes are not changed.
          </p>
        </div>
        <div className="px-4 py-3">
          <Note icon={<Icon name="shield" size={13} />}>
            You can reconnect later and grant access again. Existing files remain untouched.
          </Note>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button size="sm" variant="ghost" onClick={() => setDisconnectTarget(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={Boolean(busyId)}
            onClick={() => void disconnect()}
          >
            Disconnect
          </Button>
        </div>
      </Modal>
    </ModulePage>
  );
}

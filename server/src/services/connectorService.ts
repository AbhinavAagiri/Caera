import type {
  ConnectorConnectionView,
  ConnectorDraftInput,
  ConnectorDraftPreview,
  ConnectorGrantSet,
  ConnectorIntegration,
  ConnectorPermissionInput,
  ConnectorSnapshot,
  ConnectorTestResult,
} from '@shared';
import { env } from '../config/env';
import { getConnectorAdapter, listConnectorDescriptors } from '../connectors/registry';
import { loadConnectorGrants } from '../connectors/grants';
import {
  deleteConnectedApplication,
  ensureConnectorPermissions,
  getConnectedApplication,
  getConnectedApplicationSecrets,
  listConnectedApplications,
  setConnectorPermission,
  updateConnectedApplicationStatus,
  upsertConnectedApplication,
} from '../db/repositories/connectors';
import { withTransaction } from '../db/database';
import { HttpError } from '../middleware/errors';
import { publish } from './eventBus';
import { listConnectorTools } from './connectorToolService';
import { logger } from './logger';
import { removeKnowledgeForConnector } from './knowledgeService';
import type { ConnectorRuntime } from '../connectors/types';

function connectionView(
  connector: string,
  status: ConnectorIntegration['connection']['status'],
): ConnectorConnectionView {
  const application =
    status === 'planned' ? null : getConnectedApplication(connector);
  if (!application || status === 'planned') {
    return {
      status,
      configuration: {},
      hasCredentials: false,
      connectedAt: null,
      lastCheckedAt: null,
      lastUsedAt: null,
      lastError: null,
    };
  }

  return {
    status: application.status,
    configuration: application.config,
    hasCredentials: application.hasSecret,
    connectedAt: application.connectedAt,
    lastCheckedAt: application.lastCheckedAt,
    lastUsedAt: application.lastUsedAt,
    lastError: application.lastError,
  };
}

function sanitizeRuntime(
  adapter: NonNullable<ReturnType<typeof getConnectorAdapter>>,
  runtime: ConnectorRuntime,
): ConnectorRuntime {
  const secretKeys = new Set(
    adapter.descriptor.auth.fields
      .filter((field) => field.type === 'secret')
      .map((field) => field.key),
  );
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};

  for (const [key, value] of Object.entries(runtime.secrets)) {
    if (typeof value === 'string') secrets[key] = value;
  }
  for (const [key, value] of Object.entries(runtime.config)) {
    if (typeof value !== 'string') continue;
    if (secretKeys.has(key)) {
      secrets[key] = value;
    } else {
      config[key] = value;
    }
  }

  return { config, secrets };
}

export function connectorSnapshot(): ConnectorSnapshot {
  const connected = new Map(
    listConnectedApplications().map((application) => [application.connector, application]),
  );
  const tools = env.connectors.enabled ? listConnectorTools() : [];
  const connectors: ConnectorIntegration[] = listConnectorDescriptors().map((descriptor) => {
    const application =
      descriptor.availability === 'planned' ? null : connected.get(descriptor.id) ?? null;
    const connection = connectionView(
      descriptor.id,
      descriptor.availability === 'planned'
        ? 'planned'
        : application
          ? application.status
          : 'not-connected',
    );

    return {
      ...descriptor,
      connection,
      grants: loadConnectorGrants(descriptor.id),
    };
  });

  return {
    enabled: env.connectors.enabled,
    connectors,
    tools,
    connected: connectors.filter((connector) => connector.connection.status === 'connected')
      .length,
    available: connectors.filter((connector) => connector.availability === 'available').length,
    updatedAt: new Date().toISOString(),
  };
}

function requireEnabled(): void {
  if (!env.connectors.enabled) {
    throw new HttpError(
      409,
      'CONNECTOR_DISABLED',
      'Connections are disabled on this local node.',
      'Set CAERA_CONNECTORS_ENABLED=true and restart the node to manage connections.',
    );
  }
}

export async function connectConnector(
  connectorId: string,
  configuration: Record<string, unknown>,
): Promise<ConnectorSnapshot> {
  requireEnabled();

  const adapter = getConnectorAdapter(connectorId);
  if (!adapter) {
    const descriptor = listConnectorDescriptors().find(
      (candidate) => candidate.id === connectorId,
    );
    if (descriptor?.availability === 'planned') {
      throw new HttpError(
        409,
        'CONNECTOR_NOT_AVAILABLE',
        `${descriptor.name} is planned but its adapter is not implemented yet.`,
        descriptor.availabilityDetail,
      );
    }
    throw new HttpError(404, 'CONNECTOR_NOT_FOUND', 'That connector is not registered.');
  }

  const runtime = sanitizeRuntime(adapter, adapter.prepareConfig(configuration));
  const health = await adapter.test(runtime);
  if (!health.ok) {
    throw new HttpError(409, 'CONNECTOR_CONFIG_INVALID', health.detail);
  }

  const now = new Date().toISOString();
  upsertConnectedApplication({
    connector: connectorId,
    displayName: adapter.descriptor.name,
    status: 'connected',
    scopes: adapter.descriptor.capabilities,
    config: runtime.config,
    secrets: runtime.secrets,
    connectedAt: now,
    lastCheckedAt: now,
    lastError: null,
  });
  ensureConnectorPermissions(connectorId);

  publish({
    kind: 'connection',
    status: 'completed',
    summary: `${adapter.descriptor.name} connected`,
    detail: `${adapter.descriptor.name} is available through its validated connector tools. Access starts read-only.`,
    meta: {
      connector: connectorId,
      capabilities: adapter.descriptor.capabilities.join(','),
    },
  });

  return connectorSnapshot();
}

export async function testConnector(connectorId: string): Promise<ConnectorTestResult> {
  requireEnabled();

  const application = getConnectedApplication(connectorId);
  if (!application) {
    throw new HttpError(
      409,
      'CONNECTOR_NOT_CONNECTED',
      'Connect this application before testing it.',
    );
  }

  const adapter = getConnectorAdapter(connectorId);
  if (!adapter) {
    throw new HttpError(
      404,
      'CONNECTOR_NOT_FOUND',
      'The adapter for that connector is no longer registered.',
    );
  }

  const runtime = {
    config: application.config,
    secrets: getConnectedApplicationSecrets(connectorId),
  };
  const health = await adapter.test(runtime);
  const checkedAt = new Date().toISOString();
  updateConnectedApplicationStatus(
    connectorId,
    health.ok ? 'connected' : 'error',
    health.ok ? null : health.detail,
    checkedAt,
  );

  publish({
    kind: 'connection',
    status: health.ok ? 'completed' : 'failed',
    summary: `${application.displayName} check ${health.ok ? 'passed' : 'failed'}`,
    detail: health.detail,
    meta: { connector: connectorId },
  });

  return {
    connectorId,
    status: health.ok ? 'connected' : 'error',
    detail: health.detail,
    checkedAt,
    ...(typeof health.metadata?.noteCount === 'number'
      ? { noteCount: health.metadata.noteCount }
      : {}),
  };
}

export async function disconnectConnector(connectorId: string): Promise<ConnectorSnapshot> {
  const application = getConnectedApplication(connectorId);
  if (!application) {
    throw new HttpError(404, 'CONNECTOR_NOT_CONNECTED', 'That application is not connected.');
  }

  const adapter = getConnectorAdapter(connectorId);
  if (adapter?.disconnect) {
    try {
      await adapter.disconnect({
        config: application.config,
        secrets: getConnectedApplicationSecrets(connectorId),
      });
    } catch {
      logger.warn('connector_disconnect_cleanup_failed', { connector: connectorId });
    }
  }

  deleteConnectedApplication(connectorId);
  removeKnowledgeForConnector(connectorId);
  publish({
    kind: 'connection',
    status: 'completed',
    summary: `${application.displayName} disconnected`,
    detail: 'The local connection and its permission grants were removed.',
    meta: { connector: connectorId },
  });

  return connectorSnapshot();
}

export async function previewConnectorDraft(
  connectorId: string,
  input: ConnectorDraftInput,
): Promise<ConnectorDraftPreview> {
  requireEnabled();

  const application = getConnectedApplication(connectorId);
  if (!application || application.status !== 'connected') {
    throw new HttpError(
      409,
      'CONNECTOR_NOT_CONNECTED',
      'Connect this application before previewing a note.',
    );
  }

  const adapter = getConnectorAdapter(connectorId);
  if (!adapter) {
    throw new HttpError(
      404,
      'CONNECTOR_NOT_FOUND',
      'The adapter for that connector is no longer registered.',
    );
  }
  if (!adapter.previewCreate) {
    throw new HttpError(
      409,
      'CONNECTOR_PREVIEW_UNSUPPORTED',
      `${adapter.descriptor.name} does not support note previews.`,
    );
  }

  return adapter.previewCreate(input, {
    config: application.config,
    secrets: getConnectedApplicationSecrets(connectorId),
  });
}

export async function setConnectorPermissions(
  connectorId: string,
  input: ConnectorPermissionInput,
): Promise<ConnectorSnapshot> {
  requireEnabled();

  const application = getConnectedApplication(connectorId);
  if (!application || application.status !== 'connected') {
    throw new HttpError(
      409,
      'CONNECTOR_NOT_CONNECTED',
      'Connect this application before changing its permissions.',
    );
  }

  const adapter = getConnectorAdapter(connectorId);
  if (!adapter) {
    throw new HttpError(
      404,
      'CONNECTOR_NOT_FOUND',
      'The adapter for that connector is no longer registered.',
    );
  }

  for (const scope of ['read', 'create', 'edit', 'delete'] as const) {
    if (input[scope] && !adapter.descriptor.permissions.includes(scope)) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        `${adapter.descriptor.name} does not expose ${scope} permission.`,
      );
    }
  }

  const grants: ConnectorGrantSet = {
    read: input.read,
    create: input.create,
    edit: input.edit,
    delete: input.delete,
  };

  const previous = loadConnectorGrants(connectorId);
  const enablesNewWrite = (['create', 'edit', 'delete'] as const).some(
    (scope) => grants[scope] && !previous[scope],
  );

  if (enablesNewWrite && input.confirmWriteAccess !== true) {
    throw new HttpError(
      400,
      'CONNECTOR_WRITE_CONFIRMATION_REQUIRED',
      'Write access needs explicit confirmation.',
      'Confirm that this application may create, edit or delete data.',
    );
  }

  const updatedAt = new Date().toISOString();
  withTransaction(() => {
    for (const scope of ['read', 'create', 'edit', 'delete'] as const) {
      setConnectorPermission(connectorId, scope, grants[scope] ? 'allow' : 'block');
    }
  });

  if (!grants.read) removeKnowledgeForConnector(connectorId);

  const enabled = (['read', 'create', 'edit', 'delete'] as const).filter(
    (scope) => grants[scope],
  );
  publish({
    kind: 'connection',
    status: 'completed',
    summary: `${application.displayName} permissions updated`,
    detail:
      enabled.length === 0
        ? 'All permissions are blocked.'
        : `Granted: ${enabled.join(', ')}. Destructive operations still need per-call confirmation.`,
    meta: {
      connector: connectorId,
      read: grants.read,
      create: grants.create,
      edit: grants.edit,
      delete: grants.delete,
      updatedAt,
    },
  });

  return connectorSnapshot();
}


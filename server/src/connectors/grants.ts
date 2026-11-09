import type { ConnectorGrantSet, ConnectorPermissionKind } from '@shared';
import { listConnectorPermissions } from '../db/repositories/connectors';

export const CONNECTOR_PERMISSION_SCOPES: readonly ConnectorPermissionKind[] = [
  'read',
  'create',
  'edit',
  'delete',
];

export function defaultConnectorGrants(): ConnectorGrantSet {
  return { read: true, create: false, edit: false, delete: false };
}

export function loadConnectorGrants(connector: string): ConnectorGrantSet {
  const grants = defaultConnectorGrants();

  for (const row of listConnectorPermissions(connector)) {
    if (!CONNECTOR_PERMISSION_SCOPES.includes(row.scope as ConnectorPermissionKind)) continue;
    grants[row.scope as ConnectorPermissionKind] = row.level === 'allow';
  }

  return grants;
}

export function hasWriteGrant(grants: ConnectorGrantSet): boolean {
  return grants.create || grants.edit || grants.delete;
}

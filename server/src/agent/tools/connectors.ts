import type {
  ConnectorCapability,
  ConnectorPermissionKind,
  ConnectorToolDefinition,
} from '@shared';
import { executeConnectorTool, listConnectorTools } from '../../services/connectorToolService';
import type { AgentRisk } from '@shared';
import type { AgentTool } from '../types';

function permissionFor(capability: ConnectorCapability): ConnectorPermissionKind {
  if (capability === 'delete') return 'delete';
  if (capability === 'create' || capability === 'append' || capability === 'update') return 'edit';
  return 'read';
}

function requirementFor(capability: ConnectorCapability): 'read' | 'write' | 'delete' {
  if (capability === 'delete') return 'delete';
  if (capability === 'create' || capability === 'append' || capability === 'update') return 'write';
  return 'read';
}

function riskFor(capability: ConnectorCapability): AgentRisk {
  if (capability === 'delete') return 'high';
  if (capability === 'create' || capability === 'append' || capability === 'update') return 'medium';
  return 'low';
}

function toAgentTool(tool: ConnectorToolDefinition): AgentTool {
  const permission = requirementFor(tool.capability);
  return {
    name: `connector.${tool.id}`,
    label: `${tool.connectorName}: ${tool.label}`,
    description: tool.description,
    source: 'connector',
    sourceLabel: tool.connectorName,
    permission,
    risk: riskFor(tool.capability),
    requiresConfirmation: permission !== 'read',
    timeoutMs: 30_000,
    inputSchema: tool.inputSchema,
    connectorId: tool.connectorId,
    connectorPermission: permissionFor(tool.capability),
    async execute(args, context) {
      const result = await executeConnectorTool(tool.id, args, {
        confirmed: context.confirmed,
      });
      return {
        summary: `${tool.connectorName}: ${tool.label} completed`,
        data: result,
      };
    },
  };
}

/** Connected adapters contribute their real operations; absent apps contribute none. */
export function listConnectorAgentTools(): AgentTool[] {
  return listConnectorTools().map(toAgentTool);
}

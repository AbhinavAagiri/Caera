import { env } from '../config/env';
import { getConnectedApplication } from '../db/repositories/connectors';
import { loadConnectorGrants } from '../connectors/grants';
import { computerOperationPolicy } from '../services/computerService';
import { assertKnowledgeSearchAllowed } from '../services/knowledgeService';
import { AgentError } from './errorHandling';
import type { AgentTool } from './types';

/**
 * Permissions are checked immediately before execution, not just when the
 * model plans. Disconnecting an app or removing a grant therefore takes effect
 * on the next action.
 */
export function assertAgentToolAllowed(tool: AgentTool): void {
  if (tool.source === 'knowledge') {
    try {
      assertKnowledgeSearchAllowed();
    } catch (cause) {
      throw new AgentError(
        'AGENT_PERMISSION_DENIED',
        cause instanceof Error ? cause.message : 'The knowledge index is not available.',
        { status: 403, hint: 'Enable local indexing in Knowledge, then retry.' },
      );
    }
    return;
  }

  if (tool.source === 'computer') {
    if (!tool.computerOperation) {
      throw new AgentError('AGENT_PERMISSION_DENIED', 'That computer tool has no registered operation.', { status: 403 });
    }
    const { settings, policy } = computerOperationPolicy(tool.computerOperation);
    if (!settings.enabled || !policy.enabled) {
      throw new AgentError('AGENT_PERMISSION_DENIED', 'That computer operation is disabled in Tools and permissions.', { status: 403 });
    }
    return;
  }

  if (tool.source !== 'connector') return;

  if (!env.connectors.enabled) {
    throw new AgentError(
      'AGENT_PERMISSION_DENIED',
      'Connections are disabled on this local node.',
      { status: 409, hint: 'Enable connections before using connector tools.' },
    );
  }

  if (!tool.connectorId || !tool.connectorPermission) {
    throw new AgentError('AGENT_PERMISSION_DENIED', 'That connector tool has no permission scope.', {
      status: 403,
    });
  }

  const application = getConnectedApplication(tool.connectorId);
  if (!application || application.status !== 'connected') {
    throw new AgentError(
      'AGENT_PERMISSION_DENIED',
      `${tool.sourceLabel} is not connected, so this action was not attempted.`,
      { status: 409, hint: 'Open Connections and connect the application first.' },
    );
  }

  const grants = loadConnectorGrants(tool.connectorId);
  if (!grants[tool.connectorPermission]) {
    throw new AgentError(
      'AGENT_PERMISSION_DENIED',
      `${tool.sourceLabel} has not granted ${tool.connectorPermission} permission.`,
      { status: 403, hint: 'Review the independent connector grants in Connections.' },
    );
  }
}

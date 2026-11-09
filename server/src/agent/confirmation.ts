import { randomUUID } from 'node:crypto';
import type { AgentConfirmation } from '@shared';
import type { AgentTool, PendingAgentAction } from './types';

export function toolNeedsConfirmation(tool: AgentTool): boolean {
  return (
    (tool.confirmationRequired?.() ?? tool.requiresConfirmation) ||
    tool.permission === 'write' ||
    tool.permission === 'delete'
  );
}

function explanation(tool: AgentTool): string {
  if (tool.source === 'computer') {
    return 'This local computer action has not run. Review the exact target and arguments before approving it.';
  }
  if (tool.permission === 'delete') {
    return 'This permanently removes content in the connected application. It has not run.';
  }
  if (tool.permission === 'write') {
    return 'This creates or changes content in the connected application. It has not run.';
  }
  return 'This action requires approval before it can run.';
}

export function createPendingAction(
  tool: AgentTool,
  args: Record<string, unknown>,
  stepId: string,
  toolRunId: string,
): PendingAgentAction {
  return {
    requestId: randomUUID(),
    stepId,
    toolRunId,
    toolName: tool.name,
    toolLabel: tool.label,
    permission: tool.permission,
    risk: tool.risk,
    arguments: args,
    requestedAt: new Date().toISOString(),
    explanation: explanation(tool),
  };
}

export function toPublicConfirmation(pending: PendingAgentAction): AgentConfirmation {
  return {
    requestId: pending.requestId,
    toolName: pending.toolName,
    toolLabel: pending.toolLabel,
    permission: pending.permission,
    risk: pending.risk,
    arguments: pending.arguments,
    requestedAt: pending.requestedAt,
    explanation: pending.explanation,
  };
}

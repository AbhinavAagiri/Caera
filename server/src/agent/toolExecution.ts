import { AgentError, toAgentError, withTimeout } from './errorHandling';
import { validateAgentArguments } from './inputValidation';
import { assertAgentToolAllowed } from './permissionCheck';
import { inspectToolResult, type InspectedToolResult } from './resultInspection';
import type { AgentTool, AgentToolContext } from './types';

export interface AgentToolExecution extends InspectedToolResult {
  startedAt: string;
  finishedAt: string;
}

/**
 * The single executor used by the agent loop and by tests. It revalidates the
 * registered action, rechecks live permissions, enforces confirmation and
 * imposes a timeout before returning structured evidence.
 */
export async function executeAgentTool(
  tool: AgentTool,
  rawArguments: Record<string, unknown>,
  context: AgentToolContext,
): Promise<AgentToolExecution> {
  assertAgentToolAllowed(tool);

  if ((tool.requiresConfirmation || tool.permission === 'write' || tool.permission === 'delete') && !context.confirmed) {
    throw new AgentError(
      'AGENT_TOOL_CONFIRMATION_REQUIRED',
      `${tool.label} needs explicit approval before it can run.`,
      { status: 409, hint: 'Nothing was executed. Review the proposed action first.' },
    );
  }

  const args = validateAgentArguments(tool, rawArguments);
  const startedAt = new Date().toISOString();

  try {
    const result = await withTimeout(
      (signal) =>
        tool.execute(args, {
          ...context,
          signal,
          confirmed: context.confirmed,
        }),
      tool.timeoutMs,
      tool.label,
      context.signal,
    );
    const inspected = inspectToolResult(result);
    return {
      ...inspected,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (cause) {
    throw toAgentError(cause);
  }
}

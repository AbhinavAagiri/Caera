import type {
  ActivityStatus,
  AgentConfirmation,
  AgentRun,
  AgentRunStep,
  AgentToolRun,
} from '@shared';
import { publish } from '../services/eventBus';

function clip(value: string, max = 400): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function event(
  status: ActivityStatus,
  summary: string,
  detail: string | null,
  meta: Record<string, string | number | boolean>,
  kind: 'agent' | 'confirmation' | 'tool' = 'agent',
): void {
  publish({
    kind,
    status,
    summary: clip(summary, 160),
    detail: detail ? clip(detail, 400) : null,
    meta,
  });
}

export function publishAgentStarted(run: Pick<AgentRun, 'id' | 'task'>): void {
  event('started', 'Agent task started', run.task, {
    runId: run.id,
    task: clip(run.task, 120),
  });
}

export function publishAgentPlan(
  run: Pick<AgentRun, 'id' | 'steps'>,
): void {
  event(
    'progress',
    `Plan ready: ${run.steps.length} ${run.steps.length === 1 ? 'step' : 'steps'}`,
    run.steps.map((step) => step.title).join(' · '),
    { runId: run.id, steps: run.steps.length },
  );
}

export function publishAgentStep(
  run: Pick<AgentRun, 'id'>,
  step: AgentRunStep,
  status: ActivityStatus,
): void {
  event(status, `Step ${step.position}: ${step.title}`, step.summary ?? step.objective, {
    runId: run.id,
    step: step.position,
  });
}

export function publishAgentTool(
  run: Pick<AgentRun, 'id'>,
  step: AgentRunStep,
  toolRun: AgentToolRun,
  status: ActivityStatus,
): void {
  event(
    status,
    `${status === 'failed' ? 'Tool failed' : status === 'completed' ? 'Tool completed' : 'Tool selected'}: ${toolRun.toolLabel}`,
    toolRun.summary ?? toolRun.error ?? toolRun.toolName,
    { runId: run.id, step: step.position, tool: toolRun.toolName },
    'tool',
  );
}

export function publishAgentConfirmation(
  runId: string,
  step: AgentRunStep,
  confirmation: AgentConfirmation,
): void {
  event(
    'started',
    'Confirmation required',
    `${confirmation.toolLabel} is waiting for approval. Nothing has run.`,
    {
      runId,
      step: step.position,
      tool: confirmation.toolName,
      confirmation: true,
    },
    'confirmation',
  );
}

export function publishAgentFinished(
  run: Pick<AgentRun, 'id' | 'usage'>,
  status: 'completed' | 'failed' | 'cancelled',
  detail: string,
): void {
  event(
    status === 'completed' ? 'completed' : status === 'cancelled' ? 'info' : 'failed',
    status === 'completed'
      ? 'Agent task completed'
      : status === 'cancelled'
        ? 'Agent task cancelled'
        : 'Agent task failed',
    detail,
    { runId: run.id, toolCalls: run.usage.toolCalls },
  );
}

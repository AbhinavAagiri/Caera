import { randomUUID } from 'node:crypto';
import type { AgentRun, AgentRunStep, AgentToolRun } from '@shared';
import { getAgentRunRecord, updateAgentRun } from '../db/repositories/agentRuns';
import { logger } from '../services/logger';
import {
  publishAgentConfirmation,
  publishAgentFinished,
  publishAgentPlan,
  publishAgentStarted,
  publishAgentStep,
  publishAgentTool,
} from './activity';
import { createPendingAction, toolNeedsConfirmation } from './confirmation';
import {
  AgentError,
  assertWithinTimeLimit,
  safeAgentError,
  toAgentError,
} from './errorHandling';
import {
  answerTaskDirectly,
  composeAgentAnswer,
  decideStepAction,
} from './executionDecision';
import { validateAgentArguments } from './inputValidation';
import { AGENT_LIMITS, PUBLIC_AGENT_LIMITS, modelTimeout } from './limits';
import { planAgentTask, type AgentPlan } from './planning';
import { assertAgentToolAllowed } from './permissionCheck';
import { claimAgentRun, releaseAgentRun } from './runtime';
import { understandAgentTask } from './taskUnderstanding';
import { executeAgentTool } from './toolExecution';
import { findAgentTool, listAgentTools } from './toolDiscovery';
import type { AgentTool, StoredAgentRun } from './types';

export interface ExecuteAgentOptions {
  /** True only after the user approved the exact pending action. */
  resumeApproved?: boolean;
}

function now(): string {
  return new Date().toISOString();
}

function save(run: StoredAgentRun): void {
  run.updatedAt = now();
  updateAgentRun(run);
}

function makeSteps(plan: AgentPlan): AgentRunStep[] {
  return plan.steps.map((planned, index) => ({
    id: randomUUID(),
    position: index + 1,
    title: planned.title,
    objective: planned.objective,
    status: 'pending',
    toolRuns: [],
    summary: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  }));
}

function findStep(run: StoredAgentRun, stepId: string): AgentRunStep {
  const step = run.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new AgentError('AGENT_RUN_CONFLICT', 'The pending step no longer exists.');
  return step;
}

function makeToolRun(
  tool: AgentTool,
  args: Record<string, unknown>,
  status: AgentToolRun['status'],
): AgentToolRun {
  return {
    id: randomUUID(),
    toolName: tool.name,
    toolLabel: tool.label,
    arguments: args,
    status,
    summary: null,
    resultPreview: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

function completeRun(run: StoredAgentRun, answer: string): void {
  run.answer = answer;
  run.error = null;
  run.status = 'completed';
  run.finishedAt = now();
  run.pending = null;
}

function appendExecutionRecord(run: AgentRun, answer: string): string {
  const failures = run.steps.flatMap((step) =>
    step.toolRuns
      .filter((toolRun) => toolRun.status === 'failed')
      .map((toolRun) => `- ${step.title}: ${toolRun.toolLabel} failed — ${toolRun.error ?? 'no detail recorded'}`),
  );
  if (failures.length === 0) return answer;
  return `${answer.trimEnd()}\n\n## Recorded tool failures\n\n${failures.join('\n')}`;
}

function fallbackAnswer(run: AgentRun): string {
  const lines = run.steps.map((step) => {
    const summary = step.summary ?? (step.status === 'completed' ? 'Completed.' : `Status: ${step.status}.`);
    return `- **${step.title}** — ${summary}`;
  });
  return [
    'The planned steps finished, but the final narrative could not be generated.',
    '',
    ...lines,
    '',
    'The tool evidence above is recorded in this run.',
  ].join('\n');
}

async function executePendingApproval(
  run: StoredAgentRun,
  tools: AgentTool[],
  signal: AbortSignal,
): Promise<void> {
  const pending = run.pending;
  if (!pending) {
    throw new AgentError('AGENT_RUN_CONFLICT', 'This run has no action waiting for approval.');
  }
  const step = findStep(run, pending.stepId);
  const tool = tools.find((candidate) => candidate.name === pending.toolName);
  if (!tool) {
    throw new AgentError('AGENT_TOOL_NOT_FOUND', 'The approved tool is no longer registered.');
  }
  const toolRun = step.toolRuns.find((candidate) => candidate.id === pending.toolRunId);
  if (!toolRun) {
    throw new AgentError('AGENT_RUN_CONFLICT', 'The pending tool record no longer exists.');
  }

  step.status = 'running';
  step.error = null;
  run.status = 'running';
  run.pending = null;
  save(run);

  toolRun.startedAt = now();
  try {
    const result = await executeAgentTool(tool, pending.arguments, {
      runId: run.id,
      stepId: step.id,
      signal,
      confirmed: true,
    });
    toolRun.status = 'completed';
    toolRun.summary = result.summary;
    toolRun.resultPreview = result.preview;
    toolRun.finishedAt = result.finishedAt;
    run.usage.toolCalls += 1;
    save(run);
    publishAgentTool(run, step, toolRun, 'completed');
  } catch (cause) {
    const error = toAgentError(cause);
    toolRun.status = 'failed';
    toolRun.error = error.message;
    toolRun.finishedAt = now();
    run.usage.toolCalls += 1;
    save(run);
    publishAgentTool(run, step, toolRun, 'failed');
    if (signal.aborted || error.code === 'AGENT_CANCELLED') {
      throw new AgentError('AGENT_CANCELLED', 'The agent task was cancelled.', { status: 409 });
    }
  }
}

/**
 * The only agent execution loop. It claims a run, persists every state change,
 * and stops at confirmations rather than holding an HTTP request open.
 */
export async function executeAgentRun(
  runId: string,
  options: ExecuteAgentOptions = {},
): Promise<void> {
  const controller = claimAgentRun(runId);
  if (!controller) return;

  const segmentStarted = Date.now();
  let run = getAgentRunRecord(runId);
  let activeStep: AgentRunStep | null = null;

  try {
    if (!run) return;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return;
    if (run.status === 'awaiting_confirmation' && !options.resumeApproved) return;

    const deadline =
      Date.now() + Math.max(5_000, AGENT_LIMITS.maxRunMs - run.usage.elapsedMs);
    const tools = listAgentTools();

    if (run.status === 'queued') {
      run.status = 'running';
      save(run);
      publishAgentStarted(run);

      const understanding = await understandAgentTask(
        run.task,
        tools,
        controller.signal,
        modelTimeout(deadline),
      );
      const plan = await planAgentTask(
        run.task,
        understanding,
        tools,
        controller.signal,
        modelTimeout(deadline),
      );
      run.steps = makeSteps(plan);

      if (!understanding.requiresTools) {
        const step = run.steps[0];
        if (!step) throw new AgentError('AGENT_INVALID_MODEL_OUTPUT', 'Direct plan had no step.');
        activeStep = step;
        step.status = 'running';
        step.startedAt = now();
        save(run);
        publishAgentPlan(run);
        publishAgentStep(run, step, 'started');
        const answer = await answerTaskDirectly(
          run.task,
          controller.signal,
          modelTimeout(deadline),
        );
        step.status = 'completed';
        step.summary = 'Answered directly without a tool.';
        step.finishedAt = now();
        completeRun(run, answer);
        save(run);
        publishAgentFinished(run, 'completed', 'Answered without using a tool.');
        return;
      }

      save(run);
      publishAgentPlan(run);
    }

    if (options.resumeApproved) {
      await executePendingApproval(run, tools, controller.signal);
    }

    for (const step of run.steps) {
      if (step.status === 'completed' || step.status === 'skipped') continue;
      activeStep = step;

      if (step.status !== 'running') {
        step.status = 'running';
        step.startedAt ??= now();
        save(run);
        publishAgentStep(run, step, 'started');
      }

      let selectionError: string | null = null;
      let rounds = 0;

      while (true) {
        assertWithinTimeLimit(deadline);
        if (controller.signal.aborted) {
          throw new AgentError('AGENT_CANCELLED', 'The agent task was cancelled.', { status: 409 });
        }
        if (rounds >= AGENT_LIMITS.maxDecisionRoundsPerStep) {
          throw new AgentError(
            'AGENT_STEP_LIMIT',
            `Step ${step.position} used its ${AGENT_LIMITS.maxDecisionRoundsPerStep} action attempts without finishing.`,
            { status: 409, hint: 'The run stopped rather than looping.' },
          );
        }
        if (run.usage.toolCalls >= AGENT_LIMITS.maxToolCalls) {
          throw new AgentError(
            'AGENT_TOOL_LIMIT',
            `The task reached its ${AGENT_LIMITS.maxToolCalls} tool-call limit.`,
            { status: 409, hint: 'No additional action was attempted.' },
          );
        }

        const decision = await decideStepAction(
          run.task,
          step,
          { ...run, confirmation: null, limits: PUBLIC_AGENT_LIMITS } as AgentRun,
          tools,
          controller.signal,
          modelTimeout(deadline),
          selectionError,
        );

        if (decision.action === 'complete') {
          step.status = 'completed';
          step.summary = decision.summary;
          step.finishedAt = now();
          save(run);
          publishAgentStep(run, step, 'completed');
          activeStep = null;
          break;
        }

        if (decision.action === 'blocked') {
          throw new AgentError('AGENT_BLOCKED', decision.reason, {
            status: 409,
            hint: 'The agent stopped instead of taking an unplanned action.',
          });
        }

        const tool = findAgentTool(decision.tool);
        if (!tool) {
          selectionError = `Tool "${decision.tool}" is not registered.`;
          rounds += 1;
          continue;
        }

        let args: Record<string, unknown>;
        try {
          args = validateAgentArguments(tool, decision.args);
          assertAgentToolAllowed(tool);
        } catch (cause) {
          const error = toAgentError(cause);
          if (error.code === 'AGENT_PERMISSION_DENIED' || error.code === 'AGENT_TOOL_NOT_FOUND') {
            throw error;
          }
          selectionError = error.message;
          rounds += 1;
          continue;
        }

        if (toolNeedsConfirmation(tool)) {
          const toolRun = makeToolRun(tool, args, 'awaiting_confirmation');
          step.toolRuns.push(toolRun);
          step.status = 'awaiting_confirmation';
          const pending = createPendingAction(tool, args, step.id, toolRun.id);
          run.pending = pending;
          run.status = 'awaiting_confirmation';
          save(run);
          publishAgentConfirmation(run.id, step, {
            requestId: pending.requestId,
            toolName: pending.toolName,
            toolLabel: pending.toolLabel,
            permission: pending.permission,
            risk: pending.risk,
            arguments: pending.arguments,
            requestedAt: pending.requestedAt,
            explanation: pending.explanation,
          });
          return;
        }

        const toolRun = makeToolRun(tool, args, 'completed');
        toolRun.startedAt = now();
        try {
          const result = await executeAgentTool(tool, args, {
            runId: run.id,
            stepId: step.id,
            signal: controller.signal,
            confirmed: false,
          });
          toolRun.status = 'completed';
          toolRun.summary = result.summary;
          toolRun.resultPreview = result.preview;
          toolRun.finishedAt = result.finishedAt;
          step.toolRuns.push(toolRun);
          run.usage.toolCalls += 1;
          save(run);
          publishAgentTool(run, step, toolRun, 'completed');
        } catch (cause) {
          const error = toAgentError(cause);
          toolRun.status = 'failed';
          toolRun.error = error.message;
          toolRun.finishedAt = now();
          step.toolRuns.push(toolRun);
          run.usage.toolCalls += 1;
          save(run);
          publishAgentTool(run, step, toolRun, 'failed');
          if (controller.signal.aborted || error.code === 'AGENT_CANCELLED') {
            throw error;
          }
        }

        rounds += 1;
        selectionError = null;
      }
    }

    assertWithinTimeLimit(deadline);
    let answer: string;
    try {
      answer = await composeAgentAnswer(
        { ...run, confirmation: null, limits: PUBLIC_AGENT_LIMITS } as AgentRun,
        controller.signal,
        modelTimeout(deadline),
      );
    } catch (cause) {
      if (controller.signal.aborted) throw cause;
      logger.warn('agent_answer_composition_failed', {
        runId: run.id,
        code: toAgentError(cause).code,
      });
      answer = fallbackAnswer({ ...run, confirmation: null, limits: PUBLIC_AGENT_LIMITS } as AgentRun);
    }

    completeRun(
      run,
      appendExecutionRecord(
        { ...run, confirmation: null, limits: PUBLIC_AGENT_LIMITS } as AgentRun,
        answer,
      ),
    );
    save(run);
    publishAgentFinished(
      run,
      'completed',
      `${run.steps.length} ${run.steps.length === 1 ? 'step' : 'steps'}, ${run.usage.toolCalls} tool ${run.usage.toolCalls === 1 ? 'call' : 'calls'}`,
    );
  } catch (cause) {
    if (!run) {
      logger.error('agent_run_missing_during_failure', { runId });
      return;
    }
    const error = toAgentError(cause);
    const cancelled = controller.signal.aborted || error.code === 'AGENT_CANCELLED';
    if (activeStep && activeStep.status === 'running') {
      activeStep.status = cancelled ? 'skipped' : 'failed';
      activeStep.error = error.message;
      activeStep.finishedAt = now();
    }
    run.status = cancelled ? 'cancelled' : 'failed';
    run.error = safeAgentError(error);
    run.pending = null;
    run.finishedAt = now();
    if (cancelled) run.answer = 'The task was cancelled. No further actions were attempted.';
    save(run);
    publishAgentFinished(
      run,
      cancelled ? 'cancelled' : 'failed',
      cancelled ? 'Cancelled by the user.' : error.message,
    );
  } finally {
    const latest = getAgentRunRecord(runId);
    if (latest && run) {
      latest.usage.elapsedMs = run.usage.elapsedMs + (Date.now() - segmentStarted);
      latest.updatedAt = now();
      updateAgentRun(latest);
      run = latest;
    }
    releaseAgentRun(runId);
  }
}

import { randomUUID } from 'node:crypto';
import type { AgentRun } from '@shared';
import {
  getAgentRunRecord,
  insertAgentRun,
  listAgentRunRecords,
  markInterruptedAgentRuns,
  updateAgentRun,
} from '../db/repositories/agentRuns';
import { hasUsableModel } from '../ai/aiService';
import { logger } from '../services/logger';
import { publishAgentFinished } from './activity';
import { AgentError } from './errorHandling';
import { PUBLIC_AGENT_LIMITS } from './limits';
import { executeAgentRun } from './orchestrator';
import { toAgentRun } from './publicRun';
import { abortAgentRun } from './runtime';
import type { StoredAgentRun } from './types';

function now(): string {
  return new Date().toISOString();
}

function save(run: StoredAgentRun): void {
  run.updatedAt = now();
  updateAgentRun(run);
}

export function getAgentRun(id: string): AgentRun | null {
  const record = getAgentRunRecord(id);
  return record ? toAgentRun(record) : null;
}

export function listAgentRuns(limit = 20): AgentRun[] {
  return listAgentRunRecords(limit).map(toAgentRun);
}

export function createAgentRun(task: string): AgentRun {
  if (!hasUsableModel()) {
    throw new AgentError(
      'AGENT_PROVIDER_NOT_CONFIGURED',
      'No configured AI model is available, so the agent cannot understand or plan this task.',
      {
        status: 409,
        hint: 'Connect a provider in Settings → Models & usage, then start the task again.',
      },
    );
  }

  const timestamp = now();
  const record: StoredAgentRun = {
    id: randomUUID(),
    task,
    status: 'queued',
    steps: [],
    pending: null,
    answer: null,
    error: null,
    usage: { toolCalls: 0, elapsedMs: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
  };
  insertAgentRun(record);
  scheduleAgentRun(record.id, false);
  return toAgentRun(record);
}

function scheduleAgentRun(runId: string, resumeApproved: boolean): void {
  setImmediate(() => {
    void executeAgentRun(runId, { resumeApproved }).catch((cause) => {
      const record = getAgentRunRecord(runId);
      if (!record || record.status === 'completed' || record.status === 'cancelled') return;
      record.status = 'failed';
      record.error = {
        code: 'AGENT_INTERNAL_ERROR',
        message: 'The agent worker stopped before it could finish.',
        hint: 'Check the local node terminal. Completed tool results remain recorded.',
      };
      record.pending = null;
      record.finishedAt = now();
      save(record);
      logger.error('agent_worker_failed', {
        runId,
        name: cause instanceof Error ? cause.name : 'unknown',
      });
      publishAgentFinished(toAgentRun(record), 'failed', record.error.message);
    });
  });
}

export function decideAgentRun(id: string, approve: boolean): AgentRun {
  const run = getAgentRunRecord(id);
  if (!run) throw new AgentError('AGENT_RUN_NOT_FOUND', 'That agent run is not stored locally.', { status: 404 });
  if (run.status !== 'awaiting_confirmation' || !run.pending) {
    throw new AgentError('AGENT_RUN_CONFLICT', 'This run is not waiting for confirmation.', {
      status: 409,
    });
  }

  if (!approve) {
    const pending = run.pending;
    const step = run.steps.find((candidate) => candidate.id === pending.stepId);
    const toolRun = step?.toolRuns.find((candidate) => candidate.id === pending.toolRunId);
    if (toolRun) {
      toolRun.status = 'denied';
      toolRun.finishedAt = now();
      toolRun.summary = 'The user did not approve this action.';
    }
    if (step) {
      step.status = 'skipped';
      step.finishedAt = now();
    }
    run.status = 'cancelled';
    run.pending = null;
    run.finishedAt = now();
    run.answer = 'The proposed action was not approved, so it was not executed. The task stopped.';
    save(run);
    publishAgentFinished(toAgentRun(run), 'cancelled', 'The user rejected the proposed action.');
    return toAgentRun(run);
  }

  run.status = 'running';
  save(run);
  scheduleAgentRun(run.id, true);
  return toAgentRun(run);
}

export function cancelAgentRun(id: string): AgentRun {
  const run = getAgentRunRecord(id);
  if (!run) throw new AgentError('AGENT_RUN_NOT_FOUND', 'That agent run is not stored locally.', { status: 404 });
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return toAgentRun(run);
  }

  if (run.status === 'awaiting_confirmation') {
    const pending = run.pending;
    if (pending) {
      const step = run.steps.find((candidate) => candidate.id === pending.stepId);
      const toolRun = step?.toolRuns.find((candidate) => candidate.id === pending.toolRunId);
      if (toolRun) {
        toolRun.status = 'denied';
        toolRun.finishedAt = now();
        toolRun.summary = 'Cancelled before approval.';
      }
      if (step) {
        step.status = 'skipped';
        step.finishedAt = now();
      }
    }
    run.status = 'cancelled';
    run.pending = null;
    run.answer = 'The task was cancelled before the proposed action was approved.';
    run.finishedAt = now();
    save(run);
    publishAgentFinished(toAgentRun(run), 'cancelled', 'Cancelled while awaiting confirmation.');
    return toAgentRun(run);
  }

  if (!abortAgentRun(id)) {
    run.status = 'cancelled';
    run.pending = null;
    run.answer = 'The task was cancelled. No further actions were attempted.';
    run.finishedAt = now();
    save(run);
    publishAgentFinished(toAgentRun(run), 'cancelled', 'Cancelled by the user.');
  }
  return toAgentRun(run);
}

export function recoverInterruptedAgentRuns(): number {
  const count = markInterruptedAgentRuns(now());
  if (count > 0) {
    logger.warn('agent_runs_interrupted_by_restart', { count });
  }
  return count;
}

export function agentRunLimits(): typeof PUBLIC_AGENT_LIMITS {
  return PUBLIC_AGENT_LIMITS;
}

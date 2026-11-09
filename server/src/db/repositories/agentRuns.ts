import type { AgentRun } from '@shared';
import { getDatabase } from '../database';
import type { PendingAgentAction, StoredAgentRun } from '../../agent/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRunStatus(value: unknown): AgentRun['status'] {
  return value === 'queued' ||
    value === 'running' ||
    value === 'awaiting_confirmation' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
    ? value
    : 'failed';
}

function asSteps(value: unknown): AgentRun['steps'] {
  return Array.isArray(value) ? (value as AgentRun['steps']) : [];
}

function asError(value: unknown): AgentRun['error'] {
  return isRecord(value) && typeof value.message === 'string' && typeof value.code === 'string'
    ? {
        code: value.code,
        message: value.message,
        ...(typeof value.hint === 'string' ? { hint: value.hint } : {}),
      }
    : null;
}

function asUsage(value: unknown): AgentRun['usage'] {
  if (!isRecord(value)) return { toolCalls: 0, elapsedMs: 0 };
  return {
    toolCalls: typeof value.toolCalls === 'number' && value.toolCalls >= 0 ? value.toolCalls : 0,
    elapsedMs: typeof value.elapsedMs === 'number' && value.elapsedMs >= 0 ? value.elapsedMs : 0,
  };
}

function asPending(value: unknown): PendingAgentAction | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.requestId !== 'string' ||
    typeof value.stepId !== 'string' ||
    typeof value.toolRunId !== 'string' ||
    typeof value.toolName !== 'string' ||
    typeof value.toolLabel !== 'string' ||
    typeof value.arguments !== 'object' ||
    value.arguments === null ||
    Array.isArray(value.arguments) ||
    typeof value.requestedAt !== 'string' ||
    typeof value.explanation !== 'string'
  ) {
    return null;
  }

  return {
    requestId: value.requestId,
    stepId: value.stepId,
    toolRunId: value.toolRunId,
    toolName: value.toolName,
    toolLabel: value.toolLabel,
    permission:
      value.permission === 'read' ||
      value.permission === 'write' ||
      value.permission === 'delete' ||
      value.permission === 'network' ||
      value.permission === 'local'
        ? value.permission
        : 'write',
    risk: value.risk === 'low' || value.risk === 'medium' || value.risk === 'high' ? value.risk : 'medium',
    arguments: value.arguments as Record<string, unknown>,
    requestedAt: value.requestedAt,
    explanation: value.explanation,
  };
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toRecord(row: Record<string, unknown>): StoredAgentRun {
  return {
    id: typeof row.id === 'string' ? row.id : '',
    task: typeof row.task === 'string' ? row.task : '',
    status: asRunStatus(row.status),
    steps: asSteps(parseJson(row.steps_json, [])),
    pending: asPending(parseJson(row.pending_json, null)),
    answer: typeof row.answer === 'string' ? row.answer : null,
    error: asError(parseJson(row.error_json, null)),
    usage: asUsage(parseJson(row.usage_json, { toolCalls: 0, elapsedMs: 0 })),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
    finishedAt: typeof row.finished_at === 'string' ? row.finished_at : null,
  };
}

const SELECT_COLUMNS = `
  id, task, status, steps_json, pending_json, answer, error_json,
  usage_json, created_at, updated_at, finished_at
`;

export function insertAgentRun(run: StoredAgentRun): void {
  getDatabase()
    .prepare(
      `INSERT INTO agent_runs
         (id, task, status, steps_json, pending_json, answer, error_json,
          usage_json, created_at, updated_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.task,
      run.status,
      JSON.stringify(run.steps),
      run.pending ? JSON.stringify(run.pending) : null,
      run.answer,
      run.error ? JSON.stringify(run.error) : null,
      JSON.stringify(run.usage),
      run.createdAt,
      run.updatedAt,
      run.finishedAt,
    );
}

export function updateAgentRun(run: StoredAgentRun): void {
  getDatabase()
    .prepare(
      `UPDATE agent_runs SET
         status = ?, steps_json = ?, pending_json = ?, answer = ?,
         error_json = ?, usage_json = ?, updated_at = ?, finished_at = ?
       WHERE id = ?`,
    )
    .run(
      run.status,
      JSON.stringify(run.steps),
      run.pending ? JSON.stringify(run.pending) : null,
      run.answer,
      run.error ? JSON.stringify(run.error) : null,
      JSON.stringify(run.usage),
      run.updatedAt,
      run.finishedAt,
      run.id,
    );
}

export function getAgentRunRecord(id: string): StoredAgentRun | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM agent_runs WHERE id = ?`)
    .get(id);
  return row ? toRecord(row) : null;
}

export function listAgentRunRecords(limit = 20): StoredAgentRun[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || 1, 1), 100);
  const rows = getDatabase()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM agent_runs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(capped);
  return rows.map(toRecord);
}

/**
 * Runs left queued/running by a crash have no worker after restart. Mark them
 * failed instead of leaving a permanently "running" interface. Awaiting
 * confirmations are intentionally retained and can be approved or cancelled.
 */
export function markInterruptedAgentRuns(now: string): number {
  const result = getDatabase()
    .prepare(
      `UPDATE agent_runs
       SET status = 'failed',
           error_json = ?,
           updated_at = ?,
           finished_at = ?
       WHERE status IN ('queued', 'running')`,
    )
    .run(
      JSON.stringify({
        code: 'AGENT_INTERRUPTED',
        message: 'The local node restarted while this task was running.',
        hint: 'Start the task again. Completed tool results remain in the run history.',
      }),
      now,
      now,
    );

  return Number(result.changes);
}

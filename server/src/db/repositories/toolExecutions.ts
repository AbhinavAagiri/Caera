import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database';

export type ToolExecutionStatus = 'pending' | 'approved' | 'denied' | 'completed' | 'failed';

export interface ToolExecutionRecord {
  id: string;
  toolId: string;
  conversationId: string | null;
  status: ToolExecutionStatus;
  summary: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
}

export interface RecordToolExecutionInput {
  toolId: string;
  conversationId?: string | null;
  status: ToolExecutionStatus;
  summary: string;
  startedAt?: string;
  finishedAt?: string | null;
  errorCode?: string | null;
}

function toStatus(value: unknown): ToolExecutionStatus {
  return value === 'pending' ||
    value === 'approved' ||
    value === 'denied' ||
    value === 'completed' ||
    value === 'failed'
    ? value
    : 'failed';
}

function toRecord(row: Record<string, unknown>): ToolExecutionRecord {
  return {
    id: typeof row.id === 'string' ? row.id : '',
    toolId: typeof row.tool_id === 'string' ? row.tool_id : '',
    conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    status: toStatus(row.status),
    summary: typeof row.summary === 'string' ? row.summary : '',
    startedAt: typeof row.started_at === 'string' ? row.started_at : '',
    finishedAt: typeof row.finished_at === 'string' ? row.finished_at : null,
    errorCode: typeof row.error_code === 'string' ? row.error_code : null,
  };
}

/**
 * Records what a tool did, never the private payload it acted on. Keep
 * `summary` short and safe for display; raw inputs and note contents do not
 * belong in this table.
 */
export function recordToolExecution(input: RecordToolExecutionInput): ToolExecutionRecord {
  const id = randomUUID();
  const startedAt = input.startedAt ?? new Date().toISOString();

  getDatabase()
    .prepare(
      `INSERT INTO tool_executions
         (id, tool_id, conversation_id, status, summary, started_at, finished_at, error_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.toolId,
      input.conversationId ?? null,
      input.status,
      input.summary.slice(0, 500),
      startedAt,
      input.finishedAt ?? null,
      input.errorCode ?? null,
    );

  return {
    id,
    toolId: input.toolId,
    conversationId: input.conversationId ?? null,
    status: input.status,
    summary: input.summary.slice(0, 500),
    startedAt,
    finishedAt: input.finishedAt ?? null,
    errorCode: input.errorCode ?? null,
  };
}

export function listToolExecutions(limit = 100): ToolExecutionRecord[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || 1, 1), 500);
  const rows = getDatabase()
    .prepare(
      `SELECT id, tool_id, conversation_id, status, summary, started_at, finished_at, error_code
       FROM tool_executions
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(capped);

  return rows.map((row) => toRecord(row));
}

import type { AgentRun } from '@shared';
import { PUBLIC_AGENT_LIMITS } from './limits';
import { toPublicConfirmation } from './confirmation';
import type { StoredAgentRun } from './types';

export function toAgentRun(record: StoredAgentRun): AgentRun {
  return {
    id: record.id,
    task: record.task,
    status: record.status,
    steps: record.steps,
    confirmation: record.pending ? toPublicConfirmation(record.pending) : null,
    answer: record.answer,
    error: record.error,
    usage: record.usage,
    limits: PUBLIC_AGENT_LIMITS,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    finishedAt: record.finishedAt,
  };
}

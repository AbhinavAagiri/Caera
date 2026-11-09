import type { AgentRunLimits } from '@shared';

export const AGENT_LIMITS = {
  maxSteps: 5,
  maxToolCalls: 8,
  maxRunMs: 180_000,
  toolTimeoutMs: 20_000,
  maxDecisionRoundsPerStep: 3,
  maxModelOutputTokens: 4_096,
  maxResultChars: 12_000,
  modelTimeoutMs: 45_000,
} as const;

export const PUBLIC_AGENT_LIMITS: AgentRunLimits = {
  maxSteps: AGENT_LIMITS.maxSteps,
  maxToolCalls: AGENT_LIMITS.maxToolCalls,
  maxRunMs: AGENT_LIMITS.maxRunMs,
  toolTimeoutMs: AGENT_LIMITS.toolTimeoutMs,
};

export function resultCap(): number {
  return AGENT_LIMITS.maxResultChars;
}

export function modelTimeout(deadline: number): number {
  return Math.max(2_000, Math.min(AGENT_LIMITS.modelTimeoutMs, deadline - Date.now()));
}

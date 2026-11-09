import { AGENT_LIMITS } from './limits';
import type { AgentToolResult } from './types';

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({ note: 'The structured result could not be serialized.' });
  }
}

export function truncatePreview(value: string, max = AGENT_LIMITS.maxResultChars): {
  preview: string;
  truncated: boolean;
} {
  if (value.length <= max) return { preview: value, truncated: false };
  return {
    preview: `${value.slice(0, max)}\n…[result truncated at ${max} characters]`,
    truncated: true,
  };
}

export interface InspectedToolResult {
  summary: string;
  preview: string;
  truncated: boolean;
}

/**
 * Turns a tool's structured result into bounded evidence. The model and the
 * database receive the inspected preview, never an open-ended object graph.
 */
export function inspectToolResult(result: AgentToolResult): InspectedToolResult {
  const summary = compact(result.summary).slice(0, 500) || 'The tool completed.';
  const serialized = safeJson(result.data);
  return { summary, ...truncatePreview(serialized) };
}

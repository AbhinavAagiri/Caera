import { AgentError } from './errorHandling';
import type { AgentTool } from './types';

/**
 * Strict primitive-only validation. Unknown keys and out-of-range values are
 * rejected instead of coerced, so a model cannot smuggle unexpected fields into
 * an adapter call.
 */
export function validateAgentArguments(
  tool: AgentTool,
  raw: unknown,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalid(tool, 'Arguments must be a JSON object.');
  }

  const input = raw as Record<string, unknown>;
  const known = new Set(Object.keys(tool.inputSchema.properties));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw invalid(tool, `Unknown argument "${key}".`);
  }

  const validated: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(tool.inputSchema.properties)) {
    const value = input[name];
    if (value === undefined) {
      if (tool.inputSchema.required.includes(name)) {
        throw invalid(tool, `Argument "${name}" is required.`);
      }
      continue;
    }

    if (schema.type === 'string') {
      if (typeof value !== 'string') throw invalid(tool, `Argument "${name}" must be text.`);
      if (schema.enum && !schema.enum.includes(value)) {
        throw invalid(tool, `Argument "${name}" has an unregistered value.`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw invalid(tool, `Argument "${name}" is longer than allowed.`);
      }
      validated[name] = value;
      continue;
    }

    if (schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw invalid(tool, `Argument "${name}" must be an integer.`);
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        throw invalid(tool, `Argument "${name}" is below its minimum.`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        throw invalid(tool, `Argument "${name}" is above its maximum.`);
      }
      validated[name] = value;
      continue;
    }

    if (typeof value !== 'boolean') {
      throw invalid(tool, `Argument "${name}" must be true or false.`);
    }
    validated[name] = value;
  }

  return validated;
}

function invalid(tool: AgentTool, message: string): AgentError {
  return new AgentError('AGENT_TOOL_ARGUMENTS_INVALID', `${tool.label}: ${message}`, {
    status: 400,
    hint: 'The invalid action was not executed.',
  });
}

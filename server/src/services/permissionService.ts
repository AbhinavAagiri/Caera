import type { PermissionLevel, PermissionSnapshot, ToolId } from '@shared';
import { loadPermissionLevels, savePermissionLevel } from '../db/repositories/permissions';
import { TOOL_CATALOG } from '../domain/tools';
import { publish } from './eventBus';

export async function getPermissionSnapshot(): Promise<PermissionSnapshot> {
  const { levels, updatedAt } = loadPermissionLevels();

  return {
    tools: TOOL_CATALOG.map((tool) => ({
      ...tool,
      level: levels[tool.id],
    })),
    updatedAt,
  };
}

export async function setPermissionLevel(
  toolId: ToolId,
  level: PermissionLevel,
): Promise<PermissionSnapshot> {
  const label = TOOL_CATALOG.find((tool) => tool.id === toolId)?.label ?? toolId;

  savePermissionLevel(toolId, level, new Date().toISOString());

  publish({
    kind: 'tool',
    status: 'completed',
    summary: 'Tool permission updated',
    detail: `${label} set to ${level}`,
    meta: { tool: toolId, level },
  });

  return getPermissionSnapshot();
}

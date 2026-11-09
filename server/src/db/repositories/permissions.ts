import type { PermissionLevel, ToolId } from '@shared';
import { DEFAULT_PERMISSIONS } from '../../domain/tools';
import { getDatabase } from '../database';

export interface StoredPermissionLevels {
  levels: Record<ToolId, PermissionLevel>;
  updatedAt: string | null;
}

function isPermissionLevel(value: unknown): value is PermissionLevel {
  return value === 'allow' || value === 'ask' || value === 'block';
}

export function loadPermissionLevels(): StoredPermissionLevels {
  const rows = getDatabase()
    .prepare('SELECT tool_id, level, updated_at FROM tool_permissions')
    .all();

  const levels: Record<ToolId, PermissionLevel> = { ...DEFAULT_PERMISSIONS };
  let updatedAt: string | null = null;

  for (const row of rows) {
    const toolId = typeof row.tool_id === 'string' ? row.tool_id : '';
    if (!(toolId in levels) || !isPermissionLevel(row.level)) continue;

    levels[toolId as ToolId] = row.level;

    if (typeof row.updated_at === 'string' && row.updated_at) {
      if (!updatedAt || row.updated_at > updatedAt) updatedAt = row.updated_at;
    }
  }

  return { levels, updatedAt };
}

export function savePermissionLevel(
  toolId: ToolId,
  level: PermissionLevel,
  updatedAt: string | null,
): void {
  getDatabase()
    .prepare(
      `INSERT INTO tool_permissions (tool_id, level, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(tool_id) DO UPDATE SET
         level = excluded.level,
         updated_at = excluded.updated_at`,
    )
    .run(toolId, level, updatedAt);
}

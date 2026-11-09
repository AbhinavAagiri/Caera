import { Router } from 'express';
import type { PermissionLevel, ToolId } from '@shared';
import { sendOk } from '../lib/http';
import { isRecord } from '../lib/validate';
import { HttpError } from '../middleware/errors';
import { getPermissionSnapshot, setPermissionLevel } from '../services/permissionService';
import { TOOL_CATALOG } from '../domain/tools';

const LEVELS: readonly PermissionLevel[] = ['allow', 'ask', 'block'];

function isToolId(value: string): value is ToolId {
  return TOOL_CATALOG.some((tool) => tool.id === value);
}

export const permissionsRouter = Router();

permissionsRouter.get('/', async (_req, res) => {
  sendOk(res, await getPermissionSnapshot());
});

permissionsRouter.put('/:toolId', async (req, res) => {
  const toolId = req.params.toolId;

  if (!isToolId(toolId)) {
    throw new HttpError(404, 'NOT_FOUND', `Unknown tool "${toolId}".`);
  }

  const body = isRecord(req.body) ? req.body : {};
  const level = body.level;

  if (typeof level !== 'string' || !LEVELS.includes(level as PermissionLevel)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'level must be one of allow, ask or block.');
  }

  sendOk(res, await setPermissionLevel(toolId, level as PermissionLevel));
});

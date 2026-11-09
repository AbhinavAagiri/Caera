import { Router } from 'express';
import type { ConnectorPermissionInput } from '@shared';
import { sendOk } from '../lib/http';
import { isRecord } from '../lib/validate';
import { HttpError } from '../middleware/errors';
import {
  connectConnector,
  connectorSnapshot,
  disconnectConnector,
  previewConnectorDraft,
  setConnectorPermissions,
  testConnector,
} from '../services/connectorService';
import {
  executeConnectorTool,
  listConnectorTools,
} from '../services/connectorToolService';
import { listConnectorDirectories } from '../services/directoryBrowserService';

export const connectorsRouter = Router();

connectorsRouter.get('/', (_req, res) => {
  sendOk(res, connectorSnapshot());
});

connectorsRouter.get('/tools', (_req, res) => {
  sendOk(res, { tools: listConnectorTools() });
});

connectorsRouter.post('/tools/:toolId/execute', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (body.confirmed !== undefined && typeof body.confirmed !== 'boolean') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'confirmed must be true or false.');
  }

  const result = await executeConnectorTool(req.params.toolId, body.arguments ?? {}, {
    confirmed: body.confirmed === true,
  });
  sendOk(res, { result });
});

connectorsRouter.get('/:id/directories', (req, res) => {
  const rawPath = typeof req.query.path === 'string' ? req.query.path : undefined;
  sendOk(res, listConnectorDirectories(req.params.id, rawPath));
});

connectorsRouter.post('/:id/draft', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (typeof body.title !== 'string' || !body.title.trim()) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'title is required.');
  }
  if (body.content !== undefined && typeof body.content !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'content must be a string.');
  }
  if (body.folder !== undefined && typeof body.folder !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'folder must be a string.');
  }

  sendOk(res, {
    preview: await previewConnectorDraft(req.params.id, {
      title: body.title,
      content: typeof body.content === 'string' ? body.content : '',
      ...(typeof body.folder === 'string' ? { folder: body.folder } : {}),
    }),
  });
});

connectorsRouter.post('/:id/connect', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const configuration = body.configuration ?? {};
  if (!isRecord(configuration)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'configuration must be an object.');
  }
  sendOk(res, await connectConnector(req.params.id, configuration));
});

connectorsRouter.post('/:id/test', async (req, res) => {
  sendOk(res, await testConnector(req.params.id));
});

connectorsRouter.put('/:id/permissions', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  for (const scope of ['read', 'create', 'edit', 'delete'] as const) {
    if (typeof body[scope] !== 'boolean') {
      throw new HttpError(400, 'VALIDATION_ERROR', `${scope} must be true or false.`);
    }
  }
  if (
    body.confirmWriteAccess !== undefined &&
    typeof body.confirmWriteAccess !== 'boolean'
  ) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'confirmWriteAccess must be true or false.');
  }

  const input: ConnectorPermissionInput = {
    read: body.read as boolean,
    create: body.create as boolean,
    edit: body.edit as boolean,
    delete: body.delete as boolean,
    ...(body.confirmWriteAccess === true ? { confirmWriteAccess: true } : {}),
  };
  sendOk(res, await setConnectorPermissions(req.params.id, input));
});

connectorsRouter.delete('/:id', async (req, res) => {
  sendOk(res, await disconnectConnector(req.params.id));
});

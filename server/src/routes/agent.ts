import { Router } from 'express';
import { env } from '../config/env';
import { sendOk } from '../lib/http';
import { isRecord, requireString } from '../lib/validate';
import { HttpError } from '../middleware/errors';
import { agentRunLimits, cancelAgentRun, createAgentRun, decideAgentRun, getAgentRun, listAgentRuns } from '../agent/runService';
import { AgentError, toAgentError } from '../agent/errorHandling';
import { agentToolCatalog } from '../agent/toolDiscovery';

function notFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', 'That agent run is not stored locally.');
}

function sendFailure(cause: unknown): never {
  const error = cause instanceof AgentError ? cause : toAgentError(cause);
  throw new HttpError(error.status, error.code, error.message, error.hint);
}

export const agentRouter = Router();

agentRouter.get('/tools', (_req, res) => {
  sendOk(res, agentToolCatalog());
});

agentRouter.get('/runs', (req, res) => {
  const raw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 50) : 20;
  sendOk(res, { runs: listAgentRuns(limit) });
});

agentRouter.post('/runs', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const task = requireString(body.task, {
    field: 'task',
    max: env.limits.messageChars,
  });

  try {
    sendOk(res, { run: createAgentRun(task), limits: agentRunLimits() }, 202);
  } catch (cause) {
    sendFailure(cause);
  }
});

agentRouter.get('/runs/:id', (req, res) => {
  const run = getAgentRun(req.params.id);
  if (!run) throw notFound();
  sendOk(res, { run });
});

agentRouter.post('/runs/:id/decision', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (typeof body.approve !== 'boolean') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'approve must be true or false.');
  }
  try {
    sendOk(res, { run: decideAgentRun(req.params.id, body.approve) });
  } catch (cause) {
    sendFailure(cause);
  }
});

agentRouter.post('/runs/:id/cancel', (req, res) => {
  try {
    sendOk(res, { run: cancelAgentRun(req.params.id) });
  } catch (cause) {
    sendFailure(cause);
  }
});

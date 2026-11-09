import { Router } from 'express';
import { env } from '../config/env';
import { sendOk } from '../lib/http';
import { openServerSentEvents } from '../lib/sse';
import { isRecord, optionalString, requireString } from '../lib/validate';
import { HttpError } from '../middleware/errors';
import {
  appendMessage,
  clearConversations,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
} from '../services/conversationService';
import { logger } from '../services/logger';
import { beginTurn, generateReply } from '../services/turnService';

export const conversationsRouter = Router();

conversationsRouter.get('/', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : undefined;
  sendOk(res, { conversations: await listConversations(query) });
});

conversationsRouter.post('/', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const firstMessage = optionalString(body.firstMessage, {
    field: 'firstMessage',
    max: env.limits.messageChars,
  });
  const title = optionalString(body.title, { field: 'title', max: env.limits.titleChars });

  const conversation = await createConversation({
    ...(firstMessage ? { firstMessage } : {}),
    ...(title ? { title } : {}),
  });

  sendOk(res, { conversation }, 201);
});

conversationsRouter.delete('/', async (_req, res) => {
  sendOk(res, { deleted: await clearConversations() });
});

conversationsRouter.get('/:id', async (req, res) => {
  const conversation = await getConversation(req.params.id);
  if (!conversation) {
    throw new HttpError(404, 'NOT_FOUND', 'That conversation is not in the local store.');
  }
  sendOk(res, { conversation });
});

conversationsRouter.patch('/:id', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const title = requireString(body.title, {
    field: 'title',
    max: env.limits.titleChars,
  });

  const conversation = await renameConversation(req.params.id, title);
  if (!conversation) {
    throw new HttpError(404, 'NOT_FOUND', 'That conversation is not in the local store.');
  }

  sendOk(res, { conversation });
});

conversationsRouter.delete('/:id', async (req, res) => {
  const deleted = await deleteConversation(req.params.id);
  if (!deleted) {
    throw new HttpError(404, 'NOT_FOUND', 'That conversation is not in the local store.');
  }
  sendOk(res, { deleted: true });
});

conversationsRouter.post('/:id/messages', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const content = requireString(body.content, {
    field: 'content',
    max: env.limits.messageChars,
  });

  const conversation = await appendMessage(req.params.id, content);
  if (!conversation) {
    throw new HttpError(404, 'NOT_FOUND', 'That conversation is not in the local store.');
  }

  sendOk(res, { conversation });
});

conversationsRouter.post('/:id/turns', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const content = requireString(body.content, {
    field: 'content',
    max: env.limits.messageChars,
  });
  const overrideModel =
    typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
  const mode =
    body.mode === 'economy' || body.mode === 'balanced' || body.mode === 'maximum'
      ? body.mode
      : undefined;

  if (
    overrideModel &&
    overrideModel !== 'auto' &&
    !/^[a-z]+\/[a-zA-Z0-9._:/-]{1,160}$/.test(overrideModel)
  ) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'model must be auto or a provider/model reference.');
  }

  const prepared = beginTurn(req.params.id, content, overrideModel);
  if (!prepared) {
    throw new HttpError(404, 'NOT_FOUND', 'That conversation is not in the local store.');
  }

  const client = new AbortController();
  const stream = openServerSentEvents(res, () => client.abort());

  stream.send({
    type: 'turn_started',
    conversation: prepared.conversation,
    userMessage: prepared.userMessage,
    assistantMessageId: prepared.assistantMessageId,
    model: prepared.model,
  });

  try {
    await generateReply({
      conversationId: req.params.id,
      userMessage: prepared.userMessage,
      assistantMessageId: prepared.assistantMessageId,
      model: prepared.model,
      clientSignal: client.signal,
      send: (event) => stream.send(event),
      ...(overrideModel ? { overrideModel } : {}),
      ...(mode ? { mode } : {}),
    });
  } catch (cause) {
    logger.error('turn_stream_failed', {
      name: cause instanceof Error ? cause.name : 'unknown_error',
    });
    const conversation = await getConversation(req.params.id).catch(() => null);
    stream.send({
      type: 'turn_error',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The local node could not finish the reply.',
        hint: 'Check the server terminal and try again.',
      },
      conversation,
    });
  } finally {
    stream.close();
  }
});

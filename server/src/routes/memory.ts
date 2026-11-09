import { Router } from 'express';
import type { MemoryEntryInput, MemoryKind, MemoryUpdateInput } from '@shared';
import { sendOk } from '../lib/http';
import { isRecord, requireString } from '../lib/validate';
import { HttpError } from '../middleware/errors';
import {
  clearMemories,
  createMemory,
  deleteMemory,
  getMemory,
  listMemory,
  memorySettingsResult,
  normalizeMemoryKind,
  setMemoryPaused,
  updateMemory,
  type MemoryListOptions,
} from '../services/memoryService';

export const memoryRouter = Router();

function optionalKind(value: unknown): MemoryKind | undefined {
  if (value === undefined) return undefined;
  return normalizeMemoryKind(value);
}

function optionalNullableText(
  value: unknown,
  field: string,
  max: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be a string or null.`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be ${max} characters or fewer.`);
  }
  return text || null;
}

function optionalRelatedIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'relatedMemoryIds must be an array of at most 8 ids.',
    );
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Related memory ids must be strings.');
    }
    return entry.trim();
  });
}

function optionalSourceId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be a non-empty string.`);
  }
  return value.trim();
}

memoryRouter.get('/', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  if (query && query.length > 200) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'The memory search is too long.');
  }
  const kind = optionalKind(req.query.kind);
  const options: MemoryListOptions = {
    ...(query ? { query } : {}),
    ...(kind ? { kind } : {}),
  };
  sendOk(res, listMemory(options));
});

memoryRouter.get('/settings', (_req, res) => {
  sendOk(res, memorySettingsResult());
});

memoryRouter.put('/settings', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (typeof body.paused !== 'boolean') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'paused must be true or false.');
  }
  sendOk(res, setMemoryPaused(body.paused));
});

memoryRouter.post('/', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const content = requireString(body.content, {
    field: 'content',
    max: 2_000,
  });
  const kind = optionalKind(body.kind);
  const subject = optionalNullableText(body.subject, 'subject', 120);
  const reason = optionalNullableText(body.reason, 'reason', 500);
  const relatedMemoryIds = optionalRelatedIds(body.relatedMemoryIds);
  const sourceConversationId = optionalSourceId(
    body.sourceConversationId,
    'sourceConversationId',
  );
  const sourceMessageId = optionalSourceId(body.sourceMessageId, 'sourceMessageId');

  const input: MemoryEntryInput = {
    content,
    ...(kind ? { kind } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(relatedMemoryIds !== undefined ? { relatedMemoryIds } : {}),
    ...(sourceConversationId ? { sourceConversationId } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
  };

  sendOk(res, { entry: createMemory(input) }, 201);
});

memoryRouter.patch('/:id', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const content =
    body.content === undefined
      ? undefined
      : requireString(body.content, { field: 'content', max: 2_000 });
  const kind = optionalKind(body.kind);
  const subject = optionalNullableText(body.subject, 'subject', 120);
  const reason = optionalNullableText(body.reason, 'reason', 500);
  const relatedMemoryIds = optionalRelatedIds(body.relatedMemoryIds);

  const input: MemoryUpdateInput = {
    ...(content !== undefined ? { content } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(relatedMemoryIds !== undefined ? { relatedMemoryIds } : {}),
  };

  const entry = updateMemory(req.params.id, input);
  if (!entry) {
    throw new HttpError(404, 'NOT_FOUND', 'That memory entry is not in the local store.');
  }
  sendOk(res, { entry });
});

memoryRouter.delete('/:id', (req, res) => {
  if (!getMemory(req.params.id)) {
    throw new HttpError(404, 'NOT_FOUND', 'That memory entry is not in the local store.');
  }
  if (!deleteMemory(req.params.id)) {
    throw new HttpError(404, 'NOT_FOUND', 'That memory entry is not in the local store.');
  }
  sendOk(res, { deleted: true });
});

memoryRouter.delete('/', (_req, res) => {
  sendOk(res, { deleted: clearMemories() });
});

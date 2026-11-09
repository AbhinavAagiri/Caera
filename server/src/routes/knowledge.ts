import { Router } from 'express';
import type {
  KnowledgeSearchInput,
  KnowledgeSettingsInput,
  KnowledgeSourceRules,
} from '@shared';
import { sendOk } from '../lib/http';
import { isRecord } from '../lib/validate';
import { HttpError } from '../middleware/errors';
import {
  clearKnowledge,
  knowledgeSnapshot,
  searchKnowledge,
  syncKnowledge,
  updateKnowledgeSettings,
} from '../services/knowledgeService';

function stringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be an array of strings.`);
  }
  return value.slice(0, 100) as string[];
}

function rules(value: unknown): KnowledgeSourceRules {
  if (!isRecord(value)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Each source needs an enabled flag.');
  }
  if (typeof value.enabled !== 'boolean') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Source enabled must be true or false.');
  }
  return {
    enabled: value.enabled,
    excludePaths: stringList(value.excludePaths, 'excludePaths'),
    excludeCategories: stringList(value.excludeCategories, 'excludeCategories'),
    excludeTags: stringList(value.excludeTags, 'excludeTags'),
  };
}

export const knowledgeRouter = Router();

knowledgeRouter.get('/', (_req, res) => {
  sendOk(res, knowledgeSnapshot());
});

knowledgeRouter.put('/settings', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (typeof body.enabled !== 'boolean' || !Array.isArray(body.sources)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Knowledge settings need enabled and sources.');
  }
  const sources = body.sources.slice(0, 100).map((entry) => {
    if (!isRecord(entry) || typeof entry.source !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Every source needs a registered id.');
    }
    return { source: entry.source, ...rules(entry) };
  });
  const input: KnowledgeSettingsInput = { enabled: body.enabled, sources };
  sendOk(res, updateKnowledgeSettings(input));
});

knowledgeRouter.post('/sync', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (body.sources !== undefined && !Array.isArray(body.sources)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'sources must be an array.');
  }
  const sources = Array.isArray(body.sources)
    ? body.sources.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
  sendOk(res, await syncKnowledge(sources));
});

knowledgeRouter.post('/search', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (typeof body.query !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'A search query is required.');
  }
  if (body.sources !== undefined && !Array.isArray(body.sources)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'sources must be an array.');
  }
  if (body.tags !== undefined && !Array.isArray(body.tags)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'tags must be an array.');
  }
  if (body.updatedFrom !== undefined && typeof body.updatedFrom !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'updatedFrom must be a date string.');
  }
  if (body.updatedTo !== undefined && typeof body.updatedTo !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'updatedTo must be a date string.');
  }
  if (body.limit !== undefined && (typeof body.limit !== 'number' || !Number.isInteger(body.limit))) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'limit must be an integer.');
  }
  const input: KnowledgeSearchInput = {
    query: body.query,
    ...(Array.isArray(body.sources)
      ? { sources: body.sources.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
    ...(Array.isArray(body.tags)
      ? { tags: body.tags.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
    ...(typeof body.updatedFrom === 'string' ? { updatedFrom: body.updatedFrom } : {}),
    ...(typeof body.updatedTo === 'string' ? { updatedTo: body.updatedTo } : {}),
    ...(typeof body.limit === 'number' ? { limit: body.limit } : {}),
  };
  sendOk(res, searchKnowledge(input));
});

knowledgeRouter.delete('/', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (body.source !== undefined && typeof body.source !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'source must be a string.');
  }
  sendOk(
    res,
    clearKnowledge({ ...(typeof body.source === 'string' ? { source: body.source } : {}) }),
  );
});

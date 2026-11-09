import { Router } from 'express';
import { sendOk } from '../lib/http';
import { isRecord } from '../lib/validate';
import { HttpError } from '../middleware/errors';
import {
  checkProvider,
  getProviderSettings,
  removeProviderKey,
  updateProviderSettings,
} from '../services/providerService';

export const providerRouter = Router();

function optionalApiKey(value: unknown): string | undefined {
  if (value === undefined || value === '' || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'apiKey must be a string.');
  }

  const key = value.trim();
  if (!key) return undefined;
  if (key.length < 20 || key.length > 500 || /\s/.test(key)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'apiKey does not look like a complete Gemini API key.',
      'Paste the key from Google AI Studio without spaces or quotes.',
    );
  }
  return key;
}

function optionalModel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'model must be a string.');
  }

  const model = value.trim();
  if (!model) return '';
  if (!/^[a-zA-Z0-9._-]{2,80}$/.test(model)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'model contains characters this node does not accept.',
      'Use a Gemini model id such as gemini-3.8-flash.',
    );
  }
  return model;
}

function optionalInstruction(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'systemInstruction must be a string.');
  }

  const instruction = value.trim();
  if (instruction.length > 8000) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'systemInstruction must be 8000 characters or fewer.',
    );
  }
  return instruction;
}

providerRouter.get('/', (_req, res) => {
  sendOk(res, { provider: getProviderSettings().provider });
});

providerRouter.get('/config', (_req, res) => {
  sendOk(res, getProviderSettings());
});

providerRouter.put('/config', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const apiKey = optionalApiKey(body.apiKey);
  const model = optionalModel(body.model);
  const systemInstruction = optionalInstruction(body.systemInstruction);

  sendOk(
    res,
    updateProviderSettings({
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(systemInstruction !== undefined ? { systemInstruction } : {}),
    }),
  );
});

providerRouter.delete('/key', (_req, res) => {
  sendOk(res, removeProviderKey());
});

providerRouter.post('/check', async (_req, res) => {
  sendOk(res, { provider: await checkProvider() });
});

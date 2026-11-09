import { Router } from 'express';
import type {
  ComputerDirectoryInput,
  ComputerOperationId,
  ComputerSettingsInput,
} from '@shared';
import { COMPUTER_OPERATIONS } from '../domain/computer';
import { sendOk } from '../lib/http';
import { isRecord } from '../lib/validate';
import { HttpError } from '../middleware/errors';
import {
  executeComputerOperation,
  getComputerSnapshot,
  listComputerDirectories,
  previewComputerOperation,
  updateComputerSettings,
} from '../services/computerService';
import { normalizeApprovedApplication, normalizeApprovedDirectory } from '../db/repositories/computerSettings';

function operation(value: unknown): ComputerOperationId {
  if (typeof value !== 'string' || !COMPUTER_OPERATIONS.some((entry) => entry.id === value)) {
    throw new HttpError(404, 'COMPUTER_OPERATION_NOT_FOUND', 'That computer operation is not registered.');
  }
  return value as ComputerOperationId;
}

function parseSettings(body: Record<string, unknown>): ComputerSettingsInput {
  if (typeof body.enabled !== 'boolean' || !isRecord(body.operations)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Computer settings need enabled and operations.');
  }
  const operations = {} as ComputerSettingsInput['operations'];
  for (const entry of COMPUTER_OPERATIONS) {
    const raw = body.operations[entry.id];
    if (!isRecord(raw) || typeof raw.enabled !== 'boolean' || typeof raw.requiresConfirmation !== 'boolean') {
      throw new HttpError(400, 'VALIDATION_ERROR', `Operation ${entry.id} has an invalid policy.`);
    }
    operations[entry.id] = {
      enabled: raw.enabled,
      requiresConfirmation: entry.confirmationRequired || raw.requiresConfirmation,
    };
  }

  if (!Array.isArray(body.applications) || !Array.isArray(body.directories)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'applications and directories must be arrays.');
  }
  const applications = body.applications.slice(0, 50).map((raw, index) => {
    if (!isRecord(raw) || typeof raw.path !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', `Application ${index + 1} is invalid.`);
    }
    const resolved = normalizeApprovedApplication(raw.path);
    if (!resolved) {
      throw new HttpError(400, 'COMPUTER_APPLICATION_INVALID', 'An approved application must be an existing absolute .exe path.');
    }
    return { path: resolved, ...(typeof raw.label === 'string' ? { label: raw.label } : {}) };
  });
  const directories = body.directories.slice(0, 50).map((raw, index): ComputerDirectoryInput => {
    if (!isRecord(raw) || typeof raw.path !== 'string' || typeof raw.canRead !== 'boolean' || typeof raw.canCreate !== 'boolean') {
      throw new HttpError(400, 'VALIDATION_ERROR', `Directory ${index + 1} is invalid.`);
    }
    const resolved = normalizeApprovedDirectory(raw.path);
    if (!resolved) {
      throw new HttpError(400, 'COMPUTER_DIRECTORY_INVALID', 'An approved directory must be an existing folder below a drive root.');
    }
    return { path: resolved, canRead: raw.canRead, canCreate: raw.canCreate };
  });

  return { enabled: body.enabled, operations, applications, directories };
}

export const computerRouter = Router();

computerRouter.get('/', (_req, res) => {
  sendOk(res, getComputerSnapshot());
});

computerRouter.put('/settings', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  sendOk(res, updateComputerSettings(parseSettings(body)));
});

computerRouter.get('/directories', (req, res) => {
  sendOk(res, listComputerDirectories(typeof req.query.path === 'string' ? req.query.path : undefined));
});

computerRouter.post('/operations/preview', (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const op = operation(body.operation);
  const args = isRecord(body.arguments) ? body.arguments : {};
  sendOk(res, previewComputerOperation(op, args));
});

computerRouter.post('/operations', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const op = operation(body.operation);
  const args = isRecord(body.arguments) ? body.arguments : {};
  sendOk(
    res,
    await executeComputerOperation(op, args, { confirmed: body.confirmed === true }),
  );
});

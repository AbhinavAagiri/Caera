import { Router } from 'express';
import { env } from '../config/env';
import { databaseStatus } from '../db/database';
import { sendOk } from '../lib/http';
import { buildHealth } from '../services/healthService';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  sendOk(res, await buildHealth());
});

healthRouter.get('/meta', (_req, res) => {
  const database = databaseStatus();

  sendOk(res, {
    service: env.serviceName,
    version: env.version,
    phase: env.phase,
    baseUrl: `http://${env.host}:${env.port}`,
    dataDirectory: env.dataDir,
    databaseFile: database.file,
    schemaVersion: database.schemaVersion,
  });
});

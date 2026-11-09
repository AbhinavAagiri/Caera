import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { requestLog } from './middleware/requestLog';
import { securityGate } from './middleware/security';
import { requestTimeout } from './middleware/timeout';
import { apiRouter } from './routes';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  // Runs before every route: loopback host/peer checks, origin allow-list and
  // baseline security headers. Foreign browser origins get a real 403.
  app.use(securityGate);
  app.use(requestLog);
  app.use(requestTimeout(env.limits.requestTimeoutMs));
  app.use(express.json({ limit: env.limits.jsonLimit }));

  app.use('/api', apiRouter);
  app.use('/api', notFoundHandler);

  const clientEntry = path.join(env.clientDist, 'index.html');
  if (existsSync(clientEntry)) {
    app.use(express.static(env.clientDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || path.extname(req.path)) {
        next();
        return;
      }
      res.sendFile(clientEntry);
    });
  }

  app.use(errorHandler);
  return app;
}

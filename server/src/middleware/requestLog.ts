import type { RequestHandler } from 'express';
import { logger } from '../services/logger';

function sanitizedPath(originalUrl: string): string {
  const pathname = originalUrl.split('?')[0] || '/';
  return pathname.length > 200 ? `${pathname.slice(0, 200)}…` : pathname;
}

/**
 * Logs API calls with method, sanitized path, status and duration. Query
 * strings, request bodies, headers and secrets never reach the terminal.
 */
export const requestLog: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith('/api') || req.path.startsWith('/api/events')) {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info('http', {
      method: req.method,
      path: sanitizedPath(req.originalUrl),
      status: res.statusCode,
      ms: Math.round(durationMs),
    });
  });

  next();
};

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../services/logger';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;

  constructor(status: number, code: string, message: string, hint?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

function sanitizedPath(originalUrl: string): string {
  const pathname = originalUrl.split('?')[0] || '/';
  return pathname.length > 200 ? `${pathname.slice(0, 200)}…` : pathname;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${sanitizedPath(req.originalUrl)}`,
    },
  });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return;

  if (error instanceof HttpError) {
    res.status(error.status).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      },
    });
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request body is not valid JSON.',
      },
    });
    return;
  }

  if ((error as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({
      ok: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is larger than this node accepts.',
        hint: 'Send a smaller message or attachment.',
      },
    });
    return;
  }

  logger.error('unhandled_request_error', {
    method: req.method,
    path: sanitizedPath(req.originalUrl),
    message: error instanceof Error ? error.message : String(error),
  });

  res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The local node hit an unexpected error.',
      hint: 'Check the server terminal for details.',
    },
  });
};

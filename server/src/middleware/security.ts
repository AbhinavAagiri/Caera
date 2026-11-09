import type { RequestHandler } from 'express';
import { env, normalizeHostname } from '../config/env';
import { HttpError } from './errors';

function parseHostname(header: string | undefined): string | null {
  if (!header) return null;

  try {
    return normalizeHostname(new URL(`http://${header}`).hostname);
  } catch {
    return null;
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;

  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('127.')
  );
}

/**
 * The API is only reachable from this machine. A browser request from any
 * origin other than the configured local client is rejected before routing.
 */
export const securityGate: RequestHandler = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store');
  }

  const hostname = parseHostname(req.headers.host);
  if (!hostname || !env.security.allowedHostnames.includes(hostname)) {
    next(
      new HttpError(
        403,
        'FORBIDDEN_ORIGIN',
        'This node only answers requests addressed to a loopback hostname.',
        'Open CAERA at http://127.0.0.1 or http://localhost.',
      ),
    );
    return;
  }

  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    next(
      new HttpError(
        403,
        'FORBIDDEN_ORIGIN',
        'This node only accepts connections from this machine.',
      ),
    );
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    if (!env.security.allowedOrigins.includes(origin)) {
      next(
        new HttpError(
          403,
          'FORBIDDEN_ORIGIN',
          'Requests from this origin are not allowed.',
          'Only the local CAERA client may call this node.',
        ),
      );
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
};

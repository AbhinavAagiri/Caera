import type { RequestHandler } from 'express';

/**
 * Answers with a real timeout envelope if a handler never finishes. The SSE
 * stream is intentionally excluded; it is long-lived by design.
 */
export function requestTimeout(timeoutMs: number): RequestHandler {
  return (req, res, next) => {
    const isAssistantTurn = /^\/api\/conversations\/[^/]+\/turns\/?$/.test(req.path);
    const isVoiceGeneration = /^\/api\/voice\/(?:speech|test|transcribe)\/?$/.test(req.path);
    const isKnowledgeSync = /^\/api\/knowledge\/sync\/?$/.test(req.path);
    if (req.path.startsWith('/api/events') || isAssistantTurn || isVoiceGeneration) {
      next();
      return;
    }

    const timer = setTimeout(() => {
      if (res.headersSent || res.writableEnded) return;

      res.status(503).json({
        ok: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'The local node took too long to answer.',
          hint: 'Retry the request. Nothing was sent to a provider.',
        },
      });
    }, isKnowledgeSync ? Math.max(timeoutMs, 120_000) : timeoutMs);

    timer.unref();

    const clear = (): void => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);

    next();
  };
}

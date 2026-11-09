import type { Response } from 'express';

export interface ServerSentEvent {
  type: string;
}

/**
 * Opens one POST response as a server-sent event stream. The close callback is
 * only called when the peer goes away before the route closes the stream, so a
 * client disconnect can abort the upstream generation.
 */
export function openServerSentEvents(
  res: Response,
  onClientClose: () => void,
): { send: <T extends ServerSentEvent>(event: T) => void; close: () => void } {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  const heartbeat = setInterval(() => {
    if (closed) return;
    try {
      res.write(': ping\n\n');
    } catch {
      closed = true;
    }
  }, 15_000);
  heartbeat.unref();

  res.on('close', () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    onClientClose();
  });

  return {
    send<T extends ServerSentEvent>(event: T) {
      if (closed || res.writableEnded) return;
      try {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
}

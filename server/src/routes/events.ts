import { Router } from 'express';
import { recentEvents, subscribe } from '../services/eventBus';

export const eventsRouter = Router();

/**
 * Live activity stream. The client opens one EventSource for the whole app.
 * Only real operations are published: no simulated tool calls, voice or research.
 */
eventsRouter.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  res.write('retry: 3000\n\n');
  res.write(
    `event: hello\ndata: ${JSON.stringify({
      type: 'hello',
      events: recentEvents(),
      serverTime: new Date().toISOString(),
    })}\n\n`,
  );

  const unsubscribe = subscribe((event) => {
    res.write(`event: activity\ndata: ${JSON.stringify({ type: 'event', event })}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

type Level = 'info' | 'warn' | 'error' | 'debug';

function clock(): string {
  return new Date().toISOString().slice(11, 23);
}

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  const line = `${clock()} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`;
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (process.env.CAERA_DEBUG) write('debug', message, meta);
  },
};

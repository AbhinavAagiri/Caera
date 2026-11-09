import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app';
import { recoverInterruptedAgentRuns } from './agent/runService';
import { env } from './config/env';
import { closeDatabase, databaseStatus, openDatabase } from './db/database';
import { importLegacyStore } from './db/legacyImport';
import { runMigrations } from './db/migrations';
import { publish } from './services/eventBus';
import { nodeStartedAt } from './services/healthService';
import { logger } from './services/logger';
import { primeVoiceStatus } from './services/voiceService';
import { shutdownVoiceStudio } from './services/voiceLifecycleService';

function initializeStorage(): void {
  openDatabase();
  const migrations = runMigrations();
  const legacy = importLegacyStore();
  const interruptedAgentRuns = recoverInterruptedAgentRuns();

  logger.info('database_ready', {
    schemaVersion: migrations.schemaVersion,
    migrationsApplied: migrations.applied,
    legacyReason: legacy.reason,
    legacyConversations: legacy.conversations,
    interruptedAgentRuns,
  });
}

try {
  initializeStorage();
} catch (error) {
  logger.error('database_init_failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

const app = createApp();
const server = createServer(app);

server.requestTimeout = env.limits.requestTimeoutMs + 10_000;
server.headersTimeout = env.limits.headersTimeoutMs;
server.keepAliveTimeout = env.limits.keepAliveTimeoutMs;

server.listen(env.port, env.host, () => {
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : env.port;
  const url = `http://${env.host}:${boundPort}`;
  const database = databaseStatus();

  logger.info('caera_node_ready', {
    url,
    data: env.dataDir,
    database: database.file,
    schemaVersion: database.schemaVersion,
    phase: env.phase,
  });

  // Probe VoiceStudio in the background so health never waits on a slow
  // local engine, while a running service shows up quickly.
  primeVoiceStatus();

  publish({
    kind: 'system',
    status: 'info',
    summary: 'Local node started',
    detail: url,
    meta: {
      phase: env.phase,
      startedAt: nodeStartedAt(),
      schemaVersion: database.schemaVersion,
    },
  });
});

let closing = false;

function shutdown(signal: NodeJS.Signals): void {
  if (closing) return;
  closing = true;
  logger.info('caera_node_stopping', { signal });

  // Only the child process CAERA started is stopped. A VoiceStudio instance
  // that was already running is deliberately left alone.
  shutdownVoiceStudio();

  server.close(() => {
    logger.info('caera_node_stopped');
    closeDatabase();
    process.exit(0);
  });

  setTimeout(() => {
    closeDatabase();
    process.exit(0);
  }, 3_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

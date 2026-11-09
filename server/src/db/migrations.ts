import type { DatabaseSync } from 'node:sqlite';
import { getDatabase, withTransaction } from './database';
import { logger } from '../services/logger';

export interface Migration {
  id: number;
  name: string;
  up: (database: DatabaseSync) => void;
}

export interface MigrationResult {
  applied: number;
  schemaVersion: number;
}

const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    id: 1,
    name: 'initial_local_schema',
    up: (database) => {
      database.exec(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX idx_conversations_updated_at
          ON conversations(updated_at DESC);

        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL
            REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          kind TEXT NOT NULL CHECK (kind IN ('text', 'notice')),
          content TEXT NOT NULL,
          notice_json TEXT,
          created_at TEXT NOT NULL,
          position INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX idx_messages_conversation_position
          ON messages(conversation_id, position);

        CREATE TABLE tool_permissions (
          tool_id TEXT PRIMARY KEY,
          level TEXT NOT NULL CHECK (level IN ('allow', 'ask', 'block')),
          updated_at TEXT
        ) STRICT;

        CREATE TABLE user_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE memory_entries (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL DEFAULT 'note',
          content TEXT NOT NULL,
          source_conversation_id TEXT
            REFERENCES conversations(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
        ) STRICT;

        CREATE INDEX idx_memory_entries_updated_at
          ON memory_entries(updated_at DESC);

        CREATE TABLE connected_applications (
          id TEXT PRIMARY KEY,
          connector TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('disconnected', 'connected', 'error')),
          scopes TEXT NOT NULL DEFAULT '[]',
          connected_at TEXT,
          last_used_at TEXT,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE connector_permissions (
          connector TEXT NOT NULL,
          scope TEXT NOT NULL,
          level TEXT NOT NULL CHECK (level IN ('allow', 'ask', 'block')),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (connector, scope)
        ) STRICT;

        CREATE TABLE tool_executions (
          id TEXT PRIMARY KEY,
          tool_id TEXT NOT NULL,
          conversation_id TEXT
            REFERENCES conversations(id) ON DELETE SET NULL,
          status TEXT NOT NULL
            CHECK (status IN ('pending', 'approved', 'denied', 'completed', 'failed')),
          summary TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          error_code TEXT
        ) STRICT;

        CREATE INDEX idx_tool_executions_started_at
          ON tool_executions(started_at DESC);
      `);
    },
  },
  {
    id: 2,
    name: 'approved_memory_store',
    up: (database) => {
      database.exec(`
        ALTER TABLE memory_entries ADD COLUMN subject TEXT;
        ALTER TABLE memory_entries ADD COLUMN reason TEXT;
        ALTER TABLE memory_entries ADD COLUMN source_message_id TEXT;
        ALTER TABLE memory_entries ADD COLUMN source_excerpt TEXT;
        ALTER TABLE memory_entries ADD COLUMN last_used_at TEXT;
        ALTER TABLE memory_entries ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;

        CREATE INDEX idx_memory_entries_kind
          ON memory_entries(kind);

        CREATE TABLE memory_links (
          memory_id TEXT NOT NULL
            REFERENCES memory_entries(id) ON DELETE CASCADE,
          related_id TEXT NOT NULL
            REFERENCES memory_entries(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (memory_id, related_id),
          CHECK (memory_id <> related_id)
        ) STRICT;

        CREATE INDEX idx_memory_links_related_id
          ON memory_links(related_id);

        CREATE TABLE memory_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
          updated_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO memory_settings (id, paused, updated_at)
        VALUES (1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      `);
    },
  },
  {
    id: 3,
    name: 'connector_runtime',
    up: (database) => {
      database.exec(`
        ALTER TABLE connected_applications ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE connected_applications ADD COLUMN secret_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE connected_applications ADD COLUMN last_checked_at TEXT;
        ALTER TABLE connected_applications ADD COLUMN last_error TEXT;
      `);
    },
  },
  {
    id: 4,
    name: 'agent_run_state',
    up: (database) => {
      database.exec(`
        CREATE TABLE agent_runs (
          id TEXT PRIMARY KEY,
          task TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN (
              'queued', 'running', 'awaiting_confirmation',
              'completed', 'failed', 'cancelled'
            )
          ),
          steps_json TEXT NOT NULL DEFAULT '[]',
          pending_json TEXT,
          answer TEXT,
          error_json TEXT,
          usage_json TEXT NOT NULL DEFAULT '{"toolCalls":0,"elapsedMs":0}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          finished_at TEXT
        ) STRICT;

        CREATE INDEX idx_agent_runs_created_at
          ON agent_runs(created_at DESC);
      `);
    },
  },
  {
    id: 5,
    name: 'local_computer_access',
    up: (database) => {
      database.exec(`
        CREATE TABLE computer_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          settings_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO computer_settings (id, settings_json, updated_at)
        VALUES (1, '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      `);
    },
  },
  {
    id: 7,
    name: 'ai_usage_and_routing_history',
    up: (database) => {
      database.exec(`
        CREATE TABLE ai_usage (
          id TEXT PRIMARY KEY,
          conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          task_category TEXT NOT NULL,
          complexity INTEGER NOT NULL CHECK (complexity BETWEEN 1 AND 5),
          routing_method TEXT NOT NULL
            CHECK (routing_method IN ('manual', 'automatic', 'fallback')),
          input_tokens INTEGER,
          output_tokens INTEGER,
          cached_tokens INTEGER,
          estimated_cost_usd REAL,
          pricing_source_url TEXT,
          duration_ms INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'stopped')),
          error_code TEXT,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX idx_ai_usage_created_at
          ON ai_usage(created_at DESC);
        CREATE INDEX idx_ai_usage_provider_model
          ON ai_usage(provider, model, created_at DESC);
      `);
    },
  },
  {
    id: 6,
    name: 'knowledge_index',
    up: (database) => {
      database.exec(`
        CREATE TABLE knowledge_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
          settings_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO knowledge_settings (id, enabled, settings_json, updated_at)
        VALUES (1, 0, '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

        CREATE TABLE knowledge_documents (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_label TEXT NOT NULL,
          document_id TEXT NOT NULL,
          title TEXT NOT NULL,
          path TEXT NOT NULL,
          url TEXT,
          category TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          source_updated_at TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          indexed_at TEXT NOT NULL,
          UNIQUE (source, document_id)
        ) STRICT;

        CREATE INDEX idx_knowledge_documents_source
          ON knowledge_documents(source);
        CREATE INDEX idx_knowledge_documents_updated_at
          ON knowledge_documents(source_updated_at DESC);

        CREATE TABLE knowledge_document_tags (
          document_id TEXT NOT NULL
            REFERENCES knowledge_documents(id) ON DELETE CASCADE,
          tag TEXT NOT NULL,
          PRIMARY KEY (document_id, tag)
        ) STRICT;

        CREATE INDEX idx_knowledge_document_tags_tag
          ON knowledge_document_tags(tag);

        CREATE TABLE knowledge_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id TEXT NOT NULL
            REFERENCES knowledge_documents(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          UNIQUE (document_id, chunk_index)
        ) STRICT;

        CREATE INDEX idx_knowledge_chunks_document_id
          ON knowledge_chunks(document_id);

        CREATE VIRTUAL TABLE knowledge_fts USING fts5(
          title,
          tags,
          content,
          tokenize = 'unicode61 remove_diacritics 2'
        );

        CREATE TABLE knowledge_sync_state (
          source TEXT PRIMARY KEY,
          last_attempt_at TEXT,
          last_success_at TEXT,
          last_error TEXT,
          documents_seen INTEGER NOT NULL DEFAULT 0,
          documents_indexed INTEGER NOT NULL DEFAULT 0,
          documents_skipped INTEGER NOT NULL DEFAULT 0,
          documents_failed INTEGER NOT NULL DEFAULT 0,
          truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
          updated_at TEXT NOT NULL
        ) STRICT;

        -- Reserved for a future local embedding pass. Keyword indexing does not
        -- populate this table; chunks are stable ids for future vectors.
        CREATE TABLE knowledge_embeddings (
          chunk_id INTEGER PRIMARY KEY
            REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
          model TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          vector BLOB NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
];

function toInteger(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return fallback;
}

export function currentSchemaVersion(): number {
  try {
    const row = getDatabase()
      .prepare('SELECT COALESCE(MAX(id), 0) AS version FROM schema_migrations')
      .get();
    return toInteger(row?.version);
  } catch {
    return 0;
  }
}

export function runMigrations(): MigrationResult {
  const database = getDatabase();

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedRows = database.prepare('SELECT id FROM schema_migrations').all();
  const applied = new Set(appliedRows.map((row) => toInteger(row.id)));

  let count = 0;
  for (const migration of [...MIGRATIONS].sort((left, right) => left.id - right.id)) {
    if (applied.has(migration.id)) continue;

    withTransaction(() => {
      migration.up(database);
      database
        .prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString());
    });

    count += 1;
    logger.info('database_migration_applied', {
      id: migration.id,
      name: migration.name,
    });
  }

  return { applied: count, schemaVersion: currentSchemaVersion() };
}

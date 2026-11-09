import 'dotenv/config';
import { closeDatabase, databaseStatus, openDatabase } from './database';
import { importLegacyStore } from './legacyImport';
import { runMigrations } from './migrations';

let exitCode = 0;

try {
  openDatabase();
  const migrations = runMigrations();
  const legacy = importLegacyStore();
  const database = databaseStatus();

  console.log(
    JSON.stringify(
      {
        ok: true,
        migrations,
        legacy,
        database,
      },
      null,
      2,
    ),
  );
} catch (error) {
  exitCode = 1;
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
} finally {
  closeDatabase();
}

process.exitCode = exitCode;

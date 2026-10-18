import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import log from 'electron-log/main';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export let db: Db;
let raw: Database.Database;

function migrationsFolder() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'migrations')
    : path.join(app.getAppPath(), 'resources', 'migrations');
}

function pendingMigrations(folder: string) {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  const hasTable = raw
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get();
  const applied = hasTable ? (raw.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n : 0;
  return journal.entries.length - applied;
}

export function openDb(file = path.join(app.getPath('userData'), 'app.db')) {
  const existed = fs.existsSync(file);
  raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  db = drizzle(raw, { schema });

  const folder = migrationsFolder();
  const pending = pendingMigrations(folder);
  if (pending > 0) {
    if (existed) {
      // Sao lưu trước mỗi lần migrate; VACUUM INTO cho bản sao nhất quán kể cả khi đang WAL.
      const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      raw.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      log.info(`[db] đã sao lưu ${backup}`);
    }
    migrate(db, { migrationsFolder: folder });
    log.info(`[db] đã chạy ${pending} migration`);
  }
  return db;
}

export function closeDb() {
  raw?.close();
}

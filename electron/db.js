import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const { app } = typeof electron === 'object' && electron ? electron : { app: null };

export const JOB_STATUSES = [
  'waiting',
  'fetching_metadata',
  'downloading',
  'pausing',
  'paused',
  'resuming',
  'processing',
  'completed',
  'failed',
  'cancelled'
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  provider TEXT,
  kind TEXT,
  title TEXT,
  format TEXT,
  dest_dir TEXT,
  expected_id TEXT,
  status TEXT NOT NULL,
  progress REAL DEFAULT 0,
  bytes_done INTEGER DEFAULT 0,
  bytes_total INTEGER,
  speed REAL,
  error TEXT,
  result_path TEXT,
  collection_id TEXT,
  extra TEXT,
  partial_path TEXT,
  etag TEXT,
  last_modified TEXT,
  resumable INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
`;

/** Pure migration; usable from tests with an in-memory DB. */
export function migrate(db) {
  db.exec(SCHEMA);
  // Add columns to existing databases safely without dropping tables
  const cols = new Set(db.prepare(`PRAGMA table_info(jobs)`).all().map((c) => c.name));
  if (!cols.has('partial_path')) db.exec(`ALTER TABLE jobs ADD COLUMN partial_path TEXT;`);
  if (!cols.has('etag')) db.exec(`ALTER TABLE jobs ADD COLUMN etag TEXT;`);
  if (!cols.has('last_modified')) db.exec(`ALTER TABLE jobs ADD COLUMN last_modified TEXT;`);
  if (!cols.has('resumable')) db.exec(`ALTER TABLE jobs ADD COLUMN resumable INTEGER DEFAULT 0;`);
  return db;
}

let db = null;

export function initDb() {
  if (db) return db;
  if (!app) throw new Error('DB requires the Electron runtime');
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, 'mediavault.db'));
  return migrate(db);
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

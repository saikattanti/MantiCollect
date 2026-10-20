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

export const CONVERSION_STATUSES = [
  'waiting',
  'converting',
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
  is_segmented INTEGER DEFAULT 0,
  segments_count INTEGER DEFAULT 0,
  segments_done INTEGER DEFAULT 0,
  segment_plan TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  color TEXT DEFAULT '#3b82f6',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL,
  item_path TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (collection_id, item_path)
);
CREATE INDEX IF NOT EXISTS idx_col_items_id ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_col ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_path ON collection_items(item_path);

CREATE TABLE IF NOT EXISTS media_metadata (
  file_path TEXT PRIMARY KEY,
  file_size INTEGER NOT NULL,
  file_mtime INTEGER NOT NULL,
  duration REAL,
  width INTEGER,
  height INTEGER,
  video_codec TEXT,
  audio_codec TEXT,
  format_name TEXT,
  bitrate INTEGER,
  channels INTEGER,
  sample_rate INTEGER,
  probed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_meta_mtime ON media_metadata(file_mtime);

CREATE TABLE IF NOT EXISTS conversions (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  dest_path TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conversions_status ON conversions(status);

CREATE TABLE IF NOT EXISTS storage_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  base_path TEXT,
  username TEXT,
  credential_ref TEXT,
  host_key_fingerprint TEXT,
  allow_insecure_http INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_success_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_storage_conns_type ON storage_connections(provider_type);

CREATE TABLE IF NOT EXISTS storage_uploads (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES storage_connections(id) ON DELETE CASCADE,
  remote_path TEXT NOT NULL,
  status TEXT NOT NULL,
  bytes_done INTEGER DEFAULT 0,
  bytes_total INTEGER,
  speed REAL DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_storage_uploads_status ON storage_uploads(status);
CREATE INDEX IF NOT EXISTS idx_storage_uploads_conn ON storage_uploads(connection_id);
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
  if (!cols.has('is_segmented')) db.exec(`ALTER TABLE jobs ADD COLUMN is_segmented INTEGER DEFAULT 0;`);
  if (!cols.has('segments_count')) db.exec(`ALTER TABLE jobs ADD COLUMN segments_count INTEGER DEFAULT 0;`);
  if (!cols.has('segments_done')) db.exec(`ALTER TABLE jobs ADD COLUMN segments_done INTEGER DEFAULT 0;`);
  if (!cols.has('segment_plan')) db.exec(`ALTER TABLE jobs ADD COLUMN segment_plan TEXT;`);
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

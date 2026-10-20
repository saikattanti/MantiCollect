import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate, JOB_STATUSES } from '../electron/db.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('migrate creates schema with all job statuses usable', () => {
  const db = migrate(new Database(':memory:'));
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'`).all();
  assert.equal(tables.length, 1);
  const info = db.prepare(`PRAGMA table_info(jobs)`).all();
  const cols = info.map((c) => c.name);
  for (const c of ['id', 'url', 'provider', 'status', 'progress', 'bytes_done', 'bytes_total', 'speed', 'error', 'result_path', 'collection_id', 'extra', 'created_at', 'started_at', 'finished_at']) {
    assert.ok(cols.includes(c), `missing column ${c}`);
  }
  for (const s of JOB_STATUSES) {
    db.prepare(`INSERT INTO jobs (id, url, status, created_at) VALUES (?, 'https://x.test/', ?, 1)`).run(`j-${s}`, s);
  }
  const statuses = db.prepare('SELECT DISTINCT status FROM jobs').all().map((r) => r.status);
  assert.deepEqual([...JOB_STATUSES].sort(), [...statuses].sort());
});

test('queue-like lifecycle: insert waiting -> download -> complete', () => {
  const db = migrate(new Database(':memory:'));
  const id = 'job-1';
  db.prepare(`INSERT INTO jobs (id, url, status, created_at) VALUES (?, 'https://x.test/v', 'waiting', 1)`).run(id);
  db.prepare(`UPDATE jobs SET status='downloading', started_at=2 WHERE id=?`).run(id);
  db.prepare(`UPDATE jobs SET status='downloading', progress=0.42, bytes_done=420, bytes_total=1000 WHERE id=?`).run(id);
  db.prepare(`UPDATE jobs SET status='completed', progress=1, result_path='/tmp/out.mp4', finished_at=3 WHERE id=?`).run(id);
  const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  assert.equal(row.status, 'completed');
  assert.equal(row.progress, 1);
  assert.equal(row.result_path, '/tmp/out.mp4');
});

test('recover: interrupted active jobs return to waiting', () => {
  const db = migrate(new Database(':memory:'));
  db.prepare(`INSERT INTO jobs (id, url, status, created_at) VALUES ('a', 'u', 'downloading', 1)`).run();
  db.prepare(`INSERT INTO jobs (id, url, status, created_at) VALUES ('b', 'u', 'processing', 1)`).run();
  db.prepare(`INSERT INTO jobs (id, url, status, created_at) VALUES ('c', 'u', 'completed', 1)`).run();
  db.prepare(`INSERT INTO jobs (id, url, status, created_at) VALUES ('d', 'u', 'failed', 1)`).run();
  const r = db.prepare(`UPDATE jobs SET status='waiting', error=NULL WHERE status IN ('fetching_metadata','downloading','processing')`).run();
  assert.equal(r.changes, 2);
  const byId = Object.fromEntries(db.prepare('SELECT id, status FROM jobs').all().map((x) => [x.id, x.status]));
  assert.equal(byId.a, 'waiting');
  assert.equal(byId.b, 'waiting');
  assert.equal(byId.c, 'completed'); // untouched
  assert.equal(byId.d, 'failed'); // untouched
});

test('WAL persistence: reopen file DB keeps rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvdb-'));
  const file = path.join(dir, 'test.db');
  {
    const db = migrate(new Database(file));
    db.prepare(`INSERT INTO jobs (id, url, status, created_at) VALUES ('keep', 'u', 'completed', 1)`).run();
    db.close();
  }
  {
    const db = migrate(new Database(file));
    const row = db.prepare('SELECT * FROM jobs WHERE id=?').get('keep');
    assert.ok(row);
    assert.equal(row.status, 'completed');
    db.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

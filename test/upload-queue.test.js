import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUploadQueue } from '../electron/uploadQueue.js';
import { createStorageConnectionManager } from '../electron/storageConnections.js';
import { createCredentialService, createSoftwareCipherBackend } from '../electron/credentials.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storage_connections (
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

    CREATE TABLE storage_uploads (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      remote_path TEXT,
      status TEXT NOT NULL,
      bytes_done INTEGER DEFAULT 0,
      bytes_total INTEGER DEFAULT 0,
      speed INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
    );
  `);
  return db;
}

test('upload queue: enqueuing validates source file and connection', async () => {
  const db = createTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uq-val-'));
  const creds = createCredentialService({
    storageBackend: createSoftwareCipherBackend(),
    getStorageDir: () => tmpDir
  });
  const connMgr = createStorageConnectionManager({
    getDbInstance: () => db,
    credentialService: creds
  });

  const nasConn = await connMgr.createConnection({
    name: 'Target NAS',
    provider_type: 'local_nas',
    base_path: tmpDir
  });

  const queue = createUploadQueue({
    getDbInstance: () => db,
    getConnectionManager: () => connMgr
  });

  // Non-existent source file rejected
  await assert.rejects(
    async () => queue.enqueueUpload({
      sourcePath: path.join(tmpDir, 'does-not-exist.mp4'),
      connectionId: nasConn.id
    }),
    /Source file does not exist/
  );

  // Non-existent connection ID rejected
  const realFile = path.join(tmpDir, 'real.txt');
  fs.writeFileSync(realFile, 'hello');
  await assert.rejects(
    async () => queue.enqueueUpload({
      sourcePath: realFile,
      connectionId: 'missing-conn-uuid'
    }),
    /Storage connection not found/
  );

  queue.shutdown();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('upload queue: execution lifecycle and no plaintext secrets in records', async () => {
  const db = createTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uq-run-'));
  const creds = createCredentialService({
    storageBackend: createSoftwareCipherBackend(),
    getStorageDir: () => tmpDir
  });
  const connMgr = createStorageConnectionManager({
    getDbInstance: () => db,
    credentialService: creds
  });

  const nasDestDir = path.join(tmpDir, 'dest_nas');
  fs.mkdirSync(nasDestDir, { recursive: true });

  const conn = await connMgr.createConnection({
    name: 'Local NAS Transfer',
    provider_type: 'local_nas',
    base_path: nasDestDir,
    secret: 'DoNotLeakThisPassword'
  });

  const testFile = path.join(tmpDir, 'sample_clip.mp4');
  const content = Buffer.alloc(16 * 1024, 0x33); // 16 KB
  fs.writeFileSync(testFile, content);

  const windowEvents = [];
  const queue = createUploadQueue({
    getDbInstance: () => db,
    getConnectionManager: () => connMgr,
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (ch, data) => windowEvents.push({ ch, data })
      }
    })
  });

  const task = await queue.enqueueUpload({
    sourcePath: testFile,
    connectionId: conn.id,
    remotePath: 'uploads/2026'
  });

  assert.ok(task.id);
  assert.equal(task.status, 'waiting');
  assert.equal(task.bytes_total, 16 * 1024);

  // Poll briefly for completion
  let finishedTask = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const curr = queue.getUpload(task.id);
    if (curr.status === 'completed' || curr.status === 'failed') {
      finishedTask = curr;
      break;
    }
  }

  assert.ok(finishedTask, 'Upload should finish within 2 seconds');
  assert.equal(finishedTask.status, 'completed');
  assert.equal(finishedTask.bytes_done, 16 * 1024);

  // Verify file landed in destination
  const destFile = path.join(nasDestDir, 'uploads', '2026', 'sample_clip.mp4');
  assert.ok(fs.existsSync(destFile), `File must exist at ${destFile}`);

  // CRITICAL REQUIREMENT: verify that upload record NEVER contains plaintext credentials or secrets
  const rawDbUpload = db.prepare('SELECT * FROM storage_uploads WHERE id = ?').get(task.id);
  assert.equal(JSON.stringify(rawDbUpload).includes('DoNotLeakThisPassword'), false, 'Upload record must NEVER contain secret material');

  queue.shutdown();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('upload queue: startup recovery safely marks interrupted tasks as failed', () => {
  const db = createTestDb();

  // Insert simulated tasks that were interrupted by application shutdown/crash
  const now = Date.now();
  db.prepare(`
    INSERT INTO storage_uploads (id, source_path, connection_id, remote_path, status, bytes_done, bytes_total, created_at, updated_at)
    VALUES ('task_interrupted_1', 'video.mp4', 'c1', '', 'uploading', 500, 1000, ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO storage_uploads (id, source_path, connection_id, remote_path, status, bytes_done, bytes_total, created_at, updated_at)
    VALUES ('task_interrupted_2', 'audio.mp3', 'c1', '', 'connecting', 0, 500, ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO storage_uploads (id, source_path, connection_id, remote_path, status, bytes_done, bytes_total, created_at, updated_at)
    VALUES ('task_already_done', 'image.png', 'c1', '', 'completed', 200, 200, ?, ?)
  `).run(now, now);

  const queue = createUploadQueue({
    getDbInstance: () => db
  });

  // Calling recover (already called on createUploadQueue initialization)
  queue.recover();

  const t1 = queue.getUpload('task_interrupted_1');
  assert.equal(t1.status, 'failed');
  assert.ok(/Interrupted by application restart/i.test(t1.error_message));

  const t2 = queue.getUpload('task_interrupted_2');
  assert.equal(t2.status, 'failed');
  assert.ok(/Interrupted by application restart/i.test(t2.error_message));

  // Already completed task is NOT mutated
  const t3 = queue.getUpload('task_already_done');
  assert.equal(t3.status, 'completed');

  queue.shutdown();
  db.close();
});

test('upload queue: cancellation of waiting task', async () => {
  const db = createTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uq-cancel-'));
  const testFile = path.join(tmpDir, 'test.txt');
  fs.writeFileSync(testFile, 'data');

  const now = Date.now();
  db.prepare(`
    INSERT INTO storage_uploads (id, source_path, connection_id, remote_path, status, bytes_done, bytes_total, created_at, updated_at)
    VALUES ('task_waiting_cancel', ?, 'c1', '', 'waiting', 0, 4, ?, ?)
  `).run(testFile, now, now);

  const queue = createUploadQueue({
    getDbInstance: () => db
  });

  const cancelled = queue.cancelUpload('task_waiting_cancel');
  assert.equal(cancelled, true);

  const task = queue.getUpload('task_waiting_cancel');
  assert.equal(task.status, 'cancelled');

  // Clear completed/cancelled
  queue.clearCompleted();
  assert.equal(queue.getUpload('task_waiting_cancel'), null);

  queue.shutdown();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

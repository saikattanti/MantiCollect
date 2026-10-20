import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createBackupScheduler,
  calculateNextRunTime
} from '../electron/backupScheduler.js';
import { migrate } from '../electron/db.js';

function createTestContext() {
  const db = new Database(':memory:');
  migrate(db);

  // Seed storage connection
  db.prepare(`
    INSERT INTO storage_connections (
      id, name, provider_type, host, port, base_path, username,
      credential_ref, allow_insecure_http, created_at, updated_at
    ) VALUES ('conn_test_1', 'Test S3 Vault', 's3', 'https://s3.example.com', null, 'vault-bucket', 'user', null, 0, 1000, 1000)
  `).run();

  const mockConnMgr = {
    getConnection: async (id) => db.prepare('SELECT * FROM storage_connections WHERE id = ?').get(id) || null,
    getInternalConnection: async (id) => db.prepare('SELECT * FROM storage_connections WHERE id = ?').get(id) || null,
    recordSuccess: () => {}
  };

  const uploadMap = new Map();
  const mockUploadQueue = {
    enqueueUpload: async ({ sourcePath, connectionId, remotePath }) => {
      const id = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const task = {
        id,
        source_path: sourcePath,
        connection_id: connectionId,
        remote_path: remotePath,
        status: 'completed',
        bytes_done: fs.existsSync(sourcePath) ? fs.statSync(sourcePath).size : 1000
      };
      uploadMap.set(id, task);
      return task;
    },
    getUpload: (id) => uploadMap.get(id) || null,
    listUploads: () => Array.from(uploadMap.values())
  };

  return {
    db,
    mockConnMgr,
    mockUploadQueue,
    uploadMap
  };
}

test('scheduler: recurrence calculation rules', () => {
  const baseTime = new Date('2026-10-21T10:00:00.000Z').getTime();

  // 1. Interval: 30 minutes
  const intervalRun = calculateNextRunTime({
    recurrence_type: 'interval',
    interval_minutes: 30,
    fromTime: baseTime
  });
  assert.equal(intervalRun, baseTime + 30 * 60 * 1000);

  // 2. Interval: minimum bounded to 5 minutes
  const minInterval = calculateNextRunTime({
    recurrence_type: 'interval',
    interval_minutes: 1, // too small
    fromTime: baseTime
  });
  assert.equal(minInterval, baseTime + 5 * 60 * 1000);

  // 3. Daily: run at next occurrence
  const dailyRun = calculateNextRunTime({
    recurrence_type: 'daily',
    run_at_time: '14:00',
    fromTime: baseTime
  });
  assert.ok(dailyRun > baseTime);

  // 4. Weekly: run on days
  const weeklyRun = calculateNextRunTime({
    recurrence_type: 'weekly',
    run_at_time: '04:00',
    run_on_days: [1, 5], // Monday, Friday
    fromTime: baseTime
  });
  assert.ok(weeklyRun > baseTime);
});

test('scheduler: create, list, and toggle schedule', async () => {
  const ctx = createTestContext();
  const scheduler = createBackupScheduler({
    getDbInstance: () => ctx.db,
    getConnectionManager: () => ctx.mockConnMgr,
    getUploadQueueInstance: () => ctx.mockUploadQueue
  });

  const saved = await scheduler.saveSchedule({
    name: 'Nightly Media Backup',
    enabled: true,
    source_type: 'entire_library',
    connection_id: 'conn_test_1',
    remote_prefix: 'nightly',
    recurrence_type: 'daily',
    run_at_time: '03:00'
  });

  assert.ok(saved.id);
  assert.equal(saved.name, 'Nightly Media Backup');
  assert.equal(saved.enabled, true);
  assert.ok(saved.next_run_at > Date.now());

  const list = scheduler.listSchedules();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, saved.id);

  // Toggle disable
  const disabled = scheduler.toggleSchedule(saved.id, false);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.next_run_at, null);

  // Toggle re-enable
  const reenabled = scheduler.toggleSchedule(saved.id, true);
  assert.equal(reenabled.enabled, true);
  assert.ok(reenabled.next_run_at > Date.now());

  scheduler.shutdown();
});

test('scheduler: executes backup and updates run history with per-item outcomes', async () => {
  const ctx = createTestContext();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-run-test-'));
  const file1 = path.join(tmpDir, 'photo1.jpg');
  const file2 = path.join(tmpDir, 'video1.mp4');
  fs.writeFileSync(file1, 'photo-content-bytes');
  fs.writeFileSync(file2, 'video-content-bytes-1234');

  // Insert media metadata into DB
  ctx.db.prepare(`
    INSERT INTO media_metadata (file_path, file_size, file_mtime, probed_at)
    VALUES (?, ?, ?, ?)
  `).run(file1, fs.statSync(file1).size, Date.now(), Date.now());
  ctx.db.prepare(`
    INSERT INTO media_metadata (file_path, file_size, file_mtime, probed_at)
    VALUES (?, ?, ?, ?)
  `).run(file2, fs.statSync(file2).size, Date.now(), Date.now());

  const scheduler = createBackupScheduler({
    getDbInstance: () => ctx.db,
    getConnectionManager: () => ctx.mockConnMgr,
    getUploadQueueInstance: () => ctx.mockUploadQueue
  });

  const sched = await scheduler.saveSchedule({
    name: 'Full Library Backup',
    enabled: true,
    source_type: 'entire_library',
    connection_id: 'conn_test_1',
    remote_prefix: 'cloud_sync',
    recurrence_type: 'daily'
  });

  // Run manually now
  await scheduler.executeSchedule(sched.id, true);

  const runs = scheduler.listRuns();
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.equal(run.status, 'completed');
  assert.equal(run.total_items, 2);
  assert.equal(run.success_items, 2);
  assert.equal(run.failed_items, 0);
  assert.ok(run.bytes_transferred > 0);

  const details = scheduler.getRunDetails(run.id);
  assert.equal(details.items.length, 2);
  assert.equal(details.items.every((i) => i.status === 'success'), true);

  scheduler.shutdown();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scheduler: deduplication policy skip prevents duplicate upload of unchanged files', async () => {
  const ctx = createTestContext();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-dedup-test-'));
  const file1 = path.join(tmpDir, 'same_file.mp4');
  fs.writeFileSync(file1, 'unchanged-data');

  ctx.db.prepare(`
    INSERT INTO media_metadata (file_path, file_size, file_mtime, probed_at)
    VALUES (?, ?, ?, ?)
  `).run(file1, fs.statSync(file1).size, Date.now(), Date.now());

  const scheduler = createBackupScheduler({
    getDbInstance: () => ctx.db,
    getConnectionManager: () => ctx.mockConnMgr,
    getUploadQueueInstance: () => ctx.mockUploadQueue
  });

  const sched = await scheduler.saveSchedule({
    name: 'Skip Unchanged Schedule',
    enabled: true,
    source_type: 'entire_library',
    connection_id: 'conn_test_1',
    existing_file_policy: 'skip',
    recurrence_type: 'interval',
    interval_minutes: 60
  });

  // First run: uploads file1
  await scheduler.executeSchedule(sched.id, true);
  const firstRuns = scheduler.listRuns();
  assert.equal(firstRuns[0].success_items, 1);
  assert.equal(firstRuns[0].skipped_items, 0);

  // Second run: file1 is identical, must be skipped
  await scheduler.executeSchedule(sched.id, true);
  const secondRuns = scheduler.listRuns();
  assert.equal(secondRuns[0].success_items, 0);
  assert.equal(secondRuns[0].skipped_items, 1);

  scheduler.shutdown();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scheduler: newly completed downloads uses cutoff timestamp and does not re-upload entire library', async () => {
  const ctx = createTestContext();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-cutoff-test-'));

  const oldFile = path.join(tmpDir, 'old_download.mp4');
  const newFile = path.join(tmpDir, 'new_download.mp4');
  fs.writeFileSync(oldFile, 'old-download');
  fs.writeFileSync(newFile, 'new-download');

  const now = Date.now();
  // Job 1 finished before schedule creation (10 seconds ago)
  ctx.db.prepare(`
    INSERT INTO jobs (id, url, status, result_path, bytes_total, created_at, finished_at)
    VALUES ('job_old', 'https://example.com/old', 'completed', ?, 12, ?, ?)
  `).run(oldFile, now - 20000, now - 10000);

  const scheduler = createBackupScheduler({
    getDbInstance: () => ctx.db,
    getConnectionManager: () => ctx.mockConnMgr,
    getUploadQueueInstance: () => ctx.mockUploadQueue
  });

  // Schedule created at `now`
  const sched = await scheduler.saveSchedule({
    name: 'New Downloads Sync',
    enabled: true,
    source_type: 'new_downloads',
    connection_id: 'conn_test_1',
    recurrence_type: 'interval',
    interval_minutes: 10
  });

  // Job 2 finished after schedule creation (right now)
  ctx.db.prepare(`
    INSERT INTO jobs (id, url, status, result_path, bytes_total, created_at, finished_at)
    VALUES ('job_new', 'https://example.com/new', 'completed', ?, 12, ?, ?)
  `).run(newFile, now, now + 1000);

  await scheduler.executeSchedule(sched.id, true);

  const runs = scheduler.listRuns();
  assert.equal(runs.length, 1);
  // Only the new download should be included!
  assert.equal(runs[0].total_items, 1);
  assert.equal(runs[0].success_items, 1);

  const details = scheduler.getRunDetails(runs[0].id);
  assert.equal(details.items[0].source_path, newFile);

  scheduler.shutdown();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scheduler: partial success represented honestly if any item fails', async () => {
  const ctx = createTestContext();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-partial-test-'));
  const goodFile = path.join(tmpDir, 'good.mp4');
  const badFile = path.join(tmpDir, 'bad.mp4');
  fs.writeFileSync(goodFile, 'good-content');
  fs.writeFileSync(badFile, 'bad-content');

  ctx.db.prepare(`
    INSERT INTO media_metadata (file_path, file_size, file_mtime, probed_at)
    VALUES (?, 100, 1000, 1000)
  `).run(goodFile);
  ctx.db.prepare(`
    INSERT INTO media_metadata (file_path, file_size, file_mtime, probed_at)
    VALUES (?, 200, 1000, 1000)
  `).run(badFile);

  // Upload queue mock where badFile fails
  const mockFailingQueue = {
    enqueueUpload: async ({ sourcePath }) => {
      const id = `upload_${Date.now()}`;
      const isBad = sourcePath.includes('bad');
      const task = {
        id,
        source_path: sourcePath,
        status: isBad ? 'failed' : 'completed',
        error_message: isBad ? 'Network timeout to remote endpoint' : null,
        bytes_done: isBad ? 0 : 100
      };
      ctx.uploadMap.set(id, task);
      return task;
    },
    getUpload: (id) => ctx.uploadMap.get(id) || null
  };

  const scheduler = createBackupScheduler({
    getDbInstance: () => ctx.db,
    getConnectionManager: () => ctx.mockConnMgr,
    getUploadQueueInstance: () => mockFailingQueue
  });

  const sched = await scheduler.saveSchedule({
    name: 'Partial Success Test',
    enabled: true,
    source_type: 'entire_library',
    connection_id: 'conn_test_1',
    recurrence_type: 'daily'
  });

  await scheduler.executeSchedule(sched.id, true);

  const runs = scheduler.listRuns();
  assert.equal(runs.length, 1);
  // Status MUST be 'partial', never 'completed'!
  assert.equal(runs[0].status, 'partial');
  assert.equal(runs[0].success_items, 1);
  assert.equal(runs[0].failed_items, 1);
  assert.ok(runs[0].error_summary.includes('Network timeout'));

  scheduler.shutdown();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scheduler: startup recovery reconciles interrupted runs cleanly', () => {
  const ctx = createTestContext();
  // Insert parent schedule
  ctx.db.prepare(`
    INSERT INTO backup_schedules (
      id, name, enabled, source_type, connection_id, recurrence_type, created_at, updated_at
    ) VALUES ('sched_dummy', 'Dummy', 1, 'entire_library', 'conn_test_1', 'daily', 1000, 1000)
  `).run();

  // Insert interrupted run
  ctx.db.prepare(`
    INSERT INTO backup_runs (
      id, schedule_id, connection_id, started_at, status, total_items,
      success_items, failed_items, skipped_items, bytes_transferred, created_at
    ) VALUES ('run_interrupted', 'sched_dummy', 'conn_test_1', 1000, 'running', 5, 2, 0, 0, 200, 1000)
  `).run();

  const scheduler = createBackupScheduler({
    getDbInstance: () => ctx.db,
    getConnectionManager: () => ctx.mockConnMgr,
    getUploadQueueInstance: () => ctx.mockUploadQueue
  });

  const run = ctx.db.prepare('SELECT * FROM backup_runs WHERE id = ?').get('run_interrupted');
  assert.equal(run.status, 'failed');
  assert.match(run.error_summary, /Interrupted by application restart/i);

  scheduler.shutdown();
});

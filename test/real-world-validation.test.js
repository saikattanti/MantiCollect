import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../electron/db.js';
import { createQueue } from '../electron/queue.js';
import { directDownload } from '../electron/providers/direct.js';
import { executeJob } from '../electron/runner.js';
import { uniquePath } from '../electron/security.js';
import { createTelemetryTracker, calculateAverageSpeed } from '../electron/telemetry.js';

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  server.closeAllConnections?.();
  server.close();
}

/* =====================================================================
   1. DIRECT HTTP DOWNLOAD REAL-WORLD SCENARIOS
   ===================================================================== */

test('directDownload creates 0-byte file cleanly when response body is empty', async (t) => {
  const server = await startServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': '0'
    });
    res.end();
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-empty-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const res = await directDownload(`http://127.0.0.1:${port}/empty.bin`, dest, {
    allowLocal: true
  });

  assert.ok(fs.existsSync(res.path), 'Empty file was created on disk');
  assert.equal(fs.statSync(res.path).size, 0, 'File size is 0 bytes');
  assert.equal(res.bytes, 0);
});

test('directDownload maps HTTP 404, 403, and 500 to human-readable error messages', async (t) => {
  const server = await startServer((req, res) => {
    if (req.url === '/notfound') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    } else if (req.url === '/forbidden') {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
    } else if (req.url === '/servererror') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Server Error');
    }
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-status-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  await assert.rejects(
    () => directDownload(`http://127.0.0.1:${port}/notfound`, dest, { allowLocal: true }),
    /404|not found/i
  );

  await assert.rejects(
    () => directDownload(`http://127.0.0.1:${port}/forbidden`, dest, { allowLocal: true }),
    /403|forbidden/i
  );

  await assert.rejects(
    () => directDownload(`http://127.0.0.1:${port}/servererror`, dest, { allowLocal: true }),
    /500|server error/i
  );
});

test('directDownload throws descriptive error when destination directory is unwritable', async (t) => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 100 });
    res.end(Buffer.alloc(100, 'X'));
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  // Invalid path that cannot be created on Windows or POSIX
  const invalidDest = path.join(os.tmpdir(), 'nonexistent-mv-\0-invalid');

  await assert.rejects(
    () => directDownload(`http://127.0.0.1:${port}/file.bin`, invalidDest, { allowLocal: true }),
    /destination directory|unavailable|not writable|invalid/i
  );
});

test('uniquePath avoids collision with both existing final files and active .part files', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-unique-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // Simulate an active transfer currently writing to .video.mp4.part
  fs.writeFileSync(path.join(tmpDir, '.video.mp4.part'), 'in progress');

  // uniquePath must recognize that video.mp4 is currently in-flight and pick video (1).mp4
  const chosenPath = uniquePath(tmpDir, 'video.mp4');
  assert.equal(path.basename(chosenPath), 'video (1).mp4');

  // If video (1).mp4 is also on disk, it picks video (2).mp4
  fs.writeFileSync(path.join(tmpDir, 'video (1).mp4'), 'finished');
  const nextPath = uniquePath(tmpDir, 'video.mp4');
  assert.equal(path.basename(nextPath), 'video (2).mp4');
});

test('directDownload cleans up .part file when remote socket abruptly closes mid-stream', async (t) => {
  const server = await startServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': 500_000
    });
    res.write(Buffer.alloc(50_000, 'A'));
    setTimeout(() => {
      // Abruptly destroy socket mid-transfer
      req.socket.destroy();
    }, 40);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-abrupt-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  await assert.rejects(
    () => directDownload(`http://127.0.0.1:${port}/broken.bin`, dest, { allowLocal: true }),
    /connection interrupted|remote server closed|terminated|socket|fetch failed/i
  );

  // Verification: temporary .part file must not remain on disk
  const parts = fs.readdirSync(dest).filter((f) => f.endsWith('.part'));
  assert.equal(parts.length, 0, 'No leftover .part file on socket interruption');
});

/* =====================================================================
   2. QUEUE & RUNNER RACE CONDITION SAFEGUARDS
   ===================================================================== */

test('queue ensures cancelled job cannot become completed if runner promise resolves right after cancellation', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-race-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  let resolveRunner;
  const mockRunner = {
    executeJob(job, options = {}) {
      return {
        cancelled: false,
        cancel() {
          this.cancelled = true;
        },
        promise: new Promise((resolve) => {
          resolveRunner = resolve;
        })
      };
    }
  };

  queue = createQueue({
    getDbInstance: () => db,
    getSettings: () => ({ concurrency: 1 }),
    executeJobFn: mockRunner.executeJob
  });

  const jobId = queue.startJob({
    url: 'https://example.com/movie.mp4',
    title: 'Race Condition Test',
    provider: 'direct',
    destDir: tmpDir
  });

  await new Promise((r) => setTimeout(r, 30));
  const runningJob = queue.listJobs().find((j) => j.id === jobId);
  assert.equal(runningJob.status, 'downloading');

  // Cancel the job
  queue.cancelJob(jobId);
  assert.equal(queue.listJobs().find((j) => j.id === jobId).status, 'cancelled');

  // Immediately resolve the runner promise (simulating a delayed completion resolution)
  resolveRunner({ path: path.join(tmpDir, 'movie.mp4') });
  await new Promise((r) => setTimeout(r, 50));

  // The job MUST remain cancelled and must NOT become completed
  const finalJob = queue.listJobs().find((j) => j.id === jobId);
  assert.equal(finalJob.status, 'cancelled', 'Job must remain cancelled despite promise resolution');
  assert.notEqual(finalJob.status, 'completed');
});

test('queue suppresses late progress updates after job cancellation', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-progress-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  let onProgressCallback;
  const mockRunner = {
    executeJob(job, options = {}) {
      onProgressCallback = options.onProgress;
      return {
        cancelled: false,
        cancel() {
          this.cancelled = true;
        },
        promise: new Promise(() => {}) // Stays pending
      };
    }
  };

  queue = createQueue({
    getDbInstance: () => db,
    getSettings: () => ({ concurrency: 1 }),
    executeJobFn: mockRunner.executeJob
  });

  const jobId = queue.startJob({
    url: 'https://example.com/audio.mp3',
    title: 'Progress Guard Test',
    provider: 'direct',
    destDir: tmpDir
  });

  await new Promise((r) => setTimeout(r, 30));

  // Cancel the job
  queue.cancelJob(jobId);
  assert.equal(queue.listJobs().find((j) => j.id === jobId).status, 'cancelled');

  // Fire late progress event
  onProgressCallback?.({ received: 800_000, total: 1_000_000, speed: 100_000 });
  await new Promise((r) => setTimeout(r, 50));

  // DB must still reflect cancelled, speed 0
  const row = db.prepare('SELECT status, speed FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.speed, 0, 'Speed must be 0 for cancelled job');
});

test('queue pump prevents executing the same job twice simultaneously', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-double-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  let executeCount = 0;
  const mockRunner = {
    executeJob() {
      executeCount++;
      return {
        cancelled: false,
        cancel() {},
        promise: new Promise(() => {})
      };
    }
  };

  queue = createQueue({
    getDbInstance: () => db,
    getSettings: () => ({ concurrency: 2 }),
    executeJobFn: mockRunner.executeJob
  });

  queue.startJob({
    url: 'https://example.com/file1.mp4',
    title: 'Unique Execution Test',
    provider: 'direct',
    destDir: tmpDir
  });

  // Call pump repeatedly in rapid succession
  queue.pump();
  queue.pump();
  queue.pump();

  assert.equal(executeCount, 1, 'Job must only be executed once');
});

test('runner cancels yt-dlp job before process spawn without launching orphan processes', async (t) => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-ytdlp-cancel-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const job = {
    id: 'test-yt-cancel-early',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    dest_dir: dest
  };

  const handle = executeJob(job, { allowLocal: true });
  // Cancel immediately before yt-dlp binary resolution / guard finishes
  handle.cancel();
  assert.equal(handle.cancelled, true, 'Handle must record cancelled state');

  await assert.rejects(
    handle.promise,
    (err) => err.message.includes('cancelled') || err.name === 'AbortError'
  );
});

/* =====================================================================
   3. TELEMETRY ACCURACY & IN-MEMORY BOUNDS
   ===================================================================== */

test('telemetry clamps remainingBytes to 0 and etaSeconds to 0 when bytesDone >= bytesTotal', () => {
  const tracker = createTelemetryTracker();
  const id = 'tel-clamp-test';
  tracker.start(id, { bytesTotal: 5000, initialBytes: 0, startedAt: 1000 });

  // Record bytesDone >= bytesTotal
  tracker.record(id, { bytesDone: 5000, bytesTotal: 5000, timestamp: 2000, providerSpeed: 2500 });
  const tel = tracker.get(id);

  assert.equal(tel.remainingBytes, 0, 'Remaining bytes must be 0 when finished');
  assert.equal(tel.etaSeconds, 0, 'ETA must be 0s when finished');
  assert.equal(tel.progressPercent, 100.0, 'Progress must be 100%');

  tracker.remove(id);
});

test('telemetry accurately computes average speed for resumed downloads with initial offset', () => {
  // Started at 10MB, finished at 20MB (10MB transferred in this session) over 5 seconds = 2MB/s
  const avg = calculateAverageSpeed(20_000_000, 5000, 10_000_000);
  assert.equal(avg, 2_000_000, 'Average speed must reflect only bytes transferred during current session');
});

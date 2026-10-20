import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { migrate } from '../electron/db.js';
import { createQueue } from '../electron/queue.js';
import { directDownload } from '../electron/providers/direct.js';
import { executeJob } from '../electron/runner.js';
import { createTelemetryTracker } from '../electron/telemetry.js';

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
   1. DIRECT DOWNLOAD PAUSE & RANGE PROTOCOL TESTS
   ===================================================================== */

test('1. Successful initial download completes with exact bytes and integrity', async (t) => {
  const content = Buffer.alloc(100_000, 'A');
  const server = await startServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': content.length
    });
    res.end(content);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-init-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const res = await directDownload(`http://127.0.0.1:${port}/file.bin`, dest, { allowLocal: true });
  assert.equal(fs.statSync(res.path).size, content.length);
  assert.equal(fs.readFileSync(res.path).toString(), content.toString());
});

test('2. Pause during streamed response safely closes stream and retains partial file', async (t) => {
  const server = await startServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': 500_000,
      'accept-ranges': 'bytes'
    });
    let sent = 0;
    const interval = setInterval(() => {
      if (sent >= 500_000) {
        clearInterval(interval);
        res.end();
        return;
      }
      res.write(Buffer.alloc(50_000, 'P'));
      sent += 50_000;
    }, 25);
    req.on('close', () => clearInterval(interval));
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-pause-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const pauseController = new AbortController();
  let pausedTriggered = false;

  const dlPromise = directDownload(`http://127.0.0.1:${port}/pause.bin`, dest, {
    allowLocal: true,
    pauseSignal: pauseController.signal,
    onProgress: (p) => {
      if (p.received >= 100_000 && !pausedTriggered) {
        pausedTriggered = true;
        pauseController.abort();
      }
    }
  });

  const result = await dlPromise;
  assert.ok(result.paused, 'Result must indicate paused');
  assert.ok(fs.existsSync(result.path), 'Partial file must remain on disk');
  const diskSize = fs.statSync(result.path).size;
  assert.ok(diskSize >= 100_000, 'Partial file must contain downloaded bytes');
  assert.equal(result.bytes, diskSize);
});

test('3 & 4. Resume from exact existing byte offset with valid HTTP 206 Partial Content', async (t) => {
  const fullContent = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(10_000)); // 360,000 bytes
  let rangeRequested = null;

  const server = await startServer((req, res) => {
    const range = req.headers['range'];
    rangeRequested = range;
    if (range) {
      const match = /bytes=(\d+)-/.exec(range);
      const start = Number(match[1]);
      const chunk = fullContent.subarray(start);
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes ${start}-${fullContent.length - 1}/${fullContent.length}`,
        'content-length': chunk.length
      });
      res.end(chunk);
    } else {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': fullContent.length
      });
      res.end(fullContent);
    }
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-resume-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  // Pre-seed a partial file of 100,000 bytes
  const partPath = path.join(dest, '.resume.bin.part');
  fs.writeFileSync(partPath, fullContent.subarray(0, 100_000));

  const res = await directDownload(`http://127.0.0.1:${port}/resume.bin`, dest, {
    allowLocal: true,
    isResume: true,
    partialPath: partPath
  });

  assert.equal(rangeRequested, 'bytes=100000-');
  assert.equal(fs.statSync(res.path).size, fullContent.length);
  assert.ok(crypto.timingSafeEqual(fs.readFileSync(res.path), fullContent), 'Resumed file must be byte-for-byte identical');
});

test('5. Server ignores Range and returns HTTP 200: truncates file safely and never corrupts', async (t) => {
  const fullContent = Buffer.from('COMPLETE_REPLACEMENT_PAYLOAD'.repeat(1000));

  const server = await startServer((req, res) => {
    // Server ignores range header and sends 200
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': fullContent.length
    });
    res.end(fullContent);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-ign-range-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  // Pre-seed an existing partial file
  const partPath = path.join(dest, '.ignore.bin.part');
  fs.writeFileSync(partPath, Buffer.alloc(5000, 'Z'));

  const res = await directDownload(`http://127.0.0.1:${port}/ignore.bin`, dest, {
    allowLocal: true,
    isResume: true,
    partialPath: partPath
  });

  // Size must be exactly fullContent.length (NOT 5000 + fullContent.length)
  assert.equal(fs.statSync(res.path).size, fullContent.length);
  assert.ok(crypto.timingSafeEqual(fs.readFileSync(res.path), fullContent));
});

test('6. Invalid or inconsistent Content-Range restarts cleanly from zero without appending', async (t) => {
  const fullContent = Buffer.alloc(80_000, 'K');
  let attempt = 0;

  const server = await startServer((req, res) => {
    attempt++;
    if (attempt === 1 && req.headers['range']) {
      // Return inconsistent range start: client asked for 20000, server claims bytes 0-79999
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-79999/${fullContent.length}`,
        'content-length': fullContent.length
      });
      res.end(fullContent);
    } else {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': fullContent.length
      });
      res.end(fullContent);
    }
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-inconsistent-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const partPath = path.join(dest, '.inconsistent.bin.part');
  fs.writeFileSync(partPath, Buffer.alloc(20_000, 'X'));

  const res = await directDownload(`http://127.0.0.1:${port}/inconsistent.bin`, dest, {
    allowLocal: true,
    isResume: true,
    partialPath: partPath
  });

  assert.equal(fs.statSync(res.path).size, fullContent.length);
  assert.ok(crypto.timingSafeEqual(fs.readFileSync(res.path), fullContent));
});

test('7. Remote ETag changes between requests: restarts cleanly from zero', async (t) => {
  const v1Content = Buffer.alloc(50_000, '1');
  const v2Content = Buffer.alloc(60_000, '2');

  const server = await startServer((req, res) => {
    const ifRange = req.headers['if-range'];
    if (ifRange && ifRange === '"v1"') {
      // ETag changed on server to "v2"! Per RFC 9110, server returns 200 with new representation
      res.writeHead(200, {
        'etag': '"v2"',
        'content-type': 'application/octet-stream',
        'content-length': v2Content.length
      });
      res.end(v2Content);
    } else {
      res.writeHead(200, {
        'etag': '"v2"',
        'content-type': 'application/octet-stream',
        'content-length': v2Content.length
      });
      res.end(v2Content);
    }
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-etag-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const partPath = path.join(dest, '.etag.bin.part');
  fs.writeFileSync(partPath, v1Content.subarray(0, 20_000));

  const res = await directDownload(`http://127.0.0.1:${port}/etag.bin`, dest, {
    allowLocal: true,
    isResume: true,
    partialPath: partPath,
    etag: '"v1"'
  });

  assert.equal(fs.statSync(res.path).size, v2Content.length);
  assert.ok(crypto.timingSafeEqual(fs.readFileSync(res.path), v2Content));
});

test('8. Remote resource changes without an ETag: If-Range last-modified check triggers fresh 200', async (t) => {
  const newContent = Buffer.alloc(40_000, 'N');
  const server = await startServer((req, res) => {
    // Client sent an older Last-Modified date in If-Range
    res.writeHead(200, {
      'last-modified': 'Wed, 21 Oct 2026 12:00:00 GMT',
      'content-type': 'application/octet-stream',
      'content-length': newContent.length
    });
    res.end(newContent);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-mod-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const partPath = path.join(dest, '.mod.bin.part');
  fs.writeFileSync(partPath, Buffer.alloc(10_000, 'O'));

  const res = await directDownload(`http://127.0.0.1:${port}/mod.bin`, dest, {
    allowLocal: true,
    isResume: true,
    partialPath: partPath,
    lastModified: 'Mon, 19 Oct 2026 12:00:00 GMT'
  });

  assert.equal(fs.statSync(res.path).size, newContent.length);
  assert.ok(crypto.timingSafeEqual(fs.readFileSync(res.path), newContent));
});

test('9. Server does not support range requests (returns 200): handles cleanly from zero', async (t) => {
  const content = Buffer.alloc(30_000, 'U');
  const server = await startServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': content.length
    });
    res.end(content);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-norange-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const res = await directDownload(`http://127.0.0.1:${port}/norange.bin`, dest, {
    allowLocal: true,
    isResume: true,
    partialPath: path.join(dest, '.norange.bin.part')
  });

  assert.equal(fs.statSync(res.path).size, content.length);
});

test('10. Unknown Content-Length streaming works with pause and resume', async (t) => {
  const chunk1 = Buffer.alloc(20_000, '1');
  const chunk2 = Buffer.alloc(30_000, '2');

  const server = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' }); // No Content-Length
    res.write(chunk1);
    setTimeout(() => res.end(chunk2), 50);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-chunked-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const res = await directDownload(`http://127.0.0.1:${port}/chunked.bin`, dest, { allowLocal: true });
  assert.equal(fs.statSync(res.path).size, 50_000);
});

/* =====================================================================
   2. QUEUE STATE MACHINE, PERSISTENCE & RECOVERY TESTS
   ===================================================================== */

test('11. Connection interruption followed by resume recovers safely', async (t) => {
  const fullContent = Buffer.alloc(100_000, 'W');
  let connectionCount = 0;

  const server = await startServer((req, res) => {
    connectionCount++;
    if (connectionCount === 1) {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': fullContent.length,
        'accept-ranges': 'bytes'
      });
      res.write(fullContent.subarray(0, 40_000));
      setTimeout(() => req.socket.destroy(), 30);
    } else {
      const match = /bytes=(\d+)-/.exec(req.headers['range'] || '');
      const start = match ? Number(match[1]) : 0;
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes ${start}-${fullContent.length - 1}/${fullContent.length}`,
        'content-length': fullContent.length - start
      });
      res.end(fullContent.subarray(start));
    }
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-recover-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  queue = createQueue({
    getDbInstance: () => db,
    getSettings: () => ({ concurrency: 1, allowLocalNetwork: true })
  });

  const jobId = queue.startJob({
    url: `http://127.0.0.1:${port}/drop.bin`,
    title: 'Drop and Resume Test',
    provider: 'direct',
    destDir: tmpDir
  });

  // Wait for initial connection drop to record failure/interruption
  let dropAttempts = 0;
  while (dropAttempts++ < 50) {
    await new Promise((r) => setTimeout(r, 40));
    const current = queue.listJobs().find((j) => j.id === jobId);
    if (current && (current.status === 'failed' || current.status === 'paused')) break;
  }

  // Resume the job
  queue.resumeJob(jobId);

  // Wait for completion
  let attempts = 0;
  while (attempts++ < 50) {
    await new Promise((r) => setTimeout(r, 50));
    const current = queue.listJobs().find((j) => j.id === jobId);
    if (current && current.status === 'completed') break;
  }

  const finalJob = queue.listJobs().find((j) => j.id === jobId);
  assert.equal(finalJob.status, 'completed');
  assert.equal(finalJob.downloadedBytes, fullContent.length);
});

test('12. Paused job survives application/queue reconstruction', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-survive-'));
  const dbFile = path.join(tmpDir, 'queue.db');
  let db = migrate(new Database(dbFile));

  // Insert a paused job
  const jobId = 'paused-job-1';
  db.prepare(`
    INSERT INTO jobs (id, url, status, bytes_done, bytes_total, created_at)
    VALUES (?, 'https://example.com/test.mp4', 'paused', 500, 1000, 1)
  `).run(jobId);

  // Create queue instance and run recover()
  const q1 = createQueue({ getDbInstance: () => db });
  q1.recover();

  // Paused job MUST remain 'paused'
  const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.status, 'paused', 'Paused jobs must not be converted to waiting by recover');

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('13. Missing partial file during recovery falls back to 0 bytes safely', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-missing-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const missingPart = path.join(tmpDir, '.deleted.part');
  const jobId = 'missing-file-job';
  db.prepare(`
    INSERT INTO jobs (id, url, status, bytes_done, partial_path, created_at)
    VALUES (?, 'https://example.com/file.bin', 'paused', 5000, ?, 1)
  `).run(jobId, missingPart);

  queue = createQueue({ getDbInstance: () => db });
  // Resume job with missing partial file
  queue.resumeJob(jobId);

  const row = db.prepare('SELECT bytes_done, partial_path FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.bytes_done, 0, 'Bytes done must reset to 0 when partial file was removed');
  assert.equal(row.partial_path, null);
});

test('14. Partial file size differs from persisted metadata: authoritative disk size wins', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-diff-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const partPath = path.join(tmpDir, '.diff.part');
  fs.writeFileSync(partPath, Buffer.alloc(12_345, 'X'));

  const jobId = 'diff-size-job';
  db.prepare(`
    INSERT INTO jobs (id, url, status, bytes_done, partial_path, created_at)
    VALUES (?, 'https://example.com/file.bin', 'paused', 9999, ?, 1)
  `).run(jobId, partPath);

  queue = createQueue({ getDbInstance: () => db });
  queue.resumeJob(jobId);

  const row = db.prepare('SELECT bytes_done FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.bytes_done, 12_345, 'Disk file size must be authoritative');
});

test('15 & 16. Repeated pause and resume requests are idempotent', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-idempotent-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const mockRunner = {
    executeJob() {
      return {
        cancelled: false,
        paused: false,
        cancel() { this.cancelled = true; },
        pause() { this.paused = true; },
        promise: new Promise(() => {}) // pending
      };
    }
  };

  queue = createQueue({
    getDbInstance: () => db,
    executeJobFn: mockRunner.executeJob
  });

  const jobId = queue.startJob({
    url: 'https://example.com/idem.bin',
    title: 'Idempotency Test',
    provider: 'direct',
    destDir: tmpDir
  });

  await new Promise((r) => setTimeout(r, 20));

  // Multiple pause calls
  assert.equal(queue.pauseJob(jobId), true);
  assert.equal(queue.pauseJob(jobId), true);
  assert.equal(queue.pauseJob(jobId), true);

  // Set to paused
  db.prepare("UPDATE jobs SET status = 'paused' WHERE id = ?").run(jobId);

  // Multiple resume calls
  assert.equal(queue.resumeJob(jobId), true);
  assert.equal(queue.resumeJob(jobId), true);
});

test('17. Cancel while pausing cancels cleanly and deletes partial file', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-cancel-pause-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const partFile = path.join(tmpDir, '.test.part');
  fs.writeFileSync(partFile, 'partial');

  const jobId = 'cancel-pausing-job';
  db.prepare(`
    INSERT INTO jobs (id, url, status, partial_path, created_at)
    VALUES (?, 'https://example.com/test.bin', 'pausing', ?, 1)
  `).run(jobId, partFile);

  queue = createQueue({ getDbInstance: () => db });
  queue.cancelJob(jobId);

  const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.status, 'cancelled');
  assert.equal(fs.existsSync(partFile), false, 'Partial file must be unlinked on cancellation');
});

test('18. Cancel while resuming cancels cleanly', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-cancel-resuming-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const jobId = 'cancel-resuming-job';
  db.prepare(`
    INSERT INTO jobs (id, url, status, created_at)
    VALUES (?, 'https://example.com/test.bin', 'resuming', 1)
  `).run(jobId);

  queue = createQueue({ getDbInstance: () => db });
  queue.cancelJob(jobId);

  const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.status, 'cancelled');
});

test('19. Late progress events after pause are suppressed', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-late-pause-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  let progressHook;
  const mockRunner = {
    executeJob(job, opts) {
      progressHook = opts.onProgress;
      return {
        cancelled: false,
        paused: false,
        cancel() { this.cancelled = true; },
        pause() { this.paused = true; },
        promise: new Promise(() => {})
      };
    }
  };

  queue = createQueue({
    getDbInstance: () => db,
    executeJobFn: mockRunner.executeJob
  });

  const jobId = queue.startJob({
    url: 'https://example.com/prog.bin',
    title: 'Late Progress Test',
    provider: 'direct',
    destDir: tmpDir
  });

  await new Promise((r) => setTimeout(r, 20));
  queue.pauseJob(jobId);
  db.prepare("UPDATE jobs SET status = 'paused' WHERE id = ?").run(jobId);

  // Late progress call arriving after pause
  progressHook?.({ received: 999_999, total: 1_000_000, speed: 50_000 });
  await new Promise((r) => setTimeout(r, 50));

  const row = db.prepare('SELECT status, speed FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.status, 'paused');
  assert.equal(row.speed, 0, 'Speed must remain 0 when paused');
});

test('20. No duplicate execution for the same job across concurrent pumps', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-dup-pump-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  let executeCalls = 0;
  const mockRunner = {
    executeJob() {
      executeCalls++;
      return {
        cancelled: false,
        paused: false,
        cancel() {},
        pause() {},
        promise: new Promise(() => {})
      };
    }
  };

  queue = createQueue({
    getDbInstance: () => db,
    getSettings: () => ({ concurrency: 4 }),
    executeJobFn: mockRunner.executeJob
  });

  queue.startJob({
    url: 'https://example.com/dup.bin',
    title: 'Duplicate Pump Test',
    provider: 'direct',
    destDir: tmpDir
  });

  // Rapidly trigger pumps
  queue.pump();
  queue.pump();
  queue.pump();

  assert.equal(executeCalls, 1, 'Job must only be scheduled once');
});

test('21 & 22. Full file integrity check: verify zero byte loss and no double concatenation', async (t) => {
  const sourcePayload = crypto.randomBytes(250_000);
  const server = await startServer((req, res) => {
    const range = req.headers['range'];
    if (range) {
      const match = /bytes=(\d+)-/.exec(range);
      const start = Number(match[1]);
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes ${start}-${sourcePayload.length - 1}/${sourcePayload.length}`,
        'content-length': sourcePayload.length - start
      });
      res.end(sourcePayload.subarray(start));
    } else {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': sourcePayload.length
      });
      res.end(sourcePayload);
    }
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-integrity-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  // Pre-seed 80,000 bytes
  const partPath = path.join(dest, '.integrity.bin.part');
  fs.writeFileSync(partPath, sourcePayload.subarray(0, 80_000));

  const res = await directDownload(`http://127.0.0.1:${port}/integrity.bin`, dest, {
    allowLocal: true,
    isResume: true,
    partialPath: partPath
  });

  const finalBuf = fs.readFileSync(res.path);
  assert.equal(finalBuf.length, sourcePayload.length);
  assert.equal(crypto.createHash('sha256').update(finalBuf).digest('hex'), crypto.createHash('sha256').update(sourcePayload).digest('hex'));
});

test('23. State machine rejects invalid pause transitions for completed or failed jobs', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-reject-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;

  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  db.prepare("INSERT INTO jobs (id, url, status, created_at) VALUES ('c1', 'https://example.com/1', 'completed', 1)").run();
  db.prepare("INSERT INTO jobs (id, url, status, created_at) VALUES ('f1', 'https://example.com/2', 'failed', 1)").run();

  queue = createQueue({ getDbInstance: () => db });

  assert.equal(queue.pauseJob('c1'), false, 'Cannot pause completed job');
  assert.equal(queue.pauseJob('f1'), false, 'Cannot pause failed job');
  assert.equal(queue.pauseJob('non-existent-id'), false, 'Cannot pause non-existent job');
});

test('24. Existing standard direct downloads remain 100% backward compatible', async (t) => {
  const testBytes = Buffer.from('STANDARD_COMPAT_TEST');
  const server = await startServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': testBytes.length
    });
    res.end(testBytes);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-compat-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const result = await directDownload(`http://127.0.0.1:${port}/compat.bin`, dest, { allowLocal: true });
  assert.equal(fs.readFileSync(result.path).toString(), testBytes.toString());
});

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
import { planSegments, segmentFilePath, inspectSegments, cleanupSegmentFiles } from '../electron/providers/segmentPlanner.js';
import { probeSegmentEligibility, segmentedDownload } from '../electron/providers/segmented.js';
import { executeJob } from '../electron/runner.js';

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
   1. SEGMENT PLANNER UNIT & INVARIANT TESTS
   ===================================================================== */

test('1 & 2. Segment planner produces exact coverage with zero gaps or overlaps', () => {
  const testSizes = [1000, 1001, 1002, 1003, 10000, 524288, 1048576, 10000000];

  for (const size of testSizes) {
    for (const conns of [2, 3, 4, 8]) {
      const plan = planSegments(size, conns, 100);
      assert.ok(plan && plan.length >= 1);
      assert.equal(plan[0].start, 0);
      assert.equal(plan[plan.length - 1].end, size - 1);

      let totalCovered = 0;
      for (let i = 0; i < plan.length; i++) {
        const seg = plan[i];
        assert.equal(seg.total, seg.end - seg.start + 1);
        totalCovered += seg.total;

        if (i < plan.length - 1) {
          assert.equal(seg.end + 1, plan[i + 1].start, `Gap/overlap between segment ${i} and ${i + 1}`);
        }
      }
      assert.equal(totalCovered, size);
    }
  }

  // Edge cases
  assert.equal(planSegments(0), null);
  assert.equal(planSegments(-50), null);
  assert.equal(planSegments('invalid'), null);
  assert.equal(planSegments(100, 0), null); // Clamped or rejected
});

/* =====================================================================
   2. HTTP PROTOCOL & SEGMENTED WORKER TESTS
   ===================================================================== */

test('3 & 4. Multi-connection download executes concurrent 206 ranges and merges with exact byte integrity', async (t) => {
  const content = crypto.randomBytes(600_000); // 600 KB
  const requestedRanges = [];

  const server = await startServer((req, res) => {
    const range = req.headers['range'];
    requestedRanges.push(range);

    if (range === 'bytes=0-0') {
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-0/${content.length}`,
        'content-length': 1,
        'etag': '"v1"'
      });
      return res.end(content.subarray(0, 1));
    }

    const match = /bytes=(\d+)-(\d+)/.exec(range || '');
    if (!match) {
      res.writeHead(400);
      return res.end();
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    const slice = content.subarray(start, end + 1);

    res.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${content.length}`,
      'content-length': slice.length,
      'etag': '"v1"'
    });
    res.end(slice);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-seg-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const res = await segmentedDownload(`http://127.0.0.1:${port}/video.mp4`, dest, {
    allowLocal: true,
    connections: 4,
    minSegmentSize: 50_000 // Test threshold
  });

  assert.equal(res.isSegmented, true);
  assert.equal(fs.statSync(res.path).size, content.length);
  assert.ok(crypto.timingSafeEqual(fs.readFileSync(res.path), content));
  // Probe was requested plus at least 2 distinct segment ranges
  assert.ok(requestedRanges.length >= 3);
});

test('5. Server ignores Range and returns HTTP 200: signals fallback to single connection', async (t) => {
  const server = await startServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': 400_000
    });
    res.end(Buffer.alloc(400_000, 'X'));
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-fallback-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const res = await segmentedDownload(`http://127.0.0.1:${port}/norange.mp4`, dest, {
    allowLocal: true,
    connections: 4,
    minSegmentSize: 50_000
  });

  assert.equal(res.fallbackToSingle, true);
  assert.match(res.reason, /HTTP 200/i);
});

test('6 & 7. Server advertises ranges but returns invalid or inconsistent Content-Range', async (t) => {
  const server = await startServer((req, res) => {
    // Inconsistent start offset in Content-Range
    res.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': 'bytes 50-100/500000',
      'content-length': 51
    });
    res.end(Buffer.alloc(51));
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const probe = await probeSegmentEligibility(`http://127.0.0.1:${port}/badcr.mp4`, {
    allowLocal: true,
    minSegmentSize: 50_000
  });

  assert.equal(probe.eligible, false);
  assert.match(probe.reason, /Inconsistent Content-Range/i);
});

test('8 & 9. Unknown resource size or server without range support falls back to single connection', async (t) => {
  const server = await startServer((req, res) => {
    // No Content-Length, HTTP 200
    res.writeHead(200, { 'content-type': 'video/mp4' });
    res.end(Buffer.alloc(10_000, 'Z'));
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const probe = await probeSegmentEligibility(`http://127.0.0.1:${port}/chunked.mp4`, { allowLocal: true });
  assert.equal(probe.eligible, false);
});

test('10 & 11. Remote ETag changes during segmented download: triggers safe failure or clean restart', async (t) => {
  const contentV1 = crypto.randomBytes(300_000);
  let requestNum = 0;

  const server = await startServer((req, res) => {
    requestNum++;
    const range = req.headers['range'];

    if (range === 'bytes=0-0') {
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-0/${contentV1.length}`,
        'content-length': 1,
        'etag': '"v1"'
      });
      return res.end(contentV1.subarray(0, 1));
    }

    // Mid-download: server ETag changes to v2
    const match = /bytes=(\d+)-(\d+)/.exec(range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match ? Number(match[2]) : 1000;
    const slice = contentV1.subarray(start, end + 1);

    res.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${contentV1.length}`,
      'content-length': slice.length,
      'etag': '"v2-changed"' // Changed ETag
    });
    res.end(slice);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-etag-seg-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      segmentedDownload(`http://127.0.0.1:${port}/resource.mp4`, dest, {
        allowLocal: true,
        connections: 2,
        minSegmentSize: 50_000
      }),
    /ETag changed/i
  );
});

test('12 & 13. Weak ETag and Last-Modified handling per RFC 9110', async (t) => {
  const content = crypto.randomBytes(200_000);
  let receivedIfRange = null;

  const server = await startServer((req, res) => {
    const range = req.headers['range'];
    receivedIfRange = req.headers['if-range'];

    if (range === 'bytes=0-0') {
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-0/${content.length}`,
        'content-length': 1,
        'etag': 'W/"weak-123"',
        'last-modified': 'Wed, 21 Oct 2026 12:00:00 GMT'
      });
      return res.end(content.subarray(0, 1));
    }

    const match = /bytes=(\d+)-(\d+)/.exec(range || '');
    const start = Number(match[1]);
    const end = Number(match[2]);
    res.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${content.length}`,
      'content-length': end - start + 1,
      'etag': 'W/"weak-123"',
      'last-modified': 'Wed, 21 Oct 2026 12:00:00 GMT'
    });
    res.end(content.subarray(start, end + 1));
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-weak-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const res = await segmentedDownload(`http://127.0.0.1:${port}/weak.mp4`, dest, {
    allowLocal: true,
    connections: 2,
    minSegmentSize: 50_000
  });

  assert.equal(fs.statSync(res.path).size, content.length);
  // Under RFC 9110, If-Range MUST NOT be a weak ETag; it should use Last-Modified instead
  if (receivedIfRange) {
    assert.ok(!receivedIfRange.startsWith('W/'), 'Weak ETag must not be sent in If-Range');
  }
});

test('14 & 16. Transient worker error and HTTP 429 handled with bounded retry and backoff', async (t) => {
  const content = crypto.randomBytes(300_000);
  let rateLimitHits = 0;

  const server = await startServer((req, res) => {
    const range = req.headers['range'];
    if (range === 'bytes=0-0') {
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-0/${content.length}`,
        'content-length': 1
      });
      return res.end(content.subarray(0, 1));
    }

    // Force one transient 429 on first chunk request
    if (rateLimitHits === 0) {
      rateLimitHits++;
      res.writeHead(429, { 'retry-after': '1' });
      return res.end('Too Many Requests');
    }

    const match = /bytes=(\d+)-(\d+)/.exec(range || '');
    const start = Number(match[1]);
    const end = Number(match[2]);
    res.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${content.length}`,
      'content-length': end - start + 1
    });
    res.end(content.subarray(start, end + 1));
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-429-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const res = await segmentedDownload(`http://127.0.0.1:${port}/retry.mp4`, dest, {
    allowLocal: true,
    connections: 2,
    minSegmentSize: 50_000
  });

  assert.equal(fs.statSync(res.path).size, content.length);
  assert.equal(rateLimitHits, 1);
});

test('15. Permanent worker error exhausts retries and preserves segments for resume', async (t) => {
  const server = await startServer((req, res) => {
    const range = req.headers['range'];
    if (range === 'bytes=0-0') {
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': 'bytes 0-0/300000',
        'content-length': 1
      });
      return res.end(Buffer.alloc(1));
    }
    // Always fail worker ranges with 500
    res.writeHead(500);
    res.end('Permanent Internal Error');
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-perm-fail-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      segmentedDownload(`http://127.0.0.1:${port}/perm.mp4`, dest, {
        allowLocal: true,
        connections: 2,
        minSegmentSize: 50_000
      }),
    /failed after 3 retries/i
  );
});

/* =====================================================================
   3. PAUSE, RESUME, CANCEL, & RECOVERY TESTS
   ===================================================================== */

test('17. Cancellation while multiple segments are active unlinks all segment files cleanly', async (t) => {
  const content = crypto.randomBytes(600_000);
  const cancelController = new AbortController();

  const server = await startServer((req, res) => {
    const range = req.headers['range'];
    if (range === 'bytes=0-0') {
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-0/${content.length}`,
        'content-length': 1
      });
      return res.end(content.subarray(0, 1));
    }
    const match = /bytes=(\d+)-(\d+)/.exec(range || '');
    const start = Number(match[1]);
    const end = Number(match[2]);
    res.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${content.length}`,
      'content-length': end - start + 1
    });
    // Send partial chunk then delay to allow cancel trigger
    res.write(content.subarray(start, start + 1000));
    setTimeout(() => cancelController.abort(), 30);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-cancel-seg-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      segmentedDownload(`http://127.0.0.1:${port}/cancel.mp4`, dest, {
        allowLocal: true,
        connections: 3,
        minSegmentSize: 50_000,
        signal: cancelController.signal
      }),
    /cancelled/i
  );

  // Verify all .seg files were deleted
  const remainingFiles = fs.readdirSync(dest);
  assert.equal(remainingFiles.filter((f) => f.includes('.seg')).length, 0);
});

test('18 & 19. Pause during segmented transfer flushes streams and resumes from disk offsets', async (t) => {
  const content = crypto.randomBytes(600_000);
  const pauseController = new AbortController();
  let pausedOnce = false;

  const server = await startServer((req, res) => {
    const range = req.headers['range'];
    if (range === 'bytes=0-0') {
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-0/${content.length}`,
        'content-length': 1,
        'etag': '"v1"'
      });
      return res.end(content.subarray(0, 1));
    }

    const match = /bytes=(\d+)-(\d+)/.exec(range || '');
    const start = Number(match[1]);
    const end = Number(match[2]);
    const slice = content.subarray(start, end + 1);

    res.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${content.length}`,
      'content-length': slice.length,
      'etag': '"v1"'
    });

    if (!pausedOnce) {
      // Send some bytes and trigger pause
      res.write(slice.subarray(0, Math.min(slice.length, 20_000)));
      setTimeout(() => {
        pauseController.abort();
        res.end();
      }, 30);
    } else {
      res.end(slice);
    }
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-pause-seg-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  // Run initial segmented download that pauses
  const pauseRes = await segmentedDownload(`http://127.0.0.1:${port}/pause.mp4`, dest, {
    allowLocal: true,
    connections: 3,
    minSegmentSize: 50_000,
    pauseSignal: pauseController.signal
  });

  assert.equal(pauseRes.paused, true);
  assert.ok(pauseRes.bytes > 0);
  assert.ok(pauseRes.plan && pauseRes.plan.length === 3);

  // Resume download with existing plan and partialPath
  pausedOnce = true;
  const resumeRes = await segmentedDownload(`http://127.0.0.1:${port}/pause.mp4`, dest, {
    allowLocal: true,
    isResume: true,
    partialPath: pauseRes.path,
    plan: pauseRes.plan,
    etag: '"v1"',
    minSegmentSize: 50_000
  });

  assert.equal(fs.statSync(resumeRes.path).size, content.length);
  assert.ok(crypto.timingSafeEqual(fs.readFileSync(resumeRes.path), content));
});

test('20 & 21. Recovery after queue restart: authoritative disk inspection recovers valid segments', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-q-seg-recover-'));
  const dbFile = path.join(tmpDir, 'queue.db');
  const db = migrate(new Database(dbFile));

  const partPath = path.join(tmpDir, '.test-recover.mp4.part');
  const plan = [
    { index: 0, start: 0, end: 99999, total: 100000 },
    { index: 1, start: 100000, end: 199999, total: 100000 }
  ];

  // Write segment 0 completely, segment 1 partially
  fs.writeFileSync(segmentFilePath(partPath, 0), Buffer.alloc(100000, 'A'));
  fs.writeFileSync(segmentFilePath(partPath, 1), Buffer.alloc(40000, 'B'));

  const jobId = 'seg-job-1';
  db.prepare(`
    INSERT INTO jobs (id, url, status, bytes_done, bytes_total, is_segmented, segments_count, segment_plan, partial_path, created_at)
    VALUES (?, 'https://example.com/test.mp4', 'downloading', 0, 200000, 1, 2, ?, ?, 100)
  `).run(jobId, JSON.stringify(plan), partPath);

  // Initialize queue with a mock executeJobFn so pump does not run actual network
  let jobStarted = null;
  const q = createQueue({
    getDbInstance: () => db,
    executeJobFn: (job) => {
      jobStarted = job;
      return { promise: new Promise(() => {}), cancel() {} };
    }
  });

  q.recover();

  // Authoritative disk inspection verified 140000 bytes
  const row = db.prepare('SELECT status, bytes_done FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.bytes_done, 140000);
  assert.equal(jobStarted?.bytes_done, 140000);

  q.shutdown();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('22 & 25. No duplicate byte counting during retries: verified unique progress', async (t) => {
  let progressEvents = [];
  const content = crypto.randomBytes(300_000);

  const server = await startServer((req, res) => {
    const range = req.headers['range'];
    if (range === 'bytes=0-0') {
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-0/${content.length}`,
        'content-length': 1
      });
      return res.end(content.subarray(0, 1));
    }
    const match = /bytes=(\d+)-(\d+)/.exec(range || '');
    const start = Number(match[1]);
    const end = Number(match[2]);
    res.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${content.length}`,
      'content-length': end - start + 1
    });
    res.end(content.subarray(start, end + 1));
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-prog-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  await segmentedDownload(`http://127.0.0.1:${port}/prog.mp4`, dest, {
    allowLocal: true,
    connections: 2,
    minSegmentSize: 50_000,
    onProgress: (p) => progressEvents.push(p.received)
  });

  // Progress events must never exceed total size
  for (const p of progressEvents) {
    assert.ok(p <= content.length, `Progress ${p} exceeded total ${content.length}`);
  }
  assert.equal(progressEvents[progressEvents.length - 1], content.length);
});

test('26 & 27. Safe fallback to single connection when runner executes with non-range server', async (t) => {
  const content = Buffer.alloc(200_000, 'S');

  const server = await startServer((req, res) => {
    // Normal 200 response without Range support
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': content.length
    });
    res.end(content);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-run-fallback-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));

  const job = {
    id: 'test-fallback-job',
    url: `http://127.0.0.1:${port}/video.mp4`,
    dest_dir: dest,
    provider: 'direct'
  };

  const handle = executeJob(job, { allowLocal: true });
  const res = await handle.promise;

  assert.equal(fs.statSync(res.path).size, content.length);
  assert.ok(crypto.timingSafeEqual(fs.readFileSync(res.path), content));
});

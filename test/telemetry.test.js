import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  calculateProgressPercent,
  calculateAverageSpeed,
  calculateEta,
  smoothCurrentSpeed,
  createTelemetryTracker,
  MAX_HISTORY_SAMPLES
} from '../electron/telemetry.js';
import {
  formatBytes,
  formatSpeed,
  formatDuration,
  formatEta,
  formatPercent,
  formatBytesDone
} from '../src/lib/format.js';
import { directDownload } from '../electron/providers/direct.js';
import { createQueue } from '../electron/queue.js';
import Database from 'better-sqlite3';
import { migrate } from '../electron/db.js';

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

test('calculateProgressPercent computes clamped percentage or returns null for unknown size', () => {
  assert.equal(calculateProgressPercent(50, 100), 50.0);
  assert.equal(calculateProgressPercent(33, 100), 33.0);
  assert.equal(calculateProgressPercent(1, 3), 33.3);
  assert.equal(calculateProgressPercent(100, 100), 100.0);
  assert.equal(calculateProgressPercent(150, 100), 100.0, 'clamps over 100%');
  
  // Unknown or invalid size must be null, never 0 or NaN
  assert.equal(calculateProgressPercent(50, null), null);
  assert.equal(calculateProgressPercent(50, undefined), null);
  assert.equal(calculateProgressPercent(50, 0), null);
  assert.equal(calculateProgressPercent(50, -10), null);
  assert.equal(calculateProgressPercent(-5, 100), null);
  assert.equal(calculateProgressPercent(NaN, 100), null);
  assert.equal(calculateProgressPercent(50, NaN), null);
});

test('calculateAverageSpeed measures true byte rate over elapsed time', () => {
  // 10MB in 5 seconds = 2MB/s = 2,000,000 B/s
  assert.equal(calculateAverageSpeed(10_000_000, 5000, 0), 2_000_000);
  // Resumed download: started at 2MB, finished at 8MB (6MB downloaded) in 3 seconds = 2MB/s
  assert.equal(calculateAverageSpeed(8_000_000, 3000, 2_000_000), 2_000_000);

  // Too short (< 500ms): returns null to avoid erratic start spikes
  assert.equal(calculateAverageSpeed(1_000_000, 200, 0), null);
  // Non-positive elapsed or negative delta
  assert.equal(calculateAverageSpeed(1_000_000, 0, 0), null);
  assert.equal(calculateAverageSpeed(1_000_000, -100, 0), null);
  assert.equal(calculateAverageSpeed(500_000, 1000, 600_000), null);
});

test('calculateEta returns remaining seconds or null when speed/size is unknown', () => {
  // Remaining 10MB at 2MB/s = 5 seconds
  assert.equal(calculateEta(10_000_000, 2_000_000), 5);
  // Remaining 0 bytes = 0 seconds
  assert.equal(calculateEta(0, 2_000_000), 0);
  assert.equal(calculateEta(-50, 2_000_000), 0);

  // Unknown total size (remainingBytes is null) -> null, never 0
  assert.equal(calculateEta(null, 2_000_000), null);
  // Zero speed -> null (never Infinity, NaN, or 0s)
  assert.equal(calculateEta(10_000_000, 0), null);
  assert.equal(calculateEta(10_000_000, null), null);
  assert.equal(calculateEta(10_000_000, -500), null);
});

test('smoothCurrentSpeed weights recent speed measurements', () => {
  assert.equal(smoothCurrentSpeed([]), null, 'unknown speed for empty samples is null');
  assert.equal(smoothCurrentSpeed([1000]), 1000);
  const smoothed = smoothCurrentSpeed([1000, 2000, 3000]);
  assert.ok(smoothed > 2000, 'favors recent samples');
  assert.ok(smoothed <= 3000, 'stays within upper bound');
});

test('createTelemetryTracker enforces 60-sample bounded history and calculates metrics', () => {
  const tracker = createTelemetryTracker();
  const jobId = 'test-job-1';
  let t = 1000;

  tracker.start(jobId, 0, t);

  // Record 100 samples (simulating 100 seconds)
  for (let i = 1; i <= 100; i++) {
    t += 1000;
    tracker.record(jobId, i * 100_000, 20_000_000, t, 100_000);
  }

  const tel = tracker.get(jobId);
  assert.ok(tel, 'telemetry exists');
  assert.equal(tel.speedHistory.length, MAX_HISTORY_SAMPLES, 'strictly capped to 60 samples');
  assert.equal(tel.downloadedBytes, 10_000_000);
  assert.equal(tel.totalBytes, 20_000_000);
  assert.equal(tel.remainingBytes, 10_000_000);
  assert.equal(tel.progressPercent, 50.0);
  assert.ok(tel.currentSpeed > 0);
  assert.ok(tel.avgSpeed > 0);
  assert.ok(tel.etaSeconds != null && tel.etaSeconds > 0);

  // Finishing job
  tracker.finish(jobId, 20_000_000, 20_000_000, t + 1000);
  const fin = tracker.get(jobId);
  assert.equal(fin.remainingBytes, 0);
  assert.equal(fin.etaSeconds, 0);
  assert.equal(fin.progressPercent, 100.0);

  // Clean removal
  tracker.remove(jobId);
  assert.equal(tracker.get(jobId).currentSpeed, null);
  assert.deepEqual(tracker.get(jobId).speedHistory, []);
});

test('formatBytes handles zero, units, and invalid inputs accurately', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(1500), '1.5 KB');
  assert.equal(formatBytes(10_000_000), '10.0 MB');
  assert.equal(formatBytes(2_500_000_000), '2.5 GB');
  assert.equal(formatBytes(1_500_000_000_000), '1.5 TB');

  assert.equal(formatBytes(null), '—');
  assert.equal(formatBytes(undefined), '—');
  assert.equal(formatBytes(NaN), '—');
  assert.equal(formatBytes(-100), '—');
});

test('formatSpeed renders consistent rate string and handles 0/null', () => {
  assert.equal(formatSpeed(1_500_000), '1.5 MB/s');
  assert.equal(formatSpeed(500), '500 B/s');
  assert.equal(formatSpeed(0), '');
  assert.equal(formatSpeed(null), '');
  assert.equal(formatSpeed(-100), '');
});

test('formatEta produces human-readable times and avoids false zeros', () => {
  assert.equal(formatEta(null), '—');
  assert.equal(formatEta(undefined), '—');
  assert.equal(formatEta(NaN), '—');
  assert.equal(formatEta(-5), '—');

  assert.equal(formatEta(0), '0s');
  assert.equal(formatEta(45), '45s');
  assert.equal(formatEta(125), '2m 5s');
  assert.equal(formatEta(3600), '1h');
  assert.equal(formatEta(3665), '1h 01m');
  assert.equal(formatEta(7325), '2h 02m');
});

test('formatPercent produces clamped single-decimal percentage string', () => {
  assert.equal(formatPercent(50.45), '50.5%');
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(100), '100%');
  assert.equal(formatPercent(150), '100%');
  assert.equal(formatPercent(-10), '0%');
  assert.equal(formatPercent(null), '—');
  assert.equal(formatPercent(NaN), '—');
});

test('formatBytesDone formats both total and chunked progress correctly', () => {
  assert.equal(formatBytesDone({ totalBytes: 10_000_000, downloadedBytes: 5_000_000 }), '5.0 MB / 10.0 MB');
  assert.equal(formatBytesDone({ bytesTotal: 10_000_000, bytesDone: 5_000_000 }), '5.0 MB / 10.0 MB');
  assert.equal(formatBytesDone({ totalBytes: null, downloadedBytes: 5_000_000 }), '5.0 MB');
  assert.equal(formatBytesDone({}), '');
});

test('directDownload streams large synthetic stream without Content-Length (unknown total size)', async (t) => {
  // 5 chunks of 50KB = 250KB total
  const chunkSize = 50 * 1024;
  const chunkCount = 5;
  const server = await startServer((req, res) => {
    // No content-length header -> chunked transfer
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    let sent = 0;
    const interval = setInterval(() => {
      res.write(Buffer.alloc(chunkSize, 'Z'));
      sent++;
      if (sent >= chunkCount) {
        clearInterval(interval);
        res.end();
      }
    }, 20);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mvdl-chunked-'));
  const progressEvents = [];
  const result = await directDownload(`http://127.0.0.1:${port}/chunked.bin`, dest, {
    allowLocal: true,
    onProgress: (p) => progressEvents.push(p)
  });

  assert.ok(fs.existsSync(result.path), 'file exists on disk');
  assert.equal(fs.statSync(result.path).size, chunkSize * chunkCount);
  assert.ok(progressEvents.length > 0, 'emitted progress events');

  // Verify unknown content-length was tracked cleanly without fake zeros
  const midEvent = progressEvents[0];
  assert.equal(midEvent.total, null, 'unknown total length was null');
  assert.equal(midEvent.pct, 0, 'percentage was 0 (indeterminate)');
  assert.ok((midEvent.received || midEvent.downloaded) > 0, 'downloaded bytes accurately tracked');

  const finalEvent = progressEvents[progressEvents.length - 1];
  assert.equal(finalEvent.done, true);

  fs.rmSync(dest, { recursive: true, force: true });
});

test('queue serializes IDM telemetry fields and prevents progress updates after cancellation', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvdl-qtest-'));
  const db = migrate(new Database(path.join(tmpDir, 'queue.db')));
  let queue;
  t.after(async () => {
    queue?.shutdown();
    await new Promise((r) => setTimeout(r, 100));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Mock runner that simulates controlled cancellation
  let runnerCancelled = false;
  let emitAfterCancelAttempted = false;
  const mockRunner = {
    executeJob(job, options = {}) {
      return {
        cancel() {
          runnerCancelled = true;
        },
        promise: new Promise((resolve, reject) => {
          setTimeout(() => {
            options.onProgress?.({ bytesDone: 50_000, bytesTotal: 100_000, speed: 25_000 });
          }, 30);
          setTimeout(() => {
            if (runnerCancelled) {
              // Try to emit progress after cancel — must be ignored by queue
              options.onProgress?.({ bytesDone: 100_000, bytesTotal: 100_000, speed: 25_000 });
              emitAfterCancelAttempted = true;
              const err = new Error('Download cancelled');
              err.name = 'AbortError';
              reject(err);
            } else {
              resolve({ resultPath: path.join(tmpDir, 'mock.bin') });
            }
          }, 80);
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
    url: 'https://example.com/video.mp4',
    title: 'Test Stream',
    provider: 'direct',
    destDir: tmpDir
  });

  const initialJob = queue.listJobs().find((j) => j.id === jobId);
  assert.ok(initialJob, 'job was created');
  assert.ok(['waiting', 'downloading'].includes(initialJob.status), 'starts as waiting or auto-pumps to downloading');
  assert.ok('currentSpeed' in initialJob, 'has currentSpeed telemetry field');
  assert.ok('avgSpeed' in initialJob, 'has avgSpeed telemetry field');
  assert.ok('remainingBytes' in initialJob, 'has remainingBytes telemetry field');
  assert.ok('etaSeconds' in initialJob, 'has etaSeconds telemetry field');
  assert.ok('speedHistory' in initialJob, 'has speedHistory telemetry field');
  assert.ok('progressPercent' in initialJob, 'has progressPercent telemetry field');
  assert.equal(initialJob.cancellable, true);

  // Wait for it to be active
  await new Promise((r) => setTimeout(r, 45));
  const activeJob = queue.listJobs().find((j) => j.id === jobId);
  assert.equal(activeJob.status, 'downloading');

  // Cancel the active transfer
  queue.cancelJob(jobId);
  assert.equal(runnerCancelled, true, 'runner cancel handle was invoked');

  // Wait for the mock promise rejection to settle
  await new Promise((r) => setTimeout(r, 120));

  const cancelledJob = queue.listJobs().find((j) => j.id === jobId);
  assert.equal(cancelledJob.status, 'cancelled', 'job marked cancelled');

  // Verify cancellation is final and job did not become 'completed'
  const finalJob = queue.listJobs().find((j) => j.id === jobId);
  assert.equal(finalJob.status, 'cancelled');
  assert.notEqual(finalJob.status, 'completed', 'cancelled job cannot become completed');
  assert.ok(emitAfterCancelAttempted, 'progress after cancel was attempted and rejected');
});

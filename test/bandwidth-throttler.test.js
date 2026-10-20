import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  calculateEffectiveBandwidthLimit,
  createBandwidthThrottler
} from '../electron/bandwidth.js';

test('bandwidth: calculateEffectiveBandwidthLimit explicit rules', () => {
  // Unlimited mode (both 0 or null)
  assert.equal(calculateEffectiveBandwidthLimit(0, 0), 0);
  assert.equal(calculateEffectiveBandwidthLimit(null, undefined), 0);
  assert.equal(calculateEffectiveBandwidthLimit(-50, 0), 0);

  // Global only
  assert.equal(calculateEffectiveBandwidthLimit(50000, 0), 50000);
  assert.equal(calculateEffectiveBandwidthLimit(50000, null), 50000);

  // Task only
  assert.equal(calculateEffectiveBandwidthLimit(0, 30000), 30000);
  assert.equal(calculateEffectiveBandwidthLimit(null, 30000), 30000);

  // Both set: effective limit is min(global, task)
  assert.equal(calculateEffectiveBandwidthLimit(50000, 30000), 30000);
  assert.equal(calculateEffectiveBandwidthLimit(20000, 80000), 20000);
  assert.equal(calculateEffectiveBandwidthLimit(40000, 40000), 40000);
});

test('bandwidth: unlimited mode passes data through with zero delay', async () => {
  const throttler = createBandwidthThrottler({ bytesPerSecond: 0 });
  const inputChunks = [Buffer.from('hello '), Buffer.from('world!'), Buffer.from(' MantiCollect')];
  const out = [];

  const source = Readable.from(inputChunks);
  const sink = new Writable({
    write(chunk, enc, cb) {
      out.push(chunk);
      cb();
    }
  });

  const t0 = Date.now();
  await pipeline(source, throttler, sink);
  const elapsed = Date.now() - t0;

  assert.equal(Buffer.concat(out).toString('utf8'), 'hello world! MantiCollect');
  assert.ok(elapsed < 200, `Unlimited transfer should complete quickly, elapsed: ${elapsed}ms`);
});

test('bandwidth: throttler paces throughput approximately to configured rate', async () => {
  // 50 KB/s rate limit
  const rateLimit = 50 * 1024;
  const throttler = createBandwidthThrottler({ bytesPerSecond: rateLimit });

  // 150 KB total data (should take ~2.5 - 3.5 seconds)
  // To keep test fast and deterministic, let's use 20 KB total data at 20 KB/s rate limit -> ~1 second
  const smallRate = 20 * 1024;
  const smallThrottler = createBandwidthThrottler({ bytesPerSecond: smallRate });
  const chunk = Buffer.alloc(5 * 1024, 0xaa); // 5 KB
  const totalChunks = 3; // 15 KB total data

  const source = new Readable({
    read() {
      if (this.count === undefined) this.count = 0;
      if (this.count < totalChunks) {
        this.count++;
        this.push(chunk);
      } else {
        this.push(null);
      }
    }
  });

  let receivedBytes = 0;
  const sink = new Writable({
    write(c, enc, cb) {
      receivedBytes += c.length;
      cb();
    }
  });

  const t0 = Date.now();
  await pipeline(source, smallThrottler, sink);
  const elapsed = Date.now() - t0;

  assert.equal(receivedBytes, totalChunks * chunk.length);
  // Transferring 15KB at 20KB/s takes roughly 750ms
  assert.ok(elapsed >= 400, `Throttled transfer should take at least 400ms, took ${elapsed}ms`);
});

test('bandwidth: abortSignal cancels throttler and cleans up timers cleanly', async () => {
  const controller = new AbortController();
  const throttler = createBandwidthThrottler({
    bytesPerSecond: 1024, // 1 KB/s (very slow)
    abortSignal: controller.signal
  });

  const source = new Readable({
    read() {
      this.push(Buffer.alloc(10 * 1024, 0xbb)); // 10 KB
    }
  });

  const sink = new Writable({
    write(c, enc, cb) {
      cb();
    }
  });

  // Abort after 80ms
  setTimeout(() => controller.abort(), 80);

  await assert.rejects(
    async () => pipeline(source, throttler, sink),
    (err) => err.name === 'AbortError' || err.code === 'ABORT_ERR' || /abort/i.test(err.message)
  );

  assert.equal(throttler.destroyed, true);
});

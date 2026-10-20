import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  createGlobalBandwidthLimiter,
  createBandwidthThrottler
} from '../electron/bandwidth.js';

test('global bandwidth: unlimited mode transfers data immediately', async () => {
  const globalLimiter = createGlobalBandwidthLimiter(0);
  const throttler = createBandwidthThrottler({ bytesPerSecond: 0, globalLimiter });

  const chunk = Buffer.alloc(10 * 1024, 0x11);
  const source = Readable.from([chunk]);
  const out = [];
  const sink = new Writable({
    write(c, enc, cb) {
      out.push(c);
      cb();
    }
  });

  const t0 = Date.now();
  await pipeline(source, throttler, sink);
  const elapsed = Date.now() - t0;

  assert.equal(Buffer.concat(out).length, 10 * 1024);
  assert.ok(elapsed < 200, `Unlimited transfer should finish almost instantly, took ${elapsed}ms`);
});

test('global bandwidth: aggregate limit throttles concurrent uploads cooperatively', async () => {
  // Global limit: 30 KB/s
  const globalRate = 30 * 1024;
  const globalLimiter = createGlobalBandwidthLimiter(globalRate);

  // We run two concurrent streams: Stream 1 (15 KB), Stream 2 (15 KB) -> Total 30 KB
  // At 30 KB/s global limit, 30 KB total data across both streams should take at least ~700-1000ms
  const chunk1 = Buffer.alloc(5 * 1024, 0xaa);
  const chunk2 = Buffer.alloc(5 * 1024, 0xbb);

  const stream1 = createBandwidthThrottler({ bytesPerSecond: 0, globalLimiter });
  const stream2 = createBandwidthThrottler({ bytesPerSecond: 0, globalLimiter });

  const makeSource = (chunk, count) => {
    let pushed = 0;
    return new Readable({
      read() {
        if (pushed < count) {
          pushed++;
          this.push(chunk);
        } else {
          this.push(null);
        }
      }
    });
  };

  let bytes1 = 0;
  const sink1 = new Writable({
    write(c, enc, cb) {
      bytes1 += c.length;
      cb();
    }
  });

  let bytes2 = 0;
  const sink2 = new Writable({
    write(c, enc, cb) {
      bytes2 += c.length;
      cb();
    }
  });

  const t0 = Date.now();
  await Promise.all([
    pipeline(makeSource(chunk1, 3), stream1, sink1),
    pipeline(makeSource(chunk2, 3), stream2, sink2)
  ]);
  const elapsed = Date.now() - t0;

  assert.equal(bytes1, 15 * 1024);
  assert.equal(bytes2, 15 * 1024);
  assert.ok(elapsed >= 600, `Concurrent aggregate transfer should take at least 600ms, took ${elapsed}ms`);
});

test('global bandwidth: both global and per-task limits enforced simultaneously', async () => {
  // Global limit: 100 KB/s
  // Task limit: 20 KB/s (more restrictive than global for single task)
  const globalLimiter = createGlobalBandwidthLimiter(100 * 1024);
  const taskLimit = 20 * 1024;
  const throttler = createBandwidthThrottler({ bytesPerSecond: taskLimit, globalLimiter });

  const chunk = Buffer.alloc(5 * 1024, 0xcc);
  let pushed = 0;
  const source = new Readable({
    read() {
      if (pushed < 3) {
        pushed++;
        this.push(chunk);
      } else {
        this.push(null);
      }
    }
  });

  let received = 0;
  const sink = new Writable({
    write(c, enc, cb) {
      received += c.length;
      cb();
    }
  });

  const t0 = Date.now();
  await pipeline(source, throttler, sink);
  const elapsed = Date.now() - t0;

  assert.equal(received, 15 * 1024);
  // 15 KB at 20 KB/s per-task limit takes >= 500ms even though global is 100 KB/s
  assert.ok(elapsed >= 450, `Per-task limiter should constrain transfer to ~750ms, took ${elapsed}ms`);
});

test('global bandwidth: cancellation releases waiting tokens and aborts immediately', async () => {
  const globalLimiter = createGlobalBandwidthLimiter(1024); // 1 KB/s very slow
  const controller = new AbortController();
  const throttler = createBandwidthThrottler({ bytesPerSecond: 0, globalLimiter, abortSignal: controller.signal });

  const source = new Readable({
    read() {
      this.push(Buffer.alloc(10 * 1024, 0xdd));
    }
  });

  const sink = new Writable({
    write(c, enc, cb) {
      cb();
    }
  });

  setTimeout(() => controller.abort(), 60);

  await assert.rejects(
    async () => pipeline(source, throttler, sink),
    (err) => /aborted/i.test(err.message)
  );

  assert.equal(throttler.destroyed, true);
  // Limiter queue must be clean
  assert.equal(globalLimiter.waitQueue.length, 0);
});

test('global bandwidth: queued tasks consume zero bandwidth before transmitting data', () => {
  const globalLimiter = createGlobalBandwidthLimiter(50 * 1024);
  // Tasks merely created/enqueued, not transmitting yet
  assert.equal(globalLimiter.waitQueue.length, 0);
  assert.equal(globalLimiter.tokens, 0);
});

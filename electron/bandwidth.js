import { Transform } from 'node:stream';

/**
 * Calculates the effective rate limit from global and task-specific settings.
 * Maintained for backward compatibility.
 *
 * @param {number} globalLimitBytesPerSec
 * @param {number} taskLimitBytesPerSec
 * @returns {number} Effective limit in bytes per second (0 = unlimited)
 */
export function calculateEffectiveBandwidthLimit(globalLimitBytesPerSec = 0, taskLimitBytesPerSec = 0) {
  const g = Number(globalLimitBytesPerSec) > 0 ? Number(globalLimitBytesPerSec) : 0;
  const t = Number(taskLimitBytesPerSec) > 0 ? Number(taskLimitBytesPerSec) : 0;

  if (g > 0 && t > 0) return Math.min(g, t);
  if (g > 0) return g;
  if (t > 0) return t;
  return 0; // Unlimited
}

/**
 * Shared Global Bandwidth Limiter (Token Bucket).
 * Regulates aggregate throughput across multiple concurrent streams.
 */
export class GlobalBandwidthLimiter {
  constructor(bytesPerSec = 0) {
    this.rateLimit = Number(bytesPerSec) > 0 ? Number(bytesPerSec) : 0;
    this.tokens = 0; // Starts at 0 so pacing takes effect from the first chunk
    this.lastRefill = Date.now();
    this.waitQueue = [];
    this.refillTimer = null;
  }

  setRateLimit(bytesPerSec) {
    const newRate = Number(bytesPerSec) > 0 ? Number(bytesPerSec) : 0;
    this.rateLimit = newRate;
    if (this.rateLimit <= 0) {
      if (this.refillTimer) {
        clearTimeout(this.refillTimer);
        this.refillTimer = null;
      }
      while (this.waitQueue.length > 0) {
        const req = this.waitQueue.shift();
        req.cleanup();
        req.resolve();
      }
    } else {
      this.refill();
      this.scheduleRefill();
    }
  }

  getRateLimit() {
    return this.rateLimit;
  }

  refill() {
    const now = Date.now();
    const elapsed = Math.max(0, (now - this.lastRefill) / 1000);
    this.lastRefill = now;
    if (this.rateLimit > 0) {
      this.tokens = Math.min(this.rateLimit, this.tokens + (elapsed * this.rateLimit));
    }
  }

  scheduleRefill() {
    if (this.refillTimer || this.waitQueue.length === 0 || this.rateLimit <= 0) return;

    this.refill();

    while (this.waitQueue.length > 0 && this.tokens >= this.waitQueue[0].bytesNeeded) {
      const req = this.waitQueue.shift();
      this.tokens -= req.bytesNeeded;
      req.cleanup();
      req.resolve();
    }

    if (this.waitQueue.length === 0) return;

    const needed = Math.max(0, this.waitQueue[0].bytesNeeded - this.tokens);
    const delayMs = Math.max(5, Math.ceil((needed / this.rateLimit) * 1000));

    this.refillTimer = setTimeout(() => {
      this.refillTimer = null;
      this.scheduleRefill();
    }, delayMs);
  }

  async consume(bytes, abortSignal = null) {
    if (this.rateLimit <= 0 || bytes <= 0) return;

    if (abortSignal?.aborted) {
      throw new Error('Transfer aborted by user');
    }

    this.refill();

    if (this.waitQueue.length === 0 && this.tokens >= bytes) {
      this.tokens -= bytes;
      return;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let onAbort = null;

      const cleanup = () => {
        if (abortSignal && onAbort) {
          abortSignal.removeEventListener('abort', onAbort);
        }
      };

      const req = {
        bytesNeeded: bytes,
        resolve: () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        },
        reject: (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        },
        cleanup
      };

      if (abortSignal) {
        onAbort = () => {
          const idx = this.waitQueue.indexOf(req);
          if (idx !== -1) {
            this.waitQueue.splice(idx, 1);
          }
          req.reject(new Error('Transfer aborted by user'));
        };
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      this.waitQueue.push(req);
      this.scheduleRefill();
    });
  }

  reset() {
    if (this.refillTimer) {
      clearTimeout(this.refillTimer);
      this.refillTimer = null;
    }
    while (this.waitQueue.length > 0) {
      const req = this.waitQueue.shift();
      req.cleanup();
      req.reject(new Error('Limiter reset'));
    }
    this.tokens = 0;
    this.lastRefill = Date.now();
  }
}

export function createGlobalBandwidthLimiter(bytesPerSec = 0) {
  return new GlobalBandwidthLimiter(bytesPerSec);
}

let _defaultGlobalLimiter = null;
export function getGlobalUploadLimiter() {
  if (!_defaultGlobalLimiter) {
    _defaultGlobalLimiter = new GlobalBandwidthLimiter(0);
  }
  return _defaultGlobalLimiter;
}

/**
 * Creates a rate-limiting Transform stream.
 *
 * Supports both shared global rate limit and per-task rate limit simultaneously.
 *
 * @param {Object} options
 * @param {number} [options.bytesPerSecond] - Per-task rate limit in bytes per second (0 = unlimited)
 * @param {GlobalBandwidthLimiter} [options.globalLimiter] - Shared global rate limiter instance
 * @param {AbortSignal} [options.abortSignal] - Signal to abort stream
 * @returns {Transform}
 */
export function createBandwidthThrottler({
  bytesPerSecond = 0,
  globalLimiter = null,
  abortSignal = null
} = {}) {
  const perTaskRate = Number(bytesPerSecond) > 0 ? Number(bytesPerSecond) : 0;

  // Passthrough if both global and per-task are unlimited
  if (perTaskRate <= 0 && (!globalLimiter || globalLimiter.getRateLimit() <= 0)) {
    const stream = new Transform({
      transform(chunk, _encoding, callback) {
        if (abortSignal?.aborted) {
          return callback(new Error('Transfer aborted by user'));
        }
        callback(null, chunk);
      }
    });
    return stream;
  }

  let activeTimeout = null;

  const throttler = new Transform({
    async transform(chunk, _encoding, callback) {
      if (abortSignal?.aborted) {
        return callback(new Error('Transfer aborted by user'));
      }

      const chunkLength = chunk.length;

      try {
        // 1. Wait for tokens from shared global limiter if configured
        if (globalLimiter && globalLimiter.getRateLimit() > 0) {
          await globalLimiter.consume(chunkLength, abortSignal);
        }

        // 2. Pace according to per-task rate limit if configured
        if (perTaskRate > 0) {
          const delayMs = Math.max(1, Math.round((chunkLength / perTaskRate) * 1000));
          await new Promise((resolve, reject) => {
            if (abortSignal?.aborted) {
              return reject(new Error('Transfer aborted by user'));
            }

            let onAbort = null;
            activeTimeout = setTimeout(() => {
              activeTimeout = null;
              if (abortSignal && onAbort) {
                abortSignal.removeEventListener('abort', onAbort);
              }
              resolve();
            }, delayMs);

            if (abortSignal) {
              onAbort = () => {
                if (activeTimeout) {
                  clearTimeout(activeTimeout);
                  activeTimeout = null;
                }
                reject(new Error('Transfer aborted by user'));
              };
              abortSignal.addEventListener('abort', onAbort, { once: true });
            }
          });
        }

        callback(null, chunk);
      } catch (err) {
        callback(err);
      }
    },

    flush(callback) {
      if (activeTimeout) {
        clearTimeout(activeTimeout);
        activeTimeout = null;
      }
      callback();
    },

    destroy(err, callback) {
      if (activeTimeout) {
        clearTimeout(activeTimeout);
        activeTimeout = null;
      }
      callback(err);
    }
  });

  if (abortSignal) {
    const onAbort = () => {
      if (activeTimeout) {
        clearTimeout(activeTimeout);
        activeTimeout = null;
      }
      throttler.destroy(new Error('Transfer aborted by user'));
    };

    if (abortSignal.aborted) {
      onAbort();
    } else {
      abortSignal.addEventListener('abort', onAbort, { once: true });
      throttler.once('close', () => {
        abortSignal.removeEventListener('abort', onAbort);
      });
    }
  }

  return throttler;
}


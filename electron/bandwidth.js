import { Transform } from 'node:stream';

/**
 * Calculates the effective rate limit from global and task-specific settings.
 *
 * Rule: The effective limit is the minimum of the positive limits.
 * If only one is specified (> 0), that limit applies.
 * If neither is specified (both <= 0), 0 is returned representing unlimited.
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
 * Creates a rate-limiting Transform stream.
 *
 * Regulates throughput by chunking and delaying buffers based on the configured
 * rate limit (bytes per second).
 *
 * @param {Object} options
 * @param {number} options.bytesPerSecond - Rate limit in bytes per second (0 = unlimited)
 * @param {AbortSignal} [options.abortSignal] - Signal to abort stream
 * @returns {Transform}
 */
export function createBandwidthThrottler({ bytesPerSecond = 0, abortSignal = null } = {}) {
  const rateLimit = Number(bytesPerSecond) > 0 ? Number(bytesPerSecond) : 0;

  // Passthrough if unlimited
  if (rateLimit <= 0) {
    const stream = new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      }
    });
    return stream;
  }

  let activeTimeout = null;

  const throttler = new Transform({
    transform(chunk, _encoding, callback) {
      if (abortSignal?.aborted) {
        return callback(new Error('Transfer aborted by user'));
      }

      const chunkLength = chunk.length;
      // Calculate delay in milliseconds required to sustain the rate limit for this chunk
      const delayMs = Math.max(1, Math.round((chunkLength / rateLimit) * 1000));

      activeTimeout = setTimeout(() => {
        activeTimeout = null;
        if (abortSignal?.aborted) {
          return callback(new Error('Transfer aborted by user'));
        }
        callback(null, chunk);
      }, delayMs);
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

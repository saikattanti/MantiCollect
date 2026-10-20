/**
 * Download Telemetry Engine.
 * Provides smoothed current speed, overall average transfer speed,
 * reliable ETA calculation, and a rolling 60-second speed history buffer.
 *
 * Real measurements only:
 * - Unknown total size is represented as null (never 0 B).
 * - Unknown speed is represented as null (never 0 B/s).
 * - Unknown ETA is represented as null (never 0 s).
 * - Percentage is calculated only when total bytes is known and valid.
 */

export const MAX_HISTORY_SAMPLES = 60; // 60 seconds rolling window

/**
 * Calculate progress percentage clamped to 0..100 with 1 decimal place,
 * or null if total bytes is unknown or non-positive.
 */
export function calculateProgressPercent(bytesDone, bytesTotal) {
  if (bytesTotal == null || Number.isNaN(bytesTotal) || bytesTotal <= 0) return null;
  if (bytesDone == null || Number.isNaN(bytesDone) || bytesDone < 0) return null;
  if (bytesDone === 0) return 0;
  const pct = (bytesDone / bytesTotal) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
}

/**
 * Calculate average transfer speed in bytes per second.
 * Elapsed time must be at least 500ms; returns null if not enough time elapsed.
 */
export function calculateAverageSpeed(bytesDone, elapsedMs, initialBytes = 0) {
  const transferred = bytesDone != null && initialBytes != null ? bytesDone - initialBytes : bytesDone;
  if (transferred == null || transferred < 0) return null;
  if (!elapsedMs || elapsedMs < 500) return null;
  const bps = (transferred / elapsedMs) * 1000;
  return Math.max(0, Math.round(bps));
}

/**
 * Calculate ETA in seconds from remaining bytes and current transfer speed.
 * Returns null if remaining bytes or speed is unavailable, zero, or negative.
 */
export function calculateEta(remainingBytes, speedBps) {
  if (remainingBytes == null || Number.isNaN(remainingBytes)) return null;
  if (remainingBytes <= 0) return 0;
  if (speedBps == null || speedBps <= 0) return null;
  const sec = Math.round(remainingBytes / speedBps);
  return Number.isFinite(sec) && sec >= 0 ? sec : null;
}

/**
 * Smooth recent speed samples over a short window (e.g. 2-4 seconds)
 * using a weighted moving average to favor recent measurements while
 * filtering transient noise.
 */
export function smoothCurrentSpeed(samples) {
  if (!samples || !samples.length) return null;
  const recent = samples.slice(-4);
  let totalWeight = 0;
  let weightedSum = 0;
  for (let i = 0; i < recent.length; i++) {
    const s = recent[i];
    const speed = typeof s === 'number' ? s : (s.speed || 0);
    const weight = i + 1;
    weightedSum += speed * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.max(0, Math.round(weightedSum / totalWeight)) : null;
}

/**
 * Factory for the in-memory telemetry tracker.
 */
export function createTelemetryTracker() {
  const jobs = new Map();

  function start(id, opts = {}) {
    let initialBytes = 0;
    let bytesTotal = null;
    let startedAt = Date.now();

    if (typeof opts === 'number' || arguments.length > 2) {
      initialBytes = opts || 0;
      startedAt = arguments[2] || Date.now();
      bytesTotal = arguments[3] || null;
    } else if (typeof opts === 'object') {
      initialBytes = opts.initialBytes || 0;
      bytesTotal = opts.bytesTotal || null;
      startedAt = opts.startedAt || Date.now();
    }

    jobs.set(id, {
      startedAt,
      initialBytes: initialBytes || 0,
      bytesDone: initialBytes || 0,
      bytesTotal: bytesTotal && bytesTotal > 0 ? bytesTotal : null,
      lastTickTime: startedAt,
      lastTickBytes: initialBytes || 0,
      currentSpeed: null,
      avgSpeed: null,
      etaSeconds: null,
      samples: [], // [{ timestamp, speed }]
      lastSampleTime: 0
    });
  }

  function record(id, opts = {}) {
    let bytesDone = null;
    let bytesTotal = null;
    let providerSpeed = null;
    let timestamp = Date.now();

    if (typeof opts === 'number' || arguments.length > 2) {
      bytesDone = opts;
      bytesTotal = arguments[2] ?? null;
      timestamp = arguments[3] ?? Date.now();
      providerSpeed = arguments[4] ?? null;
    } else if (typeof opts === 'object') {
      bytesDone = opts.bytesDone ?? null;
      bytesTotal = opts.bytesTotal ?? null;
      providerSpeed = opts.providerSpeed ?? null;
      timestamp = opts.timestamp ?? Date.now();
    }

    let state = jobs.get(id);
    if (!state) {
      start(id, { bytesTotal, initialBytes: bytesDone || 0, startedAt: timestamp });
      state = jobs.get(id);
    }

    if (bytesTotal != null && bytesTotal > 0) {
      state.bytesTotal = bytesTotal;
    }
    if (bytesDone != null && bytesDone >= 0) {
      state.bytesDone = bytesDone;
    }

    const elapsedTotalMs = Math.max(0, timestamp - state.startedAt);
    const transferred = Math.max(0, state.bytesDone - state.initialBytes);

    // Calculate instantaneous speed sample
    let instantaneousSpeed = null;
    if (providerSpeed != null && providerSpeed >= 0) {
      instantaneousSpeed = providerSpeed;
    } else {
      const dt = timestamp - state.lastTickTime;
      const db = state.bytesDone - state.lastTickBytes;
      if (dt >= 400 && db >= 0) {
        instantaneousSpeed = (db / dt) * 1000;
        state.lastTickTime = timestamp;
        state.lastTickBytes = state.bytesDone;
      }
    }

    // Record into rolling 60s sample buffer (sampled roughly once every ~900-1000ms)
    if (instantaneousSpeed != null && (timestamp - state.lastSampleTime >= 900 || state.samples.length === 0)) {
      state.samples.push({
        timestamp,
        speed: Math.max(0, Math.round(instantaneousSpeed))
      });
      if (state.samples.length > MAX_HISTORY_SAMPLES) {
        state.samples.shift();
      }
      state.lastSampleTime = timestamp;
    }

    // Calculate smoothed current speed
    if (state.samples.length > 0) {
      state.currentSpeed = smoothCurrentSpeed(state.samples);
    } else if (instantaneousSpeed != null) {
      state.currentSpeed = Math.max(0, Math.round(instantaneousSpeed));
    }

    // Calculate average speed
    state.avgSpeed = calculateAverageSpeed(transferred, elapsedTotalMs);

    // Calculate ETA
    const remaining = state.bytesTotal != null && state.bytesTotal > state.bytesDone ? state.bytesTotal - state.bytesDone : null;
    state.etaSeconds = calculateEta(remaining, state.currentSpeed);
  }

  function get(id) {
    const state = jobs.get(id);
    if (!state) {
      return {
        currentSpeed: null,
        avgSpeed: null,
        remainingBytes: null,
        etaSeconds: null,
        speedHistory: [],
        progressPercent: null
      };
    }

    const remaining = state.bytesTotal != null ? Math.max(0, state.bytesTotal - state.bytesDone) : null;

    return {
      currentSpeed: state.currentSpeed,
      avgSpeed: state.avgSpeed,
      downloadedBytes: state.bytesDone,
      totalBytes: state.bytesTotal,
      remainingBytes: remaining,
      etaSeconds: state.etaSeconds,
      speedHistory: state.samples.map((s) => ({ timestamp: s.timestamp, speed: s.speed })),
      progressPercent: calculateProgressPercent(state.bytesDone, state.bytesTotal)
    };
  }

  function finish(id, finalBytes = null, totalBytes = null) {
    const state = jobs.get(id);
    if (!state) return;
    if (finalBytes != null) state.bytesDone = finalBytes;
    if (totalBytes != null) state.bytesTotal = totalBytes;
    if (state.bytesTotal != null && state.bytesDone < state.bytesTotal) {
      state.bytesDone = state.bytesTotal;
    }
    state.currentSpeed = 0;
    state.etaSeconds = 0;
    // Keep history snapshot until remove is called
  }

  function remove(id) {
    jobs.delete(id);
  }

  return {
    start,
    record,
    get,
    finish,
    remove
  };
}

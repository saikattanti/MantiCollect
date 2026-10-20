import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { JOB_STATUSES } from './db.js';
import { logger } from './logger.js';
import { executeJob } from './runner.js';
import { loadSettings } from './settings.js';
import { createTelemetryTracker } from './telemetry.js';

const ACTIVE = new Set(['waiting', 'fetching_metadata', 'downloading', 'resuming', 'pausing', 'processing']);

export function publicJob(row, telemetry = null) {
  let extra = null;
  try {
    extra = JSON.parse(row.extra || 'null');
  } catch {}

  const t = telemetry?.get(row.id) || {
    currentSpeed: null,
    avgSpeed: null,
    remainingBytes: null,
    etaSeconds: null,
    speedHistory: [],
    progressPercent: null
  };

  const bytesTotal = row.bytes_total && row.bytes_total > 0 ? row.bytes_total : null;
  const bytesDone = row.bytes_done != null ? row.bytes_done : 0;
  const remainingBytes = t.remainingBytes != null ? t.remainingBytes : (bytesTotal != null && bytesTotal > bytesDone ? bytesTotal - bytesDone : null);
  const progressPercent = t.progressPercent != null ? t.progressPercent : (bytesTotal != null && bytesTotal > 0 ? Math.min(100, Math.max(0, Math.round((bytesDone / bytesTotal) * 1000) / 10)) : null);

  // Fallback speed from DB row if telemetry hasn't sampled yet
  const isJobActive = ACTIVE.has(row.status);
  const currentSpeed = isJobActive
    ? (t.currentSpeed != null ? t.currentSpeed : (row.speed != null && row.speed > 0 ? Math.round(row.speed) : null))
    : 0;
  const filename = row.result_path ? path.basename(row.result_path) : (extra?.filename || null);

  return {
    id: row.id,
    url: row.url,
    sourceUrl: row.url,
    provider: row.provider,
    providerId: row.provider,
    kind: row.kind,
    title: row.title,
    filename,
    format: row.format,
    destDir: row.dest_dir,
    destination: row.dest_dir || (row.result_path ? path.dirname(row.result_path) : null),
    status: row.status,
    progress: row.progress,
    progressPercent,
    bytesDone: row.bytes_done,
    downloadedBytes: row.bytes_done,
    bytesTotal,
    totalBytes: bytesTotal,
    remainingBytes,
    speed: currentSpeed,
    currentSpeed,
    currentSpeedBytesPerSecond: currentSpeed,
    avgSpeed: t.avgSpeed,
    averageSpeedBytesPerSecond: t.avgSpeed,
    etaSeconds: t.etaSeconds,
    speedHistory: t.speedHistory || [],
    error: row.error,
    errorMessage: row.error,
    resultPath: row.result_path,
    collectionId: row.collection_id,
    thumbnail: extra && typeof extra.thumbnail === 'string' ? extra.thumbnail.slice(0, 2000) : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cancellable: ['waiting', 'downloading', 'processing', 'fetching_metadata', 'pausing', 'paused', 'resuming'].includes(row.status),
    pausable: ['downloading', 'resuming'].includes(row.status),
    resumable: row.status === 'paused' || (row.status === 'failed' && !!row.partial_path),
    partialPath: row.partial_path || null
  };
}

/**
 * Persistent download queue backed by SQLite with in-memory telemetry tracking.
 * - Concurrency from settings (1..8)
 * - Jobs survive restarts: interrupted active jobs return to 'waiting'
 * - Telemetry provides smoothed current speed, average speed, ETA, and 60s history.
 * - Progress events are throttled (DB writes >=400ms apart, UI >=250ms).
 */
export function createQueue({
  getWindow,
  getSettings = loadSettings,
  getDbInstance = getDb,
  executeJobFn = executeJob
} = {}) {
  const db = () => getDbInstance();
  const running = new Map(); // id -> handle
  const lastDbWrite = new Map();
  const telemetry = createTelemetryTracker();
  let emitTimer = null;

  function rows() {
    return db().prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 500').all();
  }

  function broadcast() {
    const win = getWindow?.();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send('jobs:updated', rows().map((r) => publicJob(r, telemetry)));
      } catch {}
    }
  }

  function scheduleEmit() {
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      broadcast();
    }, 250);
  }

  function persist(id, fields) {
    const sets = Object.keys(fields).map((k) => `${k} = ?`);
    if (!sets.length) return;
    db().prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(fields), id);
  }

  function throttleDb(id) {
    const now = Date.now();
    const last = lastDbWrite.get(id) || 0;
    if (now - last >= 400) {
      lastDbWrite.set(id, now);
      return true;
    }
    return false;
  }

  function listJobs() {
    return rows().map((r) => publicJob(r, telemetry));
  }

  function startJob({ url, provider, kind, title, format, destDir, collectionId, extra }) {
    const id = randomUUID();
    const now = Date.now();
    db()
      .prepare(
        `INSERT INTO jobs (id, url, provider, kind, title, format, dest_dir, status, created_at, collection_id, extra)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`
      )
      .run(id, url, provider || null, kind || null, title || null, format || null, destDir || null, now, collectionId || null, extra ? JSON.stringify(extra) : null);
    logger.info('queue', `job ${id} enqueued (${provider || 'auto'}) ${url}`);
    scheduleEmit();
    pump();
    return id;
  }

  function cancelJob(id) {
    const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row) return false;
    telemetry.finish(id);
    persist(id, { status: 'cancelled', speed: 0, finished_at: Date.now() });
    const handle = running.get(id);
    if (handle) {
      handle.cancelled = true;
      handle.cancel();
    }
    // Clean up temporary .part file on explicit cancellation
    if (row.partial_path) {
      try {
        if (fs.existsSync(row.partial_path)) fs.unlinkSync(row.partial_path);
      } catch {}
    }
    scheduleEmit();
    return true;
  }

  function pauseJob(id) {
    const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row) return false;
    // Idempotent: already paused or pausing
    if (row.status === 'paused' || row.status === 'pausing') return true;
    // Reject invalid state transitions
    if (!['waiting', 'downloading', 'resuming', 'fetching_metadata'].includes(row.status)) {
      return false;
    }

    telemetry.pause(id);

    const handle = running.get(id);
    if (handle) {
      handle.paused = true;
      persist(id, { status: 'pausing', speed: 0 });
      handle.pause();
      scheduleEmit();
      return true;
    }

    // If waiting in queue, immediately transition to paused
    if (row.status === 'waiting') {
      persist(id, { status: 'paused', speed: 0 });
      scheduleEmit();
      return true;
    }

    return false;
  }

  function resumeJob(id) {
    const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row) return false;
    // Idempotent: already active or queued
    if (['waiting', 'downloading', 'resuming'].includes(row.status)) return true;
    // Only paused or failed jobs can be resumed
    if (row.status !== 'paused' && row.status !== 'failed') return false;
    if (running.has(id)) return true;

    // Verify partial file authoritatively on disk
    let validBytes = row.bytes_done || 0;
    let validPath = row.partial_path;
    if (validPath) {
      if (fs.existsSync(validPath)) {
        try {
          validBytes = fs.statSync(validPath).size;
          // Corrupted partial file larger than expected total
          if (row.bytes_total > 0 && validBytes > row.bytes_total) {
            validBytes = 0;
            try { fs.unlinkSync(validPath); } catch {}
            validPath = null;
          }
        } catch {
          validBytes = 0;
        }
      } else {
        // Partial file disappeared: fallback to restart from 0
        validBytes = 0;
        validPath = null;
      }
    }

    persist(id, {
      status: 'waiting',
      bytes_done: validBytes,
      partial_path: validPath,
      speed: 0,
      error: null
    });

    scheduleEmit();
    pump();
    return true;
  }

  function retryJob(id) {
    const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row || !['failed', 'cancelled', 'completed'].includes(row.status)) return false;
    if (running.has(id)) return false;
    telemetry.remove(id);
    persist(id, {
      status: 'waiting',
      progress: 0,
      bytes_done: 0,
      speed: 0,
      error: null,
      result_path: null,
      started_at: null,
      finished_at: null
    });
    logger.info('queue', `job ${id} retried`);
    scheduleEmit();
    pump();
    return true;
  }

  function removeJob(id) {
    const handle = running.get(id);
    if (handle) handle.cancel();
    running.delete(id);
    telemetry.remove(id);
    db().prepare('DELETE FROM jobs WHERE id = ?').run(id);
    scheduleEmit();
  }

  function clearCompleted() {
    const r = db().prepare("DELETE FROM jobs WHERE status IN ('completed', 'cancelled', 'failed')").run();
    scheduleEmit();
    return r.changes;
  }

  function runJob(row) {
    if (running.has(row.id)) return;
    const s = getSettings();
    persist(row.id, { status: 'downloading', started_at: Date.now(), error: null });
    telemetry.start(row.id, {
      bytesTotal: row.bytes_total,
      initialBytes: row.bytes_done,
      startedAt: Date.now()
    });
    scheduleEmit();

    const handle = executeJobFn(row, {
      allowLocal: !!s.allowLocalNetwork,
      onMetadata: (m) => {
        if (handle.cancelled || handle.paused) return;
        const patch = {};
        if (m.etag) patch.etag = m.etag;
        if (m.lastModified) patch.last_modified = m.lastModified;
        if (m.resumable != null) patch.resumable = m.resumable ? 1 : 0;
        if (m.total && !row.bytes_total) patch.bytes_total = m.total;
        if (m.partialPath && !row.partial_path) patch.partial_path = m.partialPath;
        if (Object.keys(patch).length) persist(row.id, patch);
      },
      onProgress: (p) => {
        if (handle.cancelled || handle.paused) return;
        const current = db().prepare('SELECT status FROM jobs WHERE id = ?').get(row.id);
        if (!current || current.status === 'cancelled' || current.status === 'paused') return;

        const fields = {};
        if (p.type === 'progress') {
          if (typeof p.pct === 'number') fields.progress = Math.min(1, p.pct / 100);
          if (p.totalBytes) fields.bytes_total = p.totalBytes;
          if (fields.progress != null && p.totalBytes) fields.bytes_done = Math.round((p.pct / 100) * p.totalBytes);
          if (p.speedBps != null) fields.speed = p.speedBps;
          if (fields.status !== 'downloading' && row.status !== 'downloading') fields.status = 'downloading';

          telemetry.record(row.id, {
            bytesDone: fields.bytes_done,
            bytesTotal: fields.bytes_total,
            providerSpeed: p.speedBps
          });
        } else if (p.type === 'processing') {
          fields.status = 'processing';
          fields.speed = 0;
          telemetry.record(row.id, { providerSpeed: 0 });
        } else if (p.received != null) {
          // direct provider progress
          fields.bytes_done = p.received;
          if (p.total) fields.bytes_total = p.total;
          fields.progress = p.pct || 0;
          if (p.speed != null) fields.speed = p.speed;
          fields.status = 'downloading';

          telemetry.record(row.id, {
            bytesDone: p.received,
            bytesTotal: p.total,
            providerSpeed: p.speed
          });
        } else if (p.type === 'done') {
          fields.progress = 1;
          fields.speed = 0;
          telemetry.finish(row.id);
        }
        if (Object.keys(fields).length) {
          if (throttleDb(row.id) || p.type === 'done') persist(row.id, fields);
        }
        scheduleEmit();
      }
    });

    running.set(row.id, handle);
    handle.promise
      .then((res) => {
        if (handle.cancelled) {
          telemetry.finish(row.id);
          return;
        }
        if (res?.paused || handle.paused) {
          telemetry.pause(row.id);
          persist(row.id, {
            status: 'paused',
            speed: 0,
            bytes_done: res?.bytes != null ? res.bytes : row.bytes_done,
            partial_path: res?.path || row.partial_path,
            etag: res?.etag || row.etag,
            last_modified: res?.lastModified || row.last_modified,
            resumable: res?.resumable != null ? (res.resumable ? 1 : 0) : row.resumable
          });
          logger.info('queue', `job ${row.id} safely paused at ${res?.bytes || row.bytes_done} bytes`);
          return;
        }
        const current = db().prepare('SELECT status FROM jobs WHERE id = ?').get(row.id);
        if (current && (current.status === 'cancelled' || current.status === 'paused')) {
          telemetry.finish(row.id);
          return;
        }
        telemetry.finish(row.id);
        persist(row.id, {
          status: 'completed',
          progress: 1,
          bytes_done: res?.bytes != null ? res.bytes : row.bytes_done,
          bytes_total: res?.bytes != null ? res.bytes : (row.bytes_total || res?.bytes),
          speed: 0,
          result_path: res.path,
          finished_at: Date.now()
        });
        logger.info('queue', `job ${row.id} completed -> ${res.path}`);
      })
      .catch((err) => {
        telemetry.finish(row.id);
        const cancelled = handle.cancelled || /cancel/i.test(String(err && err.message));
        const paused = handle.paused || /pause/i.test(String(err && err.message));
        if (paused) {
          persist(row.id, {
            status: 'paused',
            speed: 0
          });
          logger.info('queue', `job ${row.id} paused`);
        } else {
          persist(row.id, {
            status: cancelled ? 'cancelled' : 'failed',
            speed: 0,
            error: cancelled ? null : String(err?.message || err).slice(0, 2000),
            finished_at: Date.now()
          });
          logger.error('queue', `job ${row.id} ${cancelled ? 'cancelled' : 'failed'}: ${err?.message || err}`);
        }
      })
      .finally(() => {
        running.delete(row.id);
        lastDbWrite.delete(row.id);
        scheduleEmit();
        pump();
      });
  }

  function pump() {
    const s = getSettings();
    const concurrency = Math.min(8, Math.max(1, Number(s.concurrency) || 1));
    let guard = 0;
    while (running.size < concurrency && guard++ < 16) {
      const next = db().prepare(`SELECT * FROM jobs WHERE status = 'waiting' ORDER BY created_at ASC LIMIT 1`).get();
      if (!next) break;
      if (running.has(next.id)) break;
      runJob(next);
    }
  }

  /** On startup: interrupted jobs go back to waiting so users can resume. */
  function recover() {
    const interrupted = db()
      .prepare(`SELECT id, partial_path, bytes_total FROM jobs WHERE status IN ('fetching_metadata', 'downloading', 'processing', 'pausing', 'resuming')`)
      .all();
    for (const job of interrupted) {
      let validBytes = 0;
      let validPath = job.partial_path;
      if (validPath && fs.existsSync(validPath)) {
        try {
          validBytes = fs.statSync(validPath).size;
          if (job.bytes_total > 0 && validBytes > job.bytes_total) {
            validBytes = 0;
            try { fs.unlinkSync(validPath); } catch {}
            validPath = null;
          }
        } catch {
          validBytes = 0;
        }
      } else {
        validPath = null;
      }
      persist(job.id, { bytes_done: validBytes, partial_path: validPath });
    }
    const r = db()
      .prepare(`UPDATE jobs SET status = 'waiting', error = NULL WHERE status IN ('fetching_metadata', 'downloading', 'processing', 'pausing', 'resuming')`)
      .run();
    if (r.changes) {
      logger.info('queue', `recovered ${r.changes} interrupted jobs`);
      scheduleEmit();
      pump();
    }
  }

  function shutdown() {
    for (const [, h] of running) h.cancel();
    if (emitTimer) clearTimeout(emitTimer);
  }

  return {
    listJobs,
    startJob,
    pauseJob,
    resumeJob,
    cancelJob,
    retryJob,
    removeJob,
    clearCompleted,
    pump,
    recover,
    shutdown,
    getStatuses: () => JOB_STATUSES
  };
}

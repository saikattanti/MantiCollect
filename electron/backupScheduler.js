import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { getStorageConnectionManager } from './storageConnections.js';
import { getUploadQueue } from './uploadQueue.js';
import { logger } from './logger.js';

export const RECURRENCE_TYPES = ['once', 'daily', 'weekly', 'interval'];
export const SOURCE_TYPES = ['entire_library', 'collection', 'explicit', 'new_downloads'];
export const CONFLICT_POLICIES = ['skip', 'replace', 'avoid'];

/**
 * Calculates SHA-256 hash of a file streaming without loading into memory.
 */
export async function calculateFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Calculates next run timestamp based on recurrence rule.
 */
export function calculateNextRunTime({
  recurrence_type,
  interval_minutes = 60,
  run_at_time = '02:00',
  run_on_days = null, // [0..6], 0 = Sunday
  fromTime = Date.now()
}) {
  const from = new Date(fromTime);

  if (recurrence_type === 'once') {
    // If run_at_time is given as a timestamp or HH:mm
    if (typeof run_at_time === 'number') {
      return run_at_time > fromTime ? run_at_time : null;
    }
    const [hh, mm] = (run_at_time || '00:00').split(':').map((x) => parseInt(x, 10) || 0);
    const target = new Date(from);
    target.setHours(hh, mm, 0, 0);
    if (target.getTime() <= fromTime) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  if (recurrence_type === 'interval') {
    const mins = Math.max(5, Math.min(10080, Number(interval_minutes) || 60));
    return fromTime + (mins * 60 * 1000);
  }

  if (recurrence_type === 'daily') {
    const [hh, mm] = (run_at_time || '02:00').split(':').map((x) => parseInt(x, 10) || 0);
    const target = new Date(from);
    target.setHours(hh, mm, 0, 0);
    if (target.getTime() <= fromTime) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  if (recurrence_type === 'weekly') {
    const [hh, mm] = (run_at_time || '02:00').split(':').map((x) => parseInt(x, 10) || 0);
    let days = [0]; // default Sunday
    if (Array.isArray(run_on_days) && run_on_days.length) {
      days = run_on_days.map(Number).filter((d) => d >= 0 && d <= 6);
    } else if (typeof run_on_days === 'string') {
      try {
        const parsed = JSON.parse(run_on_days);
        if (Array.isArray(parsed) && parsed.length) {
          days = parsed.map(Number).filter((d) => d >= 0 && d <= 6);
        }
      } catch {}
    }
    if (!days.length) days = [0];

    // Find closest day strictly in the future
    let best = null;
    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
      const candidate = new Date(from);
      candidate.setDate(from.getDate() + dayOffset);
      candidate.setHours(hh, mm, 0, 0);

      if (days.includes(candidate.getDay()) && candidate.getTime() > fromTime) {
        if (!best || candidate.getTime() < best) {
          best = candidate.getTime();
        }
      }
    }
    return best || (fromTime + 7 * 24 * 60 * 60 * 1000);
  }

  return null;
}

/**
 * Creates the Backup Scheduler service.
 */
export function createBackupScheduler({
  getDbInstance = getDb,
  getConnectionManager = getStorageConnectionManager,
  getUploadQueueInstance = getUploadQueue,
  getWindow = () => null,
  onBackupStarted = null,
  onBackupCompleted = null,
  onBackupFailed = null
} = {}) {
  const db = () => getDbInstance();
  const connMgr = () => getConnectionManager();
  const queue = () => getUploadQueueInstance();

  const activeTimers = new Map(); // scheduleId -> Timeout
  const runningSchedules = new Set(); // scheduleId
  let isShutdown = false;

  function sendToWindow(channel, data) {
    const win = getWindow?.();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send(channel, data);
      } catch {}
    }
  }

  /* ---------------- Schedule CRUD ---------------- */

  function listSchedules() {
    const rows = db().prepare(`
      SELECT s.*, c.name as connection_name, c.provider_type
      FROM backup_schedules s
      LEFT JOIN storage_connections c ON s.connection_id = c.id
      ORDER BY s.created_at DESC
    `).all();

    return rows.map((r) => ({
      ...r,
      enabled: Boolean(r.enabled),
      include_new_downloads: Boolean(r.include_new_downloads),
      run_on_days: r.run_on_days ? JSON.parse(r.run_on_days) : null,
      file_filters: r.file_filters ? JSON.parse(r.file_filters) : null
    }));
  }

  function getSchedule(id) {
    if (!id || typeof id !== 'string') return null;
    const r = db().prepare(`
      SELECT s.*, c.name as connection_name, c.provider_type
      FROM backup_schedules s
      LEFT JOIN storage_connections c ON s.connection_id = c.id
      WHERE s.id = ?
    `).get(id);

    if (!r) return null;
    return {
      ...r,
      enabled: Boolean(r.enabled),
      include_new_downloads: Boolean(r.include_new_downloads),
      run_on_days: r.run_on_days ? JSON.parse(r.run_on_days) : null,
      file_filters: r.file_filters ? JSON.parse(r.file_filters) : null
    };
  }

  async function saveSchedule(payload) {
    const {
      id,
      name,
      enabled = true,
      source_type,
      source_id = null,
      connection_id,
      remote_prefix = '',
      recurrence_type,
      interval_minutes = 60,
      run_at_time = '02:00',
      run_on_days = null,
      file_filters = null,
      existing_file_policy = 'skip',
      include_new_downloads = false
    } = payload;

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Schedule name is required');
    }
    if (!SOURCE_TYPES.includes(source_type)) {
      throw new Error(`Invalid source type: ${source_type}`);
    }
    if (!RECURRENCE_TYPES.includes(recurrence_type)) {
      throw new Error(`Invalid recurrence type: ${recurrence_type}`);
    }
    if (!CONFLICT_POLICIES.includes(existing_file_policy)) {
      throw new Error(`Invalid existing file policy: ${existing_file_policy}`);
    }

    const conn = await connMgr().getConnection(connection_id);
    if (!conn) {
      throw new Error(`Storage connection not found: ${connection_id}`);
    }

    const now = Date.now();
    const nextRun = enabled
      ? calculateNextRunTime({
          recurrence_type,
          interval_minutes,
          run_at_time,
          run_on_days,
          fromTime: now
        })
      : null;

    const daysJson = run_on_days ? JSON.stringify(run_on_days) : null;
    const filtersJson = file_filters ? JSON.stringify(file_filters) : null;
    const safePrefix = typeof remote_prefix === 'string' ? remote_prefix.trim().replace(/^[/\\]+/, '') : '';

    let scheduleId = id;

    if (id) {
      const existing = db().prepare('SELECT * FROM backup_schedules WHERE id = ?').get(id);
      if (!existing) throw new Error(`Schedule not found: ${id}`);

      db().prepare(`
        UPDATE backup_schedules SET
          name = ?, enabled = ?, source_type = ?, source_id = ?,
          connection_id = ?, remote_prefix = ?, recurrence_type = ?,
          interval_minutes = ?, run_at_time = ?, run_on_days = ?,
          file_filters = ?, existing_file_policy = ?, include_new_downloads = ?,
          next_run_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name.trim(),
        enabled ? 1 : 0,
        source_type,
        source_id ? String(source_id) : null,
        connection_id,
        safePrefix,
        recurrence_type,
        Number(interval_minutes) || 60,
        run_at_time || '02:00',
        daysJson,
        filtersJson,
        existing_file_policy,
        include_new_downloads ? 1 : 0,
        nextRun,
        now,
        id
      );
      logger.info('backup-scheduler', `Updated backup schedule "${name}" (${id})`);
    } else {
      scheduleId = randomUUID();
      db().prepare(`
        INSERT INTO backup_schedules (
          id, name, enabled, source_type, source_id, connection_id,
          remote_prefix, recurrence_type, interval_minutes, run_at_time,
          run_on_days, file_filters, existing_file_policy, include_new_downloads,
          last_synced_cutoff_at, next_run_at, retry_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        scheduleId,
        name.trim(),
        enabled ? 1 : 0,
        source_type,
        source_id ? String(source_id) : null,
        connection_id,
        safePrefix,
        recurrence_type,
        Number(interval_minutes) || 60,
        run_at_time || '02:00',
        daysJson,
        filtersJson,
        existing_file_policy,
        include_new_downloads ? 1 : 0,
        now, // cutoff initialized to creation timestamp
        nextRun,
        now,
        now
      );
      logger.info('backup-scheduler', `Created backup schedule "${name}" (${scheduleId})`);
    }

    armScheduleTimer(scheduleId);
    sendToWindow('backup:schedules:updated', listSchedules());
    return getSchedule(scheduleId);
  }

  function deleteSchedule(id) {
    if (!id || typeof id !== 'string') throw new Error('Schedule ID is required');
    clearScheduleTimer(id);

    db().prepare('DELETE FROM backup_schedules WHERE id = ?').run(id);
    logger.info('backup-scheduler', `Deleted backup schedule ${id}`);
    sendToWindow('backup:schedules:updated', listSchedules());
    return { ok: true, id };
  }

  function toggleSchedule(id, enabled) {
    if (!id || typeof id !== 'string') throw new Error('Schedule ID is required');
    const sched = getSchedule(id);
    if (!sched) throw new Error(`Schedule not found: ${id}`);

    const now = Date.now();
    let nextRun = null;
    if (enabled) {
      nextRun = calculateNextRunTime({
        recurrence_type: sched.recurrence_type,
        interval_minutes: sched.interval_minutes,
        run_at_time: sched.run_at_time,
        run_on_days: sched.run_on_days,
        fromTime: now
      });
    }

    db().prepare(`
      UPDATE backup_schedules SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?
    `).run(enabled ? 1 : 0, nextRun, now, id);

    if (enabled) {
      armScheduleTimer(id);
    } else {
      clearScheduleTimer(id);
    }

    logger.info('backup-scheduler', `Schedule ${id} is now ${enabled ? 'enabled' : 'disabled'}`);
    sendToWindow('backup:schedules:updated', listSchedules());
    return getSchedule(id);
  }

  /* ---------------- Runs & History ---------------- */

  function listRuns(limit = 50) {
    return db().prepare(`
      SELECT r.*, s.name as schedule_name, c.name as connection_name
      FROM backup_runs r
      LEFT JOIN backup_schedules s ON r.schedule_id = s.id
      LEFT JOIN storage_connections c ON r.connection_id = c.id
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(limit);
  }

  function getRunDetails(runId) {
    if (!runId) return null;
    const run = db().prepare(`
      SELECT r.*, s.name as schedule_name, c.name as connection_name
      FROM backup_runs r
      LEFT JOIN backup_schedules s ON r.schedule_id = s.id
      LEFT JOIN storage_connections c ON r.connection_id = c.id
      WHERE r.id = ?
    `).get(runId);

    if (!run) return null;
    const items = db().prepare('SELECT * FROM backup_run_items WHERE run_id = ? ORDER BY created_at ASC').all(runId);
    return { ...run, items };
  }

  /* ---------------- Source Resolution ---------------- */

  async function resolveEligibleSourceFiles(sched) {
    const files = new Map(); // path -> { filePath, size }

    // Helper: filter extensions
    const allowedExts = Array.isArray(sched.file_filters) && sched.file_filters.length
      ? new Set(sched.file_filters.map((e) => e.toLowerCase().replace(/^\./, '')))
      : null;

    function addFile(p, size) {
      if (!p || typeof p !== 'string') return;
      if (allowedExts) {
        const ext = path.extname(p).toLowerCase().replace(/^\./, '');
        if (!allowedExts.has(ext)) return;
      }
      if (fs.existsSync(p)) {
        try {
          const st = fs.statSync(p);
          if (st.isFile()) {
            files.set(p, { filePath: p, size: size || st.size, mtime: st.mtimeMs });
          }
        } catch {}
      }
    }

    if (sched.source_type === 'entire_library') {
      const rows = db().prepare('SELECT file_path, file_size FROM media_metadata').all();
      for (const r of rows) addFile(r.file_path, r.file_size);
    } else if (sched.source_type === 'collection') {
      const rows = db().prepare('SELECT item_path FROM collection_items WHERE collection_id = ?').all(sched.source_id);
      for (const r of rows) addFile(r.item_path);
    } else if (sched.source_type === 'explicit') {
      if (sched.source_id) {
        try {
          const paths = JSON.parse(sched.source_id);
          if (Array.isArray(paths)) {
            for (const p of paths) addFile(p);
          }
        } catch {
          addFile(sched.source_id);
        }
      }
    } else if (sched.source_type === 'new_downloads') {
      const cutoff = sched.last_synced_cutoff_at || sched.created_at || 0;
      const rows = db().prepare(`
        SELECT result_path, bytes_total, finished_at
        FROM jobs
        WHERE status = 'completed' AND result_path IS NOT NULL AND finished_at > ?
      `).all(cutoff);
      for (const r of rows) addFile(r.result_path, r.bytes_total);
    }

    // If schedule additionally requests "include_new_downloads"
    if (sched.include_new_downloads && sched.source_type !== 'new_downloads') {
      const cutoff = sched.last_synced_cutoff_at || sched.created_at || 0;
      const rows = db().prepare(`
        SELECT result_path, bytes_total, finished_at
        FROM jobs
        WHERE status = 'completed' AND result_path IS NOT NULL AND finished_at > ?
      `).all(cutoff);
      for (const r of rows) addFile(r.result_path, r.bytes_total);
    }

    return Array.from(files.values());
  }

  /* ---------------- Schedule Execution Engine ---------------- */

  async function executeSchedule(scheduleId, isManual = false) {
    if (isShutdown) return;
    if (runningSchedules.has(scheduleId)) {
      logger.warn('backup-scheduler', `Schedule ${scheduleId} is already running, skipping overlapping run`);
      return;
    }

    const sched = getSchedule(scheduleId);
    if (!sched) return;
    if (!sched.enabled && !isManual) return;

    runningSchedules.add(scheduleId);
    const runId = randomUUID();
    const runStartTime = Date.now();

    logger.info('backup-scheduler', `Starting backup run ${runId} for "${sched.name}"`);
    if (typeof onBackupStarted === 'function') {
      try { onBackupStarted({ scheduleId, scheduleName: sched.name }); } catch {}
    }

    // 1. Create backup_runs record
    db().prepare(`
      INSERT INTO backup_runs (
        id, schedule_id, connection_id, started_at, status, total_items,
        success_items, failed_items, skipped_items, bytes_transferred, created_at
      ) VALUES (?, ?, ?, ?, 'running', 0, 0, 0, 0, 0, ?)
    `).run(runId, scheduleId, sched.connection_id, runStartTime, runStartTime);

    sendToWindow('backup:runs:updated', listRuns());

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let totalBytesTransferred = 0;
    const errors = [];

    try {
      // 2. Resolve source files
      const sourceFiles = await resolveEligibleSourceFiles(sched);
      db().prepare('UPDATE backup_runs SET total_items = ? WHERE id = ?').run(sourceFiles.length, runId);

      for (const item of sourceFiles) {
        if (isShutdown) break;

        const itemId = randomUUID();
        const baseFilename = path.basename(item.filePath);
        const remoteSubdir = sched.remote_prefix || '';
        const remotePath = remoteSubdir ? path.posix.join(remoteSubdir, baseFilename) : baseFilename;

        // Deduplication Check
        let isIdentical = false;
        let fileHash = null;

        if (sched.existing_file_policy === 'skip') {
          // Check past successful backup for this schedule/connection with same path and size
          const prev = db().prepare(`
            SELECT i.* FROM backup_run_items i
            JOIN backup_runs r ON i.run_id = r.id
            WHERE r.schedule_id = ? AND i.source_path = ? AND i.status = 'success'
            ORDER BY i.created_at DESC LIMIT 1
          `).get(scheduleId, item.filePath);

          if (prev && prev.file_size === item.size) {
            isIdentical = true;
          }
        }

        if (isIdentical) {
          skippedCount++;
          db().prepare(`
            INSERT INTO backup_run_items (
              id, run_id, source_path, remote_path, file_size, bytes_transferred,
              sha256_hash, status, created_at
            ) VALUES (?, ?, ?, ?, ?, 0, null, 'skipped', ?)
          `).run(itemId, runId, item.filePath, remotePath, item.size, Date.now());
          continue;
        }

        // Upload through upload queue
        try {
          const task = await queue().enqueueUpload({
            sourcePath: item.filePath,
            connectionId: sched.connection_id,
            remotePath: remoteSubdir
          });

          // Wait for this upload task to complete or fail
          await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
              const current = queue().getUpload(task.id);
              if (!current || ['completed', 'failed', 'cancelled'].includes(current.status)) {
                clearInterval(checkInterval);
                resolve(current);
              }
            }, 250);
          });

          const finishedTask = queue().getUpload(task.id);
          if (finishedTask?.status === 'completed') {
            successCount++;
            totalBytesTransferred += (finishedTask.bytes_done || item.size);
            db().prepare(`
              INSERT INTO backup_run_items (
                id, run_id, source_path, remote_path, file_size, bytes_transferred,
                sha256_hash, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, null, 'success', ?)
            `).run(itemId, runId, item.filePath, remotePath, item.size, finishedTask.bytes_done || item.size, Date.now());
          } else {
            failedCount++;
            const errMsg = finishedTask?.error_message || 'Upload task failed in queue';
            errors.push(`${baseFilename}: ${errMsg}`);
            db().prepare(`
              INSERT INTO backup_run_items (
                id, run_id, source_path, remote_path, file_size, bytes_transferred,
                sha256_hash, status, error_message, created_at
              ) VALUES (?, ?, ?, ?, ?, 0, null, 'failed', ?, ?)
            `).run(itemId, runId, item.filePath, remotePath, item.size, errMsg, Date.now());
          }
        } catch (uploadErr) {
          failedCount++;
          errors.push(`${baseFilename}: ${uploadErr.message}`);
          db().prepare(`
            INSERT INTO backup_run_items (
              id, run_id, source_path, remote_path, file_size, bytes_transferred,
              sha256_hash, status, error_message, created_at
            ) VALUES (?, ?, ?, ?, ?, 0, null, 'failed', ?, ?)
          `).run(itemId, runId, item.filePath, remotePath, item.size, uploadErr.message, Date.now());
        }

        // Live progress update on the run
        db().prepare(`
          UPDATE backup_runs SET
            success_items = ?, failed_items = ?, skipped_items = ?, bytes_transferred = ?
          WHERE id = ?
        `).run(successCount, failedCount, skippedCount, totalBytesTransferred, runId);
        sendToWindow('backup:runs:updated', listRuns());
      }
    } catch (runErr) {
      errors.push(`Run fatal error: ${runErr.message}`);
    } finally {
      runningSchedules.delete(scheduleId);

      // Final status determination:
      // Never mark a run successful if any required item failed. Partial success must be represented honestly.
      let finalStatus = 'completed';
      if (failedCount > 0 && successCount > 0) {
        finalStatus = 'partial';
      } else if (failedCount > 0 && successCount === 0) {
        finalStatus = 'failed';
      }

      const finishTime = Date.now();
      const sanitizedErrorSummary = errors.length ? errors.slice(0, 5).join('; ') : null;

      db().prepare(`
        UPDATE backup_runs SET
          status = ?, finished_at = ?, success_items = ?, failed_items = ?,
          skipped_items = ?, bytes_transferred = ?, error_summary = ?
        WHERE id = ?
      `).run(finalStatus, finishTime, successCount, failedCount, skippedCount, totalBytesTransferred, sanitizedErrorSummary, runId);

      // Advance schedule next run & cutoff timestamp
      const nextRunAt = sched.recurrence_type === 'once'
        ? null
        : calculateNextRunTime({
            recurrence_type: sched.recurrence_type,
            interval_minutes: sched.interval_minutes,
            run_at_time: sched.run_at_time,
            run_on_days: sched.run_on_days,
            fromTime: finishTime
          });

      db().prepare(`
        UPDATE backup_schedules SET
          last_run_at = ?,
          last_status = ?,
          last_synced_cutoff_at = ?,
          next_run_at = ?,
          enabled = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        finishTime,
        finalStatus,
        runStartTime, // advance cutoff to this run's start time
        nextRunAt,
        sched.recurrence_type === 'once' ? 0 : (sched.enabled ? 1 : 0),
        finishTime,
        scheduleId
      );

      if (sched.recurrence_type !== 'once' && sched.enabled) {
        armScheduleTimer(scheduleId);
      }

      logger.info('backup-scheduler', `Finished backup run ${runId}: ${finalStatus} (${successCount} ok, ${failedCount} fail, ${skippedCount} skip)`);
      if (finalStatus === 'completed' && typeof onBackupCompleted === 'function') {
        try { onBackupCompleted({ scheduleId, scheduleName: sched.name, successCount, skippedCount, totalBytesTransferred }); } catch {}
      } else if ((finalStatus === 'partial' || finalStatus === 'failed') && typeof onBackupFailed === 'function') {
        try { onBackupFailed({ scheduleId, scheduleName: sched.name, finalStatus, successCount, failedCount, skippedCount, errorSummary: sanitizedErrorSummary }); } catch {}
      }

      sendToWindow('backup:runs:updated', listRuns());
      sendToWindow('backup:schedules:updated', listSchedules());
    }
  }

  function clearScheduleTimer(id) {
    const timer = activeTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(id);
    }
  }

  function armScheduleTimer(scheduleId) {
    clearScheduleTimer(scheduleId);
    if (isShutdown) return;

    const sched = getSchedule(scheduleId);
    if (!sched || !sched.enabled || !sched.next_run_at) return;

    const now = Date.now();
    const delayMs = Math.max(0, sched.next_run_at - now);

    // Node.js setTimeout caps at 2147483647 ms (~24.8 days)
    const safeDelay = Math.min(delayMs, 24 * 60 * 60 * 1000);

    const timer = setTimeout(() => {
      activeTimers.delete(scheduleId);
      if (Date.now() >= sched.next_run_at - 1000) {
        executeSchedule(scheduleId);
      } else {
        // Re-arm remaining delay
        armScheduleTimer(scheduleId);
      }
    }, safeDelay);

    activeTimers.set(scheduleId, timer);
  }

  /* ---------------- Startup Lifecycle & Recovery ---------------- */

  function recover() {
    try {
      // Reconcile interrupted runs
      db().prepare(`
        UPDATE backup_runs
        SET status = 'failed', error_summary = 'Interrupted by application restart', finished_at = ?
        WHERE status = 'running'
      `).run(Date.now());

      // Load enabled schedules and check due runs
      const enabledSchedules = listSchedules().filter((s) => s.enabled);
      const now = Date.now();

      for (const sched of enabledSchedules) {
        if (sched.next_run_at && sched.next_run_at <= now) {
          // Missed schedule recovery: run once now
          logger.info('backup-scheduler', `Schedule "${sched.name}" was due during downtime, executing recovery run`);
          process.nextTick(() => executeSchedule(sched.id));
        } else {
          armScheduleTimer(sched.id);
        }
      }
    } catch (err) {
      logger.error('backup-scheduler', `Startup recovery failed: ${err.message}`);
    }
  }

  // Initialize recovery on creation
  recover();

  function shutdown() {
    isShutdown = true;
    for (const [id, timer] of activeTimers) {
      clearTimeout(timer);
    }
    activeTimers.clear();
  }

  return {
    listSchedules,
    getSchedule,
    saveSchedule,
    deleteSchedule,
    toggleSchedule,
    executeSchedule,
    listRuns,
    getRunDetails,
    recover,
    shutdown
  };
}

let _defaultScheduler = null;
export function getBackupScheduler() {
  if (!_defaultScheduler) {
    _defaultScheduler = createBackupScheduler();
  }
  return _defaultScheduler;
}

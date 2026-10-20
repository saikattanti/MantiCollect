import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { loadSettings } from './settings.js';
import { getStorageConnectionManager } from './storageConnections.js';
import {
  LocalNasStorageProvider,
  WebDavStorageProvider,
  SftpStorageProvider
} from './remoteStorage.js';
import { calculateEffectiveBandwidthLimit } from './bandwidth.js';
import { logger } from './logger.js';

/**
 * Remote Upload Queue Manager backed by SQLite.
 */
export function createUploadQueue({
  getDbInstance = getDb,
  getSettings = loadSettings,
  getConnectionManager = getStorageConnectionManager,
  getWindow = () => null
} = {}) {
  const db = () => getDbInstance();
  const connMgr = () => getConnectionManager();
  const activeControllers = new Map(); // id -> AbortController
  let isShutdown = false;

  function sendToWindow(channel, data) {
    const win = getWindow?.();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send(channel, data);
      } catch {}
    }
  }

  function listUploads(limit = 100) {
    return db().prepare('SELECT * FROM storage_uploads ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  function getUpload(id) {
    return db().prepare('SELECT * FROM storage_uploads WHERE id = ?').get(id) || null;
  }

  function persist(id, fields) {
    if (isShutdown) return;
    const sets = Object.keys(fields).map((k) => `${k} = ?`);
    if (!sets.length) return;
    try {
      db()
        .prepare(`UPDATE storage_uploads SET ${sets.join(', ')} WHERE id = ?`)
        .run(...Object.values(fields), id);
    } catch {}
  }

  function recover() {
    try {
      const interrupted = db()
        .prepare("SELECT * FROM storage_uploads WHERE status IN ('uploading', 'connecting', 'verifying')")
        .all();
      for (const task of interrupted) {
        persist(task.id, {
          status: 'failed',
          error_message: 'Interrupted by application restart',
          finished_at: Date.now()
        });
      }
    } catch {}
  }

  // Recover on initialization
  recover();

  async function enqueueUpload({
    sourcePath,
    connectionId,
    remotePath = '',
    taskLimitKBps = 0
  }) {
    if (!sourcePath || typeof sourcePath !== 'string') {
      throw new Error('Valid source file path is required');
    }
    const resolvedSource = path.resolve(sourcePath);
    if (!fs.existsSync(resolvedSource)) {
      throw new Error(`Source file does not exist on disk: ${sourcePath}`);
    }

    const st = await fs.promises.stat(resolvedSource);
    if (!st.isFile()) {
      throw new Error(`Source is not a regular file: ${sourcePath}`);
    }

    const conn = await connMgr().getConnection(connectionId);
    if (!conn) {
      throw new Error(`Storage connection not found: ${connectionId}`);
    }

    const id = randomUUID();
    const now = Date.now();

    db()
      .prepare(
        `INSERT INTO storage_uploads (
          id, source_path, connection_id, remote_path, status,
          bytes_done, bytes_total, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'waiting', 0, ?, ?, ?)`
      )
      .run(id, resolvedSource, connectionId, remotePath || '', st.size, now, now);

    logger.info('upload-queue', `Enqueued upload ${id} for ${path.basename(resolvedSource)} -> ${conn.name}`);
    sendToWindow('upload:updated', listUploads());

    // Trigger pump asynchronously
    process.nextTick(() => pump());

    return getUpload(id);
  }

  async function enqueueBatch({
    sourcePaths,
    connectionId,
    remoteSubdir = '',
    taskLimitKBps = 0
  }) {
    if (!Array.isArray(sourcePaths) || !sourcePaths.length) {
      throw new Error('At least one source file is required');
    }
    const results = [];
    for (const src of sourcePaths) {
      const task = await enqueueUpload({
        sourcePath: src,
        connectionId,
        remotePath: remoteSubdir,
        taskLimitKBps
      });
      results.push(task);
    }
    return results;
  }

  function pump() {
    if (isShutdown) return;
    const maxConcurrent = 2;
    if (activeControllers.size >= maxConcurrent) return;

    let nextTask;
    try {
      nextTask = db()
        .prepare("SELECT * FROM storage_uploads WHERE status = 'waiting' ORDER BY created_at ASC LIMIT 1")
        .get();
    } catch {
      return;
    }

    if (!nextTask || activeControllers.has(nextTask.id)) return;

    executeUploadTask(nextTask);
  }

  async function executeUploadTask(task) {
    const { id, source_path, connection_id, remote_path } = task;
    const controller = new AbortController();
    activeControllers.set(id, controller);

    persist(id, { status: 'connecting', updated_at: Date.now() });
    sendToWindow('upload:updated', listUploads());

    try {
      const conn = await connMgr().getInternalConnection(connection_id);
      if (!conn) {
        throw new Error(`Storage connection no longer exists: ${connection_id}`);
      }

      // Instantiate provider
      let provider;
      const s = getSettings();
      const allowLocalNetwork = Boolean(s.allowLocalNetwork);

      if (conn.provider_type === 'local_nas') {
        provider = new LocalNasStorageProvider({
          name: conn.name,
          basePath: conn.base_path
        });
      } else if (conn.provider_type === 'webdav') {
        provider = new WebDavStorageProvider({
          name: conn.name,
          serverUrl: conn.host,
          username: conn.username,
          password: conn.secret,
          allowInsecureHttp: Boolean(conn.allow_insecure_http),
          allowLocalNetwork
        });
      } else if (conn.provider_type === 'sftp') {
        provider = new SftpStorageProvider({
          name: conn.name,
          host: conn.host,
          port: conn.port || 22,
          username: conn.username,
          password: conn.secret,
          hostKeyFingerprint: conn.host_key_fingerprint,
          allowLocalNetwork
        });
      } else {
        throw new Error(`Unsupported provider type: ${conn.provider_type}`);
      }

      // Calculate effective rate limit
      const globalLimitBytes = (s.globalUploadLimitKBps || 0) * 1024;
      const taskLimitBytes = (s.perTaskUploadLimitKBps || 0) * 1024;
      const effectiveRateLimit = calculateEffectiveBandwidthLimit(globalLimitBytes, taskLimitBytes);

      persist(id, { status: 'uploading', updated_at: Date.now() });
      sendToWindow('upload:updated', listUploads());

      let lastEmit = 0;
      const transferRes = await provider.transferFile({
        sourcePath: source_path,
        targetSubdir: remote_path,
        abortSignal: controller.signal,
        rateLimitBytesPerSec: effectiveRateLimit,
        onProgress: (p) => {
          const now = Date.now();
          if (now - lastEmit >= 250 || p.percent === 100) {
            lastEmit = now;
            persist(id, {
              bytes_done: p.bytesTransferred,
              speed: p.speed || 0,
              updated_at: now
            });
            sendToWindow('upload:progress', {
              id,
              bytesDone: p.bytesTransferred,
              bytesTotal: p.totalBytes,
              speed: p.speed || 0,
              percent: p.percent || 0
            });
          }
        }
      });

      persist(id, {
        status: 'completed',
        bytes_done: transferRes.bytesTransferred,
        speed: 0,
        updated_at: Date.now(),
        finished_at: Date.now()
      });
      connMgr().recordSuccess(connection_id);
      logger.info('upload-queue', `Completed upload ${id} -> ${transferRes.destPath}`);
    } catch (err) {
      const isAbort = controller.signal.aborted;
      persist(id, {
        status: isAbort ? 'cancelled' : 'failed',
        speed: 0,
        error_message: isAbort ? 'Upload cancelled by user' : err.message,
        updated_at: Date.now(),
        finished_at: Date.now()
      });
      logger.error('upload-queue', `Upload ${id} ${isAbort ? 'cancelled' : 'failed'}: ${err.message}`);
    } finally {
      activeControllers.delete(id);
      sendToWindow('upload:updated', listUploads());
      process.nextTick(() => pump());
    }
  }

  function cancelUpload(id) {
    const controller = activeControllers.get(id);
    if (controller) {
      controller.abort();
      activeControllers.delete(id);
      persist(id, { status: 'cancelled', speed: 0, finished_at: Date.now() });
      sendToWindow('upload:updated', listUploads());
      return true;
    }
    const task = getUpload(id);
    if (task && task.status === 'waiting') {
      persist(id, { status: 'cancelled', finished_at: Date.now() });
      sendToWindow('upload:updated', listUploads());
      return true;
    }
    return false;
  }

  function clearCompleted() {
    db().prepare("DELETE FROM storage_uploads WHERE status IN ('completed', 'failed', 'cancelled')").run();
    sendToWindow('upload:updated', listUploads());
    return true;
  }

  function shutdown() {
    isShutdown = true;
    for (const [, ctrl] of activeControllers) {
      try { ctrl.abort(); } catch {}
    }
    activeControllers.clear();
  }

  return {
    listUploads,
    getUpload,
    enqueueUpload,
    enqueueBatch,
    cancelUpload,
    clearCompleted,
    recover,
    shutdown
  };
}

let _defaultUploadQueue = null;
export function getUploadQueue() {
  if (!_defaultUploadQueue) {
    _defaultUploadQueue = createUploadQueue();
  }
  return _defaultUploadQueue;
}

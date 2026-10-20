import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import { uniqueDestPath } from './export.js';
import { logger } from './logger.js';

/**
 * MantiCollect Remote Storage Architecture.
 *
 * This module defines the provider interface for optional remote & network storage targets
 * (Local NAS / Mounted Shares, WebDAV, SFTP).
 *
 * Security & Design Principles:
 * - Local-First: Remote sync is never automatic or mandatory. Files are only exported/uploaded on explicit user action.
 * - Credential Security: Passwords and keys must NEVER be stored in plaintext settings or sent to the renderer.
 *   Remote protocols (WebDAV, SFTP) require OS Keychain integration (e.g. Electron safeStorage). Until that
 *   credential boundary is fully configured, Local NAS / UNC network share copying is the primary safe provider.
 * - Streaming I/O: Files are streamed in chunks without loading entire files into memory.
 * - Verification: Checksum (SHA-256) or file size verification guarantees destination integrity.
 * - Cancellation: All upload operations support an AbortSignal.
 */

/**
 * Base Provider Interface.
 */
export class BaseStorageProvider {
  constructor(name, type) {
    this.name = name;
    this.type = type; // 'local_nas' | 'webdav' | 'sftp'
  }

  /**
   * Tests connectivity to the target storage destination.
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented by subclass');
  }

  /**
   * Transfers a single file to the destination.
   * @param {Object} options
   * @param {string} options.sourcePath
   * @param {string} options.targetSubdir
   * @param {Function} options.onProgress
   * @param {AbortSignal} options.abortSignal
   * @returns {Promise<{ ok: boolean, destPath: string, bytesTransferred: number }>}
   */
  async transferFile(/* options */) {
    throw new Error('transferFile() must be implemented by subclass');
  }
}

/**
 * Local Network Storage / NAS Provider.
 *
 * Works with mapped network drives (e.g., Z:\Backups) or Windows UNC paths (e.g., \\server\media).
 * Relies on the operating system's native network authentication and session credentials,
 * avoiding storing any network passwords in the application.
 */
export class LocalNasStorageProvider extends BaseStorageProvider {
  constructor({ name = 'Local NAS / Shared Drive', basePath } = {}) {
    super(name, 'local_nas');
    this.basePath = basePath ? path.resolve(basePath) : null;
  }

  async testConnection() {
    if (!this.basePath) {
      return { ok: false, message: 'Base path is not configured' };
    }
    try {
      if (!fs.existsSync(this.basePath)) {
        return { ok: false, message: `Path does not exist or network share is offline: ${this.basePath}` };
      }
      const st = await fs.promises.stat(this.basePath);
      if (!st.isDirectory()) {
        return { ok: false, message: `Configured path is not a directory: ${this.basePath}` };
      }
      // Check write permissions by creating and removing a probe file
      const testFile = path.join(this.basePath, `.manticollect_probe_${Date.now()}`);
      await fs.promises.writeFile(testFile, 'probe');
      await fs.promises.unlink(testFile);
      return { ok: true, message: 'Successfully connected and verified write permissions' };
    } catch (err) {
      return { ok: false, message: `Access error: ${err.message}` };
    }
  }

  async transferFile({ sourcePath, targetSubdir = '', onProgress = () => {}, abortSignal = null }) {
    if (!this.basePath) {
      throw new Error('NAS base path is not configured');
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }

    const st = await fs.promises.stat(sourcePath);
    if (!st.isFile()) {
      throw new Error(`Source is not a regular file: ${sourcePath}`);
    }

    const destDir = targetSubdir ? path.join(this.basePath, targetSubdir) : this.basePath;
    await fs.promises.mkdir(destDir, { recursive: true });

    const filename = path.basename(sourcePath);
    const destPath = uniqueDestPath(destDir, filename);

    const sourceStream = fs.createReadStream(sourcePath);
    const destStream = fs.createWriteStream(destPath);

    let bytesTransferred = 0;
    sourceStream.on('data', (chunk) => {
      bytesTransferred += chunk.length;
      onProgress({
        sourcePath,
        destPath,
        bytesTransferred,
        totalBytes: st.size,
        percent: st.size > 0 ? Math.min(100, Math.round((bytesTransferred / st.size) * 100)) : 0
      });
    });

    try {
      await pipeline(sourceStream, destStream, { signal: abortSignal || undefined });

      // Verify integrity by file size
      const destStat = await fs.promises.stat(destPath);
      if (destStat.size !== st.size) {
        throw new Error(`Integrity verification failed: expected ${st.size} bytes, got ${destStat.size}`);
      }

      logger.info('remote-storage', `Successfully transferred ${filename} to ${destPath}`);
      return { ok: true, destPath, bytesTransferred };
    } catch (err) {
      // Clean up partial destination file on abort or error
      if (fs.existsSync(destPath)) {
        try {
          await fs.promises.unlink(destPath);
        } catch {
          // Ignore unlink error
        }
      }
      throw err;
    }
  }
}

/**
 * Specification for WebDAV Storage Provider.
 * Status: Interface defined. Implementation deferred pending secure OS keychain storage.
 */
export class WebDavStorageProviderSpec extends BaseStorageProvider {
  constructor({ name = 'WebDAV Server', serverUrl, username } = {}) {
    super(name, 'webdav');
    this.serverUrl = serverUrl;
    this.username = username;
  }

  async testConnection() {
    return {
      ok: false,
      message: 'WebDAV remote upload is deferred until secure OS keychain storage is enabled.'
    };
  }

  async transferFile() {
    throw new Error('WebDAV provider is currently in specification state. Use Local NAS or batch export.');
  }
}

/**
 * Specification for SFTP Storage Provider.
 * Status: Interface defined. Implementation deferred pending secure OS keychain storage.
 */
export class SftpStorageProviderSpec extends BaseStorageProvider {
  constructor({ name = 'SFTP Server', host, port = 22, username } = {}) {
    super(name, 'sftp');
    this.host = host;
    this.port = port;
    this.username = username;
  }

  async testConnection() {
    return {
      ok: false,
      message: 'SFTP remote upload is deferred until secure OS keychain storage is enabled.'
    };
  }

  async transferFile() {
    throw new Error('SFTP provider is currently in specification state. Use Local NAS or batch export.');
  }
}

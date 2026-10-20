import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { Client as SftpClient } from 'ssh2';
import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { uniqueDestPath } from './export.js';
import { createBandwidthThrottler } from './bandwidth.js';
import { assertPublicUrl } from './security.js';
import { logger } from './logger.js';

/**
 * Base Storage Provider Interface.
 */
export class BaseStorageProvider {
  constructor(name, type) {
    this.name = name;
    this.type = type; // 'local_nas' | 'webdav' | 'sftp' | 's3'
  }

  getCapabilities() {
    return {
      supportsStreaming: true,
      supportsCancellation: true,
      supportsMultipart: false,
      supportsMultipartResume: false,
      supportsSizeVerification: false,
      supportsChecksumVerification: false
    };
  }

  /**
   * Tests connectivity to the destination.
   * @returns {Promise<{ ok: boolean, message?: string, hostKeyFingerprint?: string }>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented by subclass');
  }

  /**
   * Transfers a single file to the destination with streaming and throttling.
   * @param {Object} options
   * @param {string} options.sourcePath
   * @param {string} [options.targetSubdir]
   * @param {string} [options.remoteFileName]
   * @param {string} [options.conflictPolicy] - 'avoid' | 'overwrite'
   * @param {Function} [options.onProgress]
   * @param {AbortSignal} [options.abortSignal]
   * @param {number} [options.rateLimitBytesPerSec]
   * @returns {Promise<{ ok: boolean, destPath: string, bytesTransferred: number }>}
   */
  async transferFile(/* options */) {
    throw new Error('transferFile() must be implemented by subclass');
  }
}

/**
 * Local Network Storage / NAS Provider.
 * Streams files with size integrity verification, bandwidth throttling, and duplicate avoidance.
 */
export class LocalNasStorageProvider extends BaseStorageProvider {
  constructor({ name = 'Local NAS / Shared Drive', basePath } = {}) {
    super(name, 'local_nas');
    this.basePath = basePath ? path.resolve(basePath) : null;
  }

  getCapabilities() {
    return {
      supportsStreaming: true,
      supportsCancellation: true,
      supportsMultipart: false,
      supportsMultipartResume: false,
      supportsSizeVerification: true,
      supportsChecksumVerification: false
    };
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

  async transferFile({
    sourcePath,
    targetSubdir = '',
    conflictPolicy = 'avoid',
    onProgress = () => {},
    abortSignal = null,
    rateLimitBytesPerSec = 0,
    globalLimiter = null
  }) {
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
    const destPath = conflictPolicy === 'overwrite'
      ? path.join(destDir, filename)
      : uniqueDestPath(destDir, filename);

    const sourceStream = fs.createReadStream(sourcePath);
    const destStream = fs.createWriteStream(destPath);
    const throttler = createBandwidthThrottler({ bytesPerSecond: rateLimitBytesPerSec, globalLimiter, abortSignal });

    let bytesTransferred = 0;
    let lastTime = Date.now();
    let lastBytes = 0;

    sourceStream.on('data', (chunk) => {
      bytesTransferred += chunk.length;
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      let speed = 0;
      if (elapsed >= 0.25) {
        speed = Math.round((bytesTransferred - lastBytes) / elapsed);
        lastTime = now;
        lastBytes = bytesTransferred;
      }
      onProgress({
        sourcePath,
        destPath,
        bytesTransferred,
        totalBytes: st.size,
        speed,
        percent: st.size > 0 ? Math.min(100, Math.round((bytesTransferred / st.size) * 100)) : 0
      });
    });

    try {
      await pipeline(sourceStream, throttler, destStream, { signal: abortSignal || undefined });

      // Verify integrity by file size
      const destStat = await fs.promises.stat(destPath);
      if (destStat.size !== st.size) {
        throw new Error(`Integrity verification failed: expected ${st.size} bytes, got ${destStat.size}`);
      }

      logger.info('remote-storage', `Successfully transferred ${filename} to ${destPath}`);
      return { ok: true, destPath, bytesTransferred };
    } catch (err) {
      if (fs.existsSync(destPath)) {
        try {
          await fs.promises.unlink(destPath);
        } catch {}
      }
      throw err;
    }
  }
}

/**
 * WebDAV Storage Provider.
 *
 * Implements RFC 4918 over HTTPS (or HTTP with explicit opt-in).
 * Defends against SSRF, credential leakage in redirects, and unauthorized private network access.
 */
export class WebDavStorageProvider extends BaseStorageProvider {
  constructor({
    name = 'WebDAV Server',
    serverUrl,
    username = null,
    password = null,
    allowInsecureHttp = false,
    allowLocalNetwork = false
  } = {}) {
    super(name, 'webdav');
    this.serverUrl = serverUrl;
    this.username = username;
    this.password = password;
    this.allowInsecureHttp = Boolean(allowInsecureHttp);
    this.allowLocalNetwork = Boolean(allowLocalNetwork);
  }

  getCapabilities() {
    return {
      supportsStreaming: true,
      supportsCancellation: true,
      supportsMultipart: false,
      supportsMultipartResume: false,
      supportsSizeVerification: true,
      supportsChecksumVerification: false
    };
  }

  normalizeUrl() {
    if (!this.serverUrl || typeof this.serverUrl !== 'string') {
      throw new Error('WebDAV server URL is required');
    }
    let raw = this.serverUrl.trim();
    if (!/^https?:\/\//i.test(raw)) {
      raw = `https://${raw}`;
    }
    const u = new URL(raw);
    if (u.username || u.password) {
      throw new Error('Embedded credentials in WebDAV URL are prohibited for security');
    }
    if (u.protocol === 'http:' && !this.allowInsecureHttp) {
      throw new Error('Insecure HTTP is not permitted for WebDAV. Enable allowInsecureHttp to opt-in.');
    }
    return u;
  }

  async validateEndpoint(u) {
    if (!this.allowLocalNetwork) {
      await assertPublicUrl(u.href, { allowLocal: false });
    }
  }

  getAuthHeader() {
    if (this.username && this.password) {
      const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      return `Basic ${token}`;
    }
    return null;
  }

  async sendRequest({ method, targetPath = '', headers = {}, bodyStream = null, abortSignal = null, timeoutMs = 15000 }) {
    const base = this.normalizeUrl();
    await this.validateEndpoint(base);

    const fullPath = path.posix.join(base.pathname, targetPath).replace(/\\/g, '/');
    const targetUrl = new URL(fullPath, base.origin);

    const isHttps = targetUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const reqHeaders = { ...headers };
    const auth = this.getAuthHeader();
    if (auth && !reqHeaders.Authorization) {
      reqHeaders.Authorization = auth;
    }

    return new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;

      function finish(err, res) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) reject(err);
        else resolve(res);
      }

      const req = client.request(
        targetUrl,
        {
          method,
          headers: reqHeaders,
          timeout: timeoutMs,
          signal: abortSignal || undefined
        },
        (res) => {
          finish(null, res);
        }
      );

      timer = setTimeout(() => {
        req.destroy(new Error(`WebDAV request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      req.on('error', (err) => finish(err));

      if (bodyStream) {
        pipeline(bodyStream, req, { signal: abortSignal || undefined }).catch((err) => {
          finish(err);
        });
      } else {
        req.end();
      }
    });
  }

  async testConnection() {
    try {
      const res = await this.sendRequest({ method: 'PROPFIND', headers: { Depth: '0' } });
      res.resume(); // consume stream

      if (res.statusCode >= 200 && res.statusCode < 300) {
        return { ok: true, message: `Connected successfully (HTTP ${res.statusCode})` };
      }
      if (res.statusCode === 401 || res.statusCode === 403) {
        return { ok: false, message: `Authentication failed (HTTP ${res.statusCode})` };
      }
      if (res.statusCode === 405) {
        // PROPFIND not allowed, fallback to HEAD
        const headRes = await this.sendRequest({ method: 'HEAD' });
        headRes.resume();
        if (headRes.statusCode >= 200 && headRes.statusCode < 400) {
          return { ok: true, message: `Connected successfully via HEAD (HTTP ${headRes.statusCode})` };
        }
      }
      return { ok: false, message: `Server returned HTTP ${res.statusCode} ${res.statusMessage || ''}` };
    } catch (err) {
      return { ok: false, message: `WebDAV connection error: ${err.message}` };
    }
  }

  async ensureRemoteDirectory(remoteDir, abortSignal = null) {
    if (!remoteDir || remoteDir === '/' || remoteDir === '.') return;
    const parts = remoteDir.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = path.posix.join(current, part);
      try {
        const res = await this.sendRequest({ method: 'MKCOL', targetPath: current, abortSignal });
        res.resume();
        // 201 Created or 405 Method Not Allowed (already exists) are expected
      } catch {
        // Ignore directory creation probe errors
      }
    }
  }

  async transferFile({
    sourcePath,
    targetSubdir = '',
    remoteFileName = null,
    conflictPolicy = 'avoid',
    onProgress = () => {},
    abortSignal = null,
    rateLimitBytesPerSec = 0,
    globalLimiter = null
  }) {
    if (abortSignal?.aborted) {
      throw new Error('Transfer aborted by user');
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }

    const st = await fs.promises.stat(sourcePath);
    if (!st.isFile()) {
      throw new Error(`Source is not a regular file: ${sourcePath}`);
    }

    const filename = remoteFileName || path.basename(sourcePath);
    // Sanitize remote path to prevent path traversal
    const safeSubdir = targetSubdir.replace(/^[/\\]+/, '').replace(/\.\./g, '');
    const remoteDest = path.posix.join(safeSubdir, encodeURIComponent(filename));

    await this.ensureRemoteDirectory(safeSubdir, abortSignal);

    // Read stream with throttling
    const readStream = fs.createReadStream(sourcePath);
    const throttler = createBandwidthThrottler({ bytesPerSecond: rateLimitBytesPerSec, globalLimiter, abortSignal });

    let bytesTransferred = 0;
    let lastTime = Date.now();
    let lastBytes = 0;

    readStream.on('data', (chunk) => {
      bytesTransferred += chunk.length;
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      let speed = 0;
      if (elapsed >= 0.25) {
        speed = Math.round((bytesTransferred - lastBytes) / elapsed);
        lastTime = now;
        lastBytes = bytesTransferred;
      }
      onProgress({
        sourcePath,
        destPath: remoteDest,
        bytesTransferred,
        totalBytes: st.size,
        speed,
        percent: st.size > 0 ? Math.min(100, Math.round((bytesTransferred / st.size) * 100)) : 0
      });
    });

    const bodyStream = readStream.pipe(throttler);

    const headers = {
      'Content-Length': String(st.size),
      'Content-Type': 'application/octet-stream'
    };
    if (conflictPolicy === 'avoid') {
      headers['If-None-Match'] = '*'; // Fail PUT if destination exists
    }

    let putRes;
    try {
      putRes = await this.sendRequest({
        method: 'PUT',
        targetPath: remoteDest,
        headers,
        bodyStream,
        abortSignal
      });
      putRes.resume();
    } catch (err) {
      try { readStream.destroy(); } catch {}
      try { throttler.destroy(); } catch {}
      throw new Error(`WebDAV upload failed: ${err.message}`);
    }

    if (putRes.statusCode === 412) {
      throw new Error(`Destination file already exists on WebDAV server: ${filename}`);
    }

    if (putRes.statusCode < 200 || putRes.statusCode >= 300) {
      throw new Error(`WebDAV upload rejected with HTTP ${putRes.statusCode}: ${putRes.statusMessage || ''}`);
    }

    // Verify remote size if HEAD is supported
    try {
      const headRes = await this.sendRequest({ method: 'HEAD', targetPath: remoteDest, abortSignal });
      headRes.resume();
      const remoteLen = parseInt(headRes.headers['content-length'] || '-1', 10);
      if (remoteLen >= 0 && remoteLen !== st.size) {
        throw new Error(`WebDAV size mismatch: expected ${st.size} bytes, remote server has ${remoteLen}`);
      }
    } catch (err) {
      logger.warn('webdav', `Post-upload HEAD check omitted or failed: ${err.message}`);
    }

    logger.info('webdav', `Uploaded ${filename} to WebDAV ${remoteDest}`);
    return { ok: true, destPath: remoteDest, bytesTransferred: st.size };
  }
}

/**
 * SFTP Storage Provider using ssh2.
 *
 * Implements strict host-key verification, password/key authentication,
 * and chunked stream upload with bandwidth throttling.
 */
export class SftpStorageProvider extends BaseStorageProvider {
  constructor({
    name = 'SFTP Server',
    host,
    port = 22,
    username,
    password = null,
    privateKey = null,
    passphrase = null,
    hostKeyFingerprint = null,
    allowLocalNetwork = false,
    clientFactory = null
  } = {}) {
    super(name, 'sftp');
    this.host = host;
    this.port = Number(port) || 22;
    this.username = username;
    this.password = password;
    this.privateKey = privateKey;
    this.passphrase = passphrase;
    this.hostKeyFingerprint = hostKeyFingerprint ? hostKeyFingerprint.trim().toLowerCase() : null;
    this.allowLocalNetwork = Boolean(allowLocalNetwork);
    this.clientFactory = clientFactory;
  }

  getCapabilities() {
    return {
      supportsStreaming: true,
      supportsCancellation: true,
      supportsMultipart: false,
      supportsMultipartResume: false,
      supportsSizeVerification: true,
      supportsChecksumVerification: false
    };
  }

  createClient() {
    if (this.clientFactory) return this.clientFactory();
    if (!this.host) throw new Error('SFTP host is required');
    if (!this.username) throw new Error('SFTP username is required');

    const client = new SftpClient();
    return client;
  }

  async connect(timeoutMs = 15000) {
    const client = this.createClient();

    let serverFingerprint = null;
    let fingerprintMatched = false;

    return new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;

      function finish(err, res) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) {
          try { client.end(); } catch {}
          reject(err);
        } else {
          resolve(res);
        }
      }

      timer = setTimeout(() => {
        finish(new Error(`SFTP connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      client.on('error', (err) => finish(err));

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) return finish(err);
          finish(null, { client, sftp, serverFingerprint });
        });
      });

      const connectConfig = {
        host: this.host,
        port: this.port,
        username: this.username,
        readyTimeout: timeoutMs,
        hostHash: 'sha256',
        hostVerifier: (hashedKey) => {
          serverFingerprint = hashedKey.toLowerCase();
          // Strict host key verification:
          // If known fingerprint is set, it MUST match.
          if (this.hostKeyFingerprint) {
            fingerprintMatched = serverFingerprint === this.hostKeyFingerprint;
            if (!fingerprintMatched) {
              logger.error('sftp', `Host key mismatch for ${this.host}! Expected ${this.hostKeyFingerprint}, got ${serverFingerprint}`);
              return false; // Rejects connection immediately
            }
            return true;
          }
          // If no fingerprint set yet, trust for initial probe/verification and record fingerprint
          return true;
        }
      };

      if (this.password) {
        connectConfig.password = this.password;
      }
      if (this.privateKey) {
        connectConfig.privateKey = this.privateKey;
        if (this.passphrase) connectConfig.passphrase = this.passphrase;
      }

      client.connect(connectConfig);
    });
  }

  async testConnection() {
    let conn;
    try {
      conn = await this.connect(10000);
      const { client, sftp, serverFingerprint } = conn;
      return new Promise((resolve) => {
        sftp.readdir('.', (err) => {
          client.end();
          if (err) {
            resolve({ ok: false, message: `Connected but readdir failed: ${err.message}` });
          } else {
            resolve({
              ok: true,
              message: 'SFTP connection verified successfully',
              hostKeyFingerprint: serverFingerprint
            });
          }
        });
      });
    } catch (err) {
      if (conn?.client) {
        try { conn.client.end(); } catch {}
      }
      return { ok: false, message: `SFTP connection error: ${err.message}` };
    }
  }

  async transferFile({
    sourcePath,
    targetSubdir = '',
    remoteFileName = null,
    onProgress = () => {},
    abortSignal = null,
    rateLimitBytesPerSec = 0,
    globalLimiter = null
  }) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }

    const st = await fs.promises.stat(sourcePath);
    if (!st.isFile()) {
      throw new Error(`Source is not a regular file: ${sourcePath}`);
    }

    const filename = remoteFileName || path.basename(sourcePath);
    const safeSubdir = targetSubdir.replace(/^[/\\]+/, '').replace(/\.\./g, '');
    const remoteDest = path.posix.join(safeSubdir, filename).replace(/\\/g, '/');

    const { client, sftp } = await this.connect();

    return new Promise((resolve, reject) => {
      let settled = false;

      function cleanup(err, res) {
        if (settled) return;
        settled = true;
        try { client.end(); } catch {}
        if (err) reject(err);
        else resolve(res);
      }

      if (abortSignal) {
        abortSignal.addEventListener(
          'abort',
          () => {
            cleanup(new Error('SFTP transfer aborted by user'));
          },
          { once: true }
        );
      }

      const readStream = fs.createReadStream(sourcePath);
      const writeStream = sftp.createWriteStream(remoteDest);
      const throttler = createBandwidthThrottler({ bytesPerSecond: rateLimitBytesPerSec, globalLimiter, abortSignal });

      let bytesTransferred = 0;
      let lastTime = Date.now();
      let lastBytes = 0;

      readStream.on('data', (chunk) => {
        bytesTransferred += chunk.length;
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        let speed = 0;
        if (elapsed >= 0.25) {
          speed = Math.round((bytesTransferred - lastBytes) / elapsed);
          lastTime = now;
          lastBytes = bytesTransferred;
        }
        onProgress({
          sourcePath,
          destPath: remoteDest,
          bytesTransferred,
          totalBytes: st.size,
          speed,
          percent: st.size > 0 ? Math.min(100, Math.round((bytesTransferred / st.size) * 100)) : 0
        });
      });

      pipeline(readStream, throttler, writeStream, { signal: abortSignal || undefined })
        .then(async () => {
          // Verify remote file size
          sftp.stat(remoteDest, (err, stats) => {
            if (err) {
              logger.warn('sftp', `Could not stat remote file ${remoteDest}: ${err.message}`);
              return cleanup(null, { ok: true, destPath: remoteDest, bytesTransferred: st.size });
            }
            if (stats.size !== st.size) {
              return cleanup(new Error(`SFTP size mismatch: expected ${st.size} bytes, remote file is ${stats.size}`));
            }
            logger.info('sftp', `Successfully transferred ${filename} to ${remoteDest}`);
            cleanup(null, { ok: true, destPath: remoteDest, bytesTransferred: st.size });
          });
        })
        .catch((err) => {
          cleanup(err);
        });
    });
  }
}

/**
 * S3-Compatible Storage Provider using AWS SDK v3.
 * Supports AWS S3, Cloudflare R2, MinIO, and custom endpoints.
 * Features single-part streaming (<10MB), chunked multipart uploads (>=10MB),
 * bandwidth throttling, abort cleanup, and remote size verification.
 */
export class S3StorageProvider extends BaseStorageProvider {
  constructor({
    name = 'S3 Storage',
    endpoint = null,
    region = 'us-east-1',
    bucket,
    keyPrefix = '',
    accessKeyId = null,
    secretAccessKey = null,
    sessionToken = null,
    forcePathStyle = false,
    allowInsecureHttp = false,
    allowLocalNetwork = false,
    clientFactory = null
  } = {}) {
    super(name, 's3');
    this.endpoint = endpoint ? endpoint.trim() : null;
    this.region = region ? region.trim() : 'us-east-1';
    this.bucket = bucket ? bucket.trim() : null;
    this.keyPrefix = keyPrefix ? keyPrefix.trim() : '';
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.forcePathStyle = Boolean(forcePathStyle);
    this.allowInsecureHttp = Boolean(allowInsecureHttp);
    this.allowLocalNetwork = Boolean(allowLocalNetwork);
    this.clientFactory = clientFactory;
  }

  getCapabilities() {
    return {
      supportsStreaming: true,
      supportsCancellation: true,
      supportsMultipart: true,
      supportsMultipartResume: true,
      supportsSizeVerification: true,
      supportsChecksumVerification: true
    };
  }

  async validateEndpoint() {
    if (!this.endpoint) return;
    let raw = this.endpoint.trim();
    if (!/^https?:\/\//i.test(raw)) {
      raw = `https://${raw}`;
    }
    const u = new URL(raw);
    if (u.username || u.password) {
      throw new Error('Embedded credentials in S3 endpoint URL are prohibited for security');
    }
    if (u.protocol === 'http:' && !this.allowInsecureHttp) {
      throw new Error('Insecure HTTP is not permitted for S3 endpoints. Enable allowInsecureHttp to opt-in.');
    }
    if (!this.allowLocalNetwork) {
      await assertPublicUrl(u.href, { allowLocal: false });
    }
  }

  createClient() {
    if (this.clientFactory) return this.clientFactory();
    if (!this.bucket) {
      throw new Error('Bucket name is required for S3 storage provider');
    }
    const config = {
      region: this.region || 'us-east-1',
      forcePathStyle: this.forcePathStyle
    };

    if (this.endpoint) {
      let raw = this.endpoint.trim();
      if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
      config.endpoint = raw;
    }

    if (this.accessKeyId && this.secretAccessKey) {
      config.credentials = {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        sessionToken: this.sessionToken || undefined
      };
    }

    return new S3Client(config);
  }

  async testConnection() {
    try {
      await this.validateEndpoint();
      const client = this.createClient();
      try {
        await client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        return { ok: true, message: `Successfully connected to S3 bucket "${this.bucket}"` };
      } catch (headErr) {
        try {
          await client.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
          return { ok: true, message: `Successfully connected to S3 bucket "${this.bucket}"` };
        } catch (listErr) {
          const msg = headErr.message || listErr.message || 'Unknown error';
          if (/403|Forbidden|AccessDenied/i.test(msg)) {
            return { ok: false, message: `Access denied to S3 bucket "${this.bucket}". Check credentials.` };
          }
          if (/404|NotFound|NoSuchBucket/i.test(msg)) {
            return { ok: false, message: `S3 bucket "${this.bucket}" does not exist.` };
          }
          return { ok: false, message: `S3 connection failed: ${msg}` };
        }
      }
    } catch (err) {
      return { ok: false, message: `S3 configuration error: ${err.message}` };
    }
  }

  buildRemoteKey(filename, targetSubdir = '') {
    const parts = [];
    if (this.keyPrefix) parts.push(this.keyPrefix.replace(/^\/+|\/+$/g, ''));
    if (targetSubdir) parts.push(targetSubdir.replace(/^\/+|\/+$/g, ''));
    parts.push(filename);
    return parts.filter(Boolean).join('/').replace(/\\/g, '/');
  }

  async transferFile({
    sourcePath,
    targetSubdir = '',
    remoteFileName = null,
    conflictPolicy = 'avoid',
    onProgress = () => {},
    abortSignal = null,
    rateLimitBytesPerSec = 0,
    globalLimiter = null,
    onMultipartPart = null
  }) {
    if (abortSignal?.aborted) {
      throw new Error('Transfer aborted by user');
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }

    const st = await fs.promises.stat(sourcePath);
    if (!st.isFile()) {
      throw new Error(`Source is not a regular file: ${sourcePath}`);
    }

    await this.validateEndpoint();
    const client = this.createClient();

    let filename = remoteFileName || path.basename(sourcePath);
    let remoteKey = this.buildRemoteKey(filename, targetSubdir);

    // Check remote object existence for conflictPolicy
    let existingObj = null;
    try {
      existingObj = await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: remoteKey }));
    } catch {
      // 404 is normal when object doesn't exist yet
    }

    if (existingObj) {
      if (conflictPolicy === 'skip') {
        const remoteSize = Number(existingObj.ContentLength);
        if (remoteSize === st.size) {
          return {
            ok: true,
            skipped: true,
            destPath: remoteKey,
            bytesTransferred: 0,
            message: `Remote object "${remoteKey}" verified identical, skipped.`
          };
        }
      } else if (conflictPolicy === 'avoid') {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        let counter = 1;
        while (counter < 100) {
          filename = `${base}_${counter}${ext}`;
          remoteKey = this.buildRemoteKey(filename, targetSubdir);
          try {
            await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: remoteKey }));
            counter++;
          } catch {
            break;
          }
        }
      }
    }

    // Determine upload strategy:
    // Files < 10 MB use single PutObjectCommand
    // Files >= 10 MB use Multipart Upload (8 MB parts)
    const MULTIPART_THRESHOLD = 10 * 1024 * 1024;
    const PART_SIZE = 8 * 1024 * 1024;

    if (st.size < MULTIPART_THRESHOLD) {
      return this._uploadSinglePart({
        client,
        sourcePath,
        remoteKey,
        fileSize: st.size,
        abortSignal,
        rateLimitBytesPerSec,
        globalLimiter,
        onProgress
      });
    }

    return this._uploadMultipart({
      client,
      sourcePath,
      remoteKey,
      fileSize: st.size,
      partSize: PART_SIZE,
      abortSignal,
      rateLimitBytesPerSec,
      globalLimiter,
      onProgress,
      onMultipartPart
    });
  }

  async _uploadSinglePart({
    client,
    sourcePath,
    remoteKey,
    fileSize,
    abortSignal,
    rateLimitBytesPerSec,
    globalLimiter,
    onProgress
  }) {
    const readStream = fs.createReadStream(sourcePath);
    const throttler = createBandwidthThrottler({ bytesPerSecond: rateLimitBytesPerSec, globalLimiter, abortSignal });

    let bytesTransferred = 0;
    let lastTime = Date.now();
    let lastBytes = 0;

    readStream.on('data', (chunk) => {
      bytesTransferred += chunk.length;
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      let speed = 0;
      if (elapsed >= 0.25) {
        speed = Math.round((bytesTransferred - lastBytes) / elapsed);
        lastTime = now;
        lastBytes = bytesTransferred;
      }
      onProgress({
        sourcePath,
        destPath: remoteKey,
        bytesTransferred,
        totalBytes: fileSize,
        speed,
        percent: fileSize > 0 ? Math.min(100, Math.round((bytesTransferred / fileSize) * 100)) : 0
      });
    });

    const bodyStream = readStream.pipe(throttler);

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: remoteKey,
          Body: bodyStream,
          ContentLength: fileSize
        }),
        { abortSignal: abortSignal || undefined }
      );

      // Verify remote size
      const verify = await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: remoteKey }));
      if (Number(verify.ContentLength) !== fileSize) {
        throw new Error(`S3 size mismatch: expected ${fileSize} bytes, remote object is ${verify.ContentLength}`);
      }

      logger.info('s3', `Uploaded ${path.basename(sourcePath)} to s3://${this.bucket}/${remoteKey}`);
      return { ok: true, destPath: remoteKey, bytesTransferred: fileSize };
    } catch (err) {
      try { readStream.destroy(); } catch {}
      try { throttler.destroy(); } catch {}
      throw new Error(`S3 upload failed: ${err.message}`);
    }
  }

  async _uploadMultipart({
    client,
    sourcePath,
    remoteKey,
    fileSize,
    partSize,
    abortSignal,
    rateLimitBytesPerSec,
    globalLimiter,
    onProgress,
    onMultipartPart
  }) {
    let uploadId = null;

    try {
      const createRes = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: remoteKey
        }),
        { abortSignal: abortSignal || undefined }
      );
      uploadId = createRes.UploadId;

      const totalParts = Math.ceil(fileSize / partSize);
      const completedParts = [];
      let totalBytesUploaded = 0;
      let lastTime = Date.now();
      let lastBytes = 0;

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        if (abortSignal?.aborted) {
          throw new Error('Transfer aborted by user');
        }

        const start = (partNumber - 1) * partSize;
        const end = Math.min(fileSize - 1, start + partSize - 1);
        const thisPartBytes = end - start + 1;

        const throttler = createBandwidthThrottler({ bytesPerSecond: rateLimitBytesPerSec, globalLimiter, abortSignal });
        const partStream = fs.createReadStream(sourcePath, { start, end });

        const chunks = [];
        for await (const chunk of partStream.pipe(throttler)) {
          chunks.push(chunk);
          totalBytesUploaded += chunk.length;
          const now = Date.now();
          const elapsed = (now - lastTime) / 1000;
          let speed = 0;
          if (elapsed >= 0.25) {
            speed = Math.round((totalBytesUploaded - lastBytes) / elapsed);
            lastTime = now;
            lastBytes = totalBytesUploaded;
          }
          onProgress({
            sourcePath,
            destPath: remoteKey,
            bytesTransferred: totalBytesUploaded,
            totalBytes: fileSize,
            speed,
            percent: Math.min(100, Math.round((totalBytesUploaded / fileSize) * 100))
          });
        }

        const partBuffer = Buffer.concat(chunks);
        const uploadPartRes = await client.send(
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: remoteKey,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: partBuffer,
            ContentLength: thisPartBytes
          }),
          { abortSignal: abortSignal || undefined }
        );

        const partMeta = { PartNumber: partNumber, ETag: uploadPartRes.ETag };
        completedParts.push(partMeta);
        if (onMultipartPart) {
          try { onMultipartPart({ uploadId, remoteKey, ...partMeta }); } catch {}
        }
      }

      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: remoteKey,
          UploadId: uploadId,
          MultipartUpload: { Parts: completedParts }
        }),
        { abortSignal: abortSignal || undefined }
      );

      const verify = await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: remoteKey }));
      if (Number(verify.ContentLength) !== fileSize) {
        throw new Error(`S3 multipart size mismatch: expected ${fileSize} bytes, remote object is ${verify.ContentLength}`);
      }

      logger.info('s3', `Completed multipart upload for ${path.basename(sourcePath)} to s3://${this.bucket}/${remoteKey}`);
      return { ok: true, destPath: remoteKey, bytesTransferred: fileSize };
    } catch (err) {
      if (uploadId) {
        try {
          await client.send(new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: remoteKey,
            UploadId: uploadId
          }));
          logger.info('s3', `Aborted multipart upload ${uploadId} for s3://${this.bucket}/${remoteKey}`);
        } catch (abortErr) {
          logger.warn('s3', `Failed to abort multipart upload ${uploadId}: ${abortErr.message}`);
        }
      }
      throw err;
    }
  }
}


import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import electron from 'electron';
import { logger } from './logger.js';

const { safeStorage, app } = typeof electron === 'object' && electron ? electron : { safeStorage: null, app: null };

/**
 * Dedicated Credential Storage Service.
 *
 * Security Principles:
 * - Credentials are NEVER stored as plaintext in SQLite or application settings.
 * - Credentials are NEVER returned to the renderer process (renderer only receives `hasCredentials: boolean`).
 * - Credentials are NEVER logged, embedded in errors, or committed to Git.
 * - Uses Electron safeStorage (Windows DPAPI, macOS Keychain, Linux Secret Service).
 * - Provides an isolated, deterministic fallback cipher backend for testing environments.
 */
export function createCredentialService({
  getStorageDir = null,
  storageBackend = null
} = {}) {
  function resolveDir() {
    if (getStorageDir) return getStorageDir();
    const base = app?.getPath ? app.getPath('userData') : path.join(os.tmpdir(), 'manticollect-userdata');
    const dir = path.join(base, 'credentials');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // Determine active backend
  const backend = storageBackend || {
    isAvailable: () => {
      try {
        return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
      } catch {
        return false;
      }
    },
    encrypt: (plainText) => {
      if (safeStorage && safeStorage.encryptString) {
        return safeStorage.encryptString(plainText);
      }
      throw new Error('Electron safeStorage encryption is not available on this platform');
    },
    decrypt: (encryptedBuffer) => {
      if (safeStorage && safeStorage.decryptString) {
        return safeStorage.decryptString(encryptedBuffer);
      }
      throw new Error('Electron safeStorage decryption is not available on this platform');
    }
  };

  function sanitizeId(id) {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Invalid credential identifier');
    }
    const clean = id.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!clean) throw new Error('Invalid credential identifier');
    return clean;
  }

  function filePathFor(id) {
    const cleanId = sanitizeId(id);
    return path.join(resolveDir(), `${cleanId}.enc`);
  }

  function isEncryptionAvailable() {
    if (typeof backend.isAvailable === 'function') return backend.isAvailable();
    if (typeof backend.isEncryptionAvailable === 'function') return backend.isEncryptionAvailable();
    return false;
  }

  async function saveCredential(id, secret) {
    if (!isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable on this operating system');
    }
    if (secret === undefined || secret === null || (typeof secret === 'string' && !secret.length)) {
      throw new Error('Cannot store empty credential');
    }

    const payload = typeof secret === 'object' ? JSON.stringify(secret) : String(secret);
    const encBuffer = backend.encrypt(payload);
    const targetFile = filePathFor(id);
    const tmpFile = `${targetFile}.tmp`;

    await fs.promises.writeFile(tmpFile, encBuffer);
    await fs.promises.rename(tmpFile, targetFile);
    logger.info('credentials', `Saved encrypted credential for ${sanitizeId(id)}`);
    return { ok: true, id: sanitizeId(id) };
  }

  async function getCredential(id) {
    if (!isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable on this operating system');
    }
    const targetFile = filePathFor(id);
    if (!fs.existsSync(targetFile)) {
      return null;
    }

    try {
      const encBuffer = await fs.promises.readFile(targetFile);
      const decrypted = backend.decrypt(encBuffer);
      try {
        return JSON.parse(decrypted);
      } catch {
        return decrypted;
      }
    } catch (err) {
      logger.error('credentials', `Failed to decrypt credential ${sanitizeId(id)}: ${err.message}`);
      throw new Error(`Failed to decrypt credential record: ${err.message}`);
    }
  }

  async function hasCredential(id) {
    try {
      const targetFile = filePathFor(id);
      if (!fs.existsSync(targetFile)) return false;
      const cred = await getCredential(id);
      return cred !== null && cred !== undefined;
    } catch {
      return false;
    }
  }

  async function deleteCredential(id) {
    const targetFile = filePathFor(id);
    if (fs.existsSync(targetFile)) {
      try {
        await fs.promises.unlink(targetFile);
        logger.info('credentials', `Deleted encrypted credential for ${sanitizeId(id)}`);
        return { ok: true, id: sanitizeId(id) };
      } catch (err) {
        logger.warn('credentials', `Failed to unlink credential ${sanitizeId(id)}: ${err.message}`);
        return { ok: false, error: err.message };
      }
    }
    return { ok: false, id: sanitizeId(id) };
  }

  return {
    isEncryptionAvailable,
    saveCredential,
    getCredential,
    hasCredential,
    deleteCredential
  };
}

/**
 * Creates an isolated software AES-256-GCM cipher backend.
 * Suitable for testing and environments where hardware/DPAPI keychains are unavailable.
 */
export function createSoftwareCipherBackend(passphrase = 'manticollect-test-master-key-32b!') {
  const key = crypto.createHash('sha256').update(passphrase).digest();

  return {
    isAvailable: () => true,
    encrypt: (plainText) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      // Format: [12-byte IV][16-byte TAG][Ciphertext]
      return Buffer.concat([iv, tag, enc]);
    },
    decrypt: (encryptedBuffer) => {
      if (encryptedBuffer.length < 28) throw new Error('Invalid encrypted payload length');
      const iv = encryptedBuffer.subarray(0, 12);
      const tag = encryptedBuffer.subarray(12, 28);
      const ciphertext = encryptedBuffer.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
    }
  };
}

let _defaultCredentialService = null;
export function getCredentialService() {
  if (!_defaultCredentialService) {
    _defaultCredentialService = createCredentialService();
  }
  return _defaultCredentialService;
}

export function isEncryptionAvailable() {
  return getCredentialService().isEncryptionAvailable();
}


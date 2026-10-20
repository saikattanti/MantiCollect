import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { getCredentialService } from './credentials.js';
import { logger } from './logger.js';

const ALLOWED_PROVIDERS = new Set(['local_nas', 'webdav', 'sftp']);

/**
 * Storage Connection Management Service.
 *
 * Coordinates non-secret connection metadata in SQLite and encrypted secrets in
 * the CredentialService.
 */
export function createStorageConnectionManager({
  getDbInstance = getDb,
  credentialService = null
} = {}) {
  const db = () => getDbInstance();
  const creds = () => credentialService || getCredentialService();

  function sanitizeForRenderer(row, hasSecret = false) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      provider_type: row.provider_type,
      host: row.host || null,
      port: row.port || null,
      base_path: row.base_path || null,
      username: row.username || null,
      allow_insecure_http: Boolean(row.allow_insecure_http),
      host_key_fingerprint: row.host_key_fingerprint || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_success_at: row.last_success_at || null,
      hasCredentials: Boolean(hasSecret)
    };
  }

  async function listConnections() {
    const rows = db().prepare('SELECT * FROM storage_connections ORDER BY created_at DESC').all();
    const result = [];
    for (const r of rows) {
      let hasSecret = false;
      if (r.credential_ref) {
        hasSecret = await creds().hasCredential(r.credential_ref);
      }
      result.push(sanitizeForRenderer(r, hasSecret));
    }
    return result;
  }

  async function getConnection(id) {
    if (!id || typeof id !== 'string') return null;
    const row = db().prepare('SELECT * FROM storage_connections WHERE id = ?').get(id);
    if (!row) return null;
    let hasSecret = false;
    if (row.credential_ref) {
      hasSecret = await creds().hasCredential(row.credential_ref);
    }
    return sanitizeForRenderer(row, hasSecret);
  }

  /**
   * Internal helper for main process only: loads connection with decrypted secret.
   * NEVER exposed to IPC or the renderer!
   */
  async function getInternalConnection(id) {
    if (!id || typeof id !== 'string') return null;
    const row = db().prepare('SELECT * FROM storage_connections WHERE id = ?').get(id);
    if (!row) return null;

    let secret = null;
    if (row.credential_ref) {
      try {
        secret = await creds().getCredential(row.credential_ref);
      } catch (err) {
        logger.warn('storage-connections', `Failed to load credential for ${row.id}: ${err.message}`);
      }
    }

    return {
      ...row,
      secret
    };
  }

  async function createConnection({
    name,
    provider_type,
    host = null,
    port = null,
    base_path = '',
    username = null,
    allow_insecure_http = false,
    host_key_fingerprint = null,
    secret = null
  }) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Connection name is required');
    }
    if (!ALLOWED_PROVIDERS.has(provider_type)) {
      throw new Error(`Unsupported provider type: ${provider_type}`);
    }

    if (provider_type === 'webdav' || provider_type === 'sftp') {
      if (!host || typeof host !== 'string' || !host.trim()) {
        throw new Error(`Host is required for ${provider_type.toUpperCase()} connection`);
      }
    }

    if (provider_type === 'local_nas') {
      if (!base_path || typeof base_path !== 'string' || !base_path.trim()) {
        throw new Error('Base folder path is required for Local NAS connection');
      }
    }

    const id = randomUUID();
    const now = Date.now();
    let credRef = null;

    if (secret && typeof secret === 'string' && secret.trim()) {
      credRef = `conn_${id}`;
      await creds().saveCredential(credRef, secret.trim());
    }

    db()
      .prepare(
        `INSERT INTO storage_connections (
          id, name, provider_type, host, port, base_path, username,
          credential_ref, host_key_fingerprint, allow_insecure_http,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        name.trim(),
        provider_type,
        host ? host.trim() : null,
        port ? Number(port) : null,
        base_path ? base_path.trim() : '',
        username ? username.trim() : null,
        credRef,
        host_key_fingerprint ? host_key_fingerprint.trim() : null,
        allow_insecure_http ? 1 : 0,
        now,
        now
      );

    logger.info('storage-connections', `Created ${provider_type} connection "${name}" (${id})`);
    return getConnection(id);
  }

  async function updateConnection(
    id,
    {
      name,
      host,
      port,
      base_path,
      username,
      allow_insecure_http,
      host_key_fingerprint,
      secret,
      removeSecret = false
    }
  ) {
    if (!id || typeof id !== 'string') throw new Error('Connection ID is required');
    const existing = db().prepare('SELECT * FROM storage_connections WHERE id = ?').get(id);
    if (!existing) throw new Error('Connection not found');

    const now = Date.now();
    let credRef = existing.credential_ref;

    if (removeSecret) {
      if (credRef) {
        await creds().deleteCredential(credRef);
        credRef = null;
      }
    } else if (secret && typeof secret === 'string' && secret.trim()) {
      // User provided a replacement secret
      if (!credRef) credRef = `conn_${id}`;
      await creds().saveCredential(credRef, secret.trim());
    }
    // If secret was empty string or undefined and removeSecret was false, existing credRef is preserved!

    const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
    const nextHost = host !== undefined ? (host ? host.trim() : null) : existing.host;
    const nextPort = port !== undefined ? (port ? Number(port) : null) : existing.port;
    const nextBasePath = base_path !== undefined ? (base_path ? base_path.trim() : '') : existing.base_path;
    const nextUsername = username !== undefined ? (username ? username.trim() : null) : existing.username;
    const nextAllowInsecure = allow_insecure_http !== undefined ? (allow_insecure_http ? 1 : 0) : existing.allow_insecure_http;
    const nextFingerprint = host_key_fingerprint !== undefined ? (host_key_fingerprint ? host_key_fingerprint.trim() : null) : existing.host_key_fingerprint;

    db()
      .prepare(
        `UPDATE storage_connections SET
          name = ?, host = ?, port = ?, base_path = ?, username = ?,
          credential_ref = ?, host_key_fingerprint = ?, allow_insecure_http = ?,
          updated_at = ?
         WHERE id = ?`
      )
      .run(
        nextName,
        nextHost,
        nextPort,
        nextBasePath,
        nextUsername,
        credRef,
        nextFingerprint,
        nextAllowInsecure,
        now,
        id
      );

    logger.info('storage-connections', `Updated connection "${nextName}" (${id})`);
    return getConnection(id);
  }

  async function deleteConnection(id) {
    if (!id || typeof id !== 'string') throw new Error('Connection ID is required');
    const existing = db().prepare('SELECT * FROM storage_connections WHERE id = ?').get(id);
    if (!existing) return { deleted: false };

    if (existing.credential_ref) {
      await creds().deleteCredential(existing.credential_ref);
    }

    const tx = db().transaction(() => {
      db().prepare('DELETE FROM storage_uploads WHERE connection_id = ?').run(id);
      db().prepare('DELETE FROM storage_connections WHERE id = ?').run(id);
    });
    tx();

    logger.info('storage-connections', `Deleted connection "${existing.name}" (${id})`);
    return { deleted: true, id };
  }

  function recordSuccess(id) {
    try {
      db().prepare('UPDATE storage_connections SET last_success_at = ? WHERE id = ?').run(Date.now(), id);
    } catch {}
  }

  return {
    listConnections,
    getConnection,
    getInternalConnection,
    createConnection,
    updateConnection,
    deleteConnection,
    recordSuccess
  };
}

let _defaultConnMgr = null;
export function getStorageConnectionManager() {
  if (!_defaultConnMgr) {
    _defaultConnMgr = createStorageConnectionManager();
  }
  return _defaultConnMgr;
}

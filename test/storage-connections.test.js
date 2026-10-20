import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorageConnectionManager } from '../electron/storageConnections.js';
import { createCredentialService, createSoftwareCipherBackend } from '../electron/credentials.js';

function createInMemoryTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storage_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      host TEXT,
      port INTEGER,
      base_path TEXT,
      username TEXT,
      credential_ref TEXT,
      host_key_fingerprint TEXT,
      allow_insecure_http INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_success_at INTEGER
    );

    CREATE TABLE storage_uploads (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      remote_path TEXT,
      status TEXT NOT NULL,
      bytes_done INTEGER DEFAULT 0,
      bytes_total INTEGER DEFAULT 0,
      speed INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
    );
  `);
  return db;
}

test('storage connections: validation of required fields and provider types', async () => {
  const db = createInMemoryTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-val-'));
  const creds = createCredentialService({
    storageBackend: createSoftwareCipherBackend(),
    getStorageDir: () => tmpDir
  });
  const mgr = createStorageConnectionManager({
    getDbInstance: () => db,
    credentialService: creds
  });

  // Missing name
  await assert.rejects(
    async () => mgr.createConnection({ name: '', provider_type: 'webdav', host: 'https://dav.test' }),
    /Connection name is required/
  );

  // Unsupported provider
  await assert.rejects(
    async () => mgr.createConnection({ name: 'FTP', provider_type: 'ftp_plain', host: 'ftp://test' }),
    /Unsupported provider type/
  );

  // WebDAV missing host
  await assert.rejects(
    async () => mgr.createConnection({ name: 'Cloud', provider_type: 'webdav', host: '' }),
    /Host is required/
  );

  // Local NAS missing base_path
  await assert.rejects(
    async () => mgr.createConnection({ name: 'NAS', provider_type: 'local_nas', base_path: '' }),
    /Base folder path is required/
  );

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('storage connections: create, list, get, and sanitize secrets for renderer', async () => {
  const db = createInMemoryTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-crud-'));
  const creds = createCredentialService({
    storageBackend: createSoftwareCipherBackend(),
    getStorageDir: () => tmpDir
  });
  const mgr = createStorageConnectionManager({
    getDbInstance: () => db,
    credentialService: creds
  });

  // Create WebDAV connection with secret
  const created = await mgr.createConnection({
    name: 'Nextcloud Work',
    provider_type: 'webdav',
    host: 'https://cloud.company.com/remote.php/webdav/',
    username: 'alice',
    secret: 'MySecretPassword123'
  });

  assert.ok(created.id);
  assert.equal(created.name, 'Nextcloud Work');
  assert.equal(created.hasCredentials, true);
  // Ensure secret is NOT in renderer object
  assert.equal(created.secret, undefined);
  assert.equal(created.credential_ref, undefined);

  // Verify SQLite row contains ONLY credential_ref, never plaintext secret
  const rawRow = db.prepare('SELECT * FROM storage_connections WHERE id = ?').get(created.id);
  assert.ok(rawRow.credential_ref);
  assert.equal(rawRow.secret, undefined);
  assert.equal(JSON.stringify(rawRow).includes('MySecretPassword123'), false, 'SQLite must NEVER contain plaintext secret');

  // Verify internal load can decrypt secret for main-process transfers
  const internal = await mgr.getInternalConnection(created.id);
  assert.equal(internal.secret, 'MySecretPassword123');

  // Verify list sanitized for renderer
  const list = await mgr.listConnections();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
  assert.equal(list[0].hasCredentials, true);
  assert.equal(list[0].secret, undefined);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('storage connections: update preserves existing secret when replacement is omitted', async () => {
  const db = createInMemoryTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-update-'));
  const creds = createCredentialService({
    storageBackend: createSoftwareCipherBackend(),
    getStorageDir: () => tmpDir
  });
  const mgr = createStorageConnectionManager({
    getDbInstance: () => db,
    credentialService: creds
  });

  const conn = await mgr.createConnection({
    name: 'SFTP Backup',
    provider_type: 'sftp',
    host: 'sftp.example.com',
    port: 2222,
    username: 'backupuser',
    secret: 'InitialKeyOrPassphrase'
  });

  // Edit name and port, leaving secret blank (undefined)
  const updated = await mgr.updateConnection(conn.id, {
    name: 'SFTP Primary Backup',
    port: 2200
  });

  assert.equal(updated.name, 'SFTP Primary Backup');
  assert.equal(updated.port, 2200);
  assert.equal(updated.hasCredentials, true);

  // Secret must still be preserved intact!
  const internal = await mgr.getInternalConnection(conn.id);
  assert.equal(internal.secret, 'InitialKeyOrPassphrase');

  // Replace secret with new value
  await mgr.updateConnection(conn.id, {
    secret: 'ReplacedNewPassword2026'
  });
  const internal2 = await mgr.getInternalConnection(conn.id);
  assert.equal(internal2.secret, 'ReplacedNewPassword2026');

  // Explicit removeSecret
  await mgr.updateConnection(conn.id, {
    removeSecret: true
  });
  const updatedNoSecret = await mgr.getConnection(conn.id);
  assert.equal(updatedNoSecret.hasCredentials, false);
  const internal3 = await mgr.getInternalConnection(conn.id);
  assert.equal(internal3.secret, null);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('storage connections: delete cascades and clears encrypted credential file', async () => {
  const db = createInMemoryTestDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-del-'));
  const creds = createCredentialService({
    storageBackend: createSoftwareCipherBackend(),
    getStorageDir: () => tmpDir
  });
  const mgr = createStorageConnectionManager({
    getDbInstance: () => db,
    credentialService: creds
  });

  const conn = await mgr.createConnection({
    name: 'Temporary NAS',
    provider_type: 'local_nas',
    base_path: '/mnt/storage',
    secret: 'OptionalNasPassword'
  });

  assert.equal(await creds.hasCredential(`conn_${conn.id}`), true);

  // Delete connection
  const res = await mgr.deleteConnection(conn.id);
  assert.equal(res.deleted, true);

  // Verify removed from DB
  assert.equal(await mgr.getConnection(conn.id), null);

  // Verify encrypted file on disk was removed
  assert.equal(await creds.hasCredential(`conn_${conn.id}`), false);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

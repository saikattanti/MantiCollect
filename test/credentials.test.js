import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createCredentialService,
  createSoftwareCipherBackend
} from '../electron/credentials.js';

test('credentials: availability and safe fallback', async () => {
  // Mock backend where encryption is unavailable
  const unavailableBackend = {
    isAvailable: () => false,
    encrypt: () => { throw new Error('Encryption unavailable'); },
    decrypt: () => { throw new Error('Encryption unavailable'); }
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-unavail-'));
  const svc = createCredentialService({
    storageBackend: unavailableBackend,
    getStorageDir: () => tmpDir
  });

  assert.equal(svc.isEncryptionAvailable(), false);
  await assert.rejects(
    async () => svc.saveCredential('ref1', 'mySecretPassword'),
    /Secure credential storage is unavailable/
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('credentials: save, retrieve, replace, delete roundtrip', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-roundtrip-'));
  const backend = createSoftwareCipherBackend('test-passphrase-32-chars-long-!!');
  const svc = createCredentialService({
    storageBackend: backend,
    getStorageDir: () => tmpDir
  });

  assert.equal(svc.isEncryptionAvailable(), true);

  // 1. Initially missing
  assert.equal(await svc.hasCredential('conn_123'), false);
  assert.equal(await svc.getCredential('conn_123'), null);

  // 2. Save credential
  const saveRes = await svc.saveCredential('conn_123', 'SuperSecretP@ssw0rd!');
  assert.equal(saveRes.ok, true);
  assert.equal(await svc.hasCredential('conn_123'), true);

  // 3. Retrieve credential
  const retrieved = await svc.getCredential('conn_123');
  assert.equal(retrieved, 'SuperSecretP@ssw0rd!');

  // 4. Verify on-disk file is ENCRYPTED and does not contain plaintext
  const diskFiles = fs.readdirSync(tmpDir);
  assert.ok(diskFiles.length > 0);
  const diskContent = fs.readFileSync(path.join(tmpDir, diskFiles[0]));
  assert.ok(!diskContent.includes('SuperSecretP@ssw0rd!'), 'Ciphertext on disk must NEVER contain plaintext secret');

  // 5. Replace credential
  await svc.saveCredential('conn_123', 'NewReplacedSecret#2026');
  assert.equal(await svc.getCredential('conn_123'), 'NewReplacedSecret#2026');

  // 6. Delete credential
  const delRes = await svc.deleteCredential('conn_123');
  assert.equal(delRes.ok, true);
  assert.equal(await svc.hasCredential('conn_123'), false);
  assert.equal(await svc.getCredential('conn_123'), null);

  // Deleting again returns ok: false cleanly
  const delAgain = await svc.deleteCredential('conn_123');
  assert.equal(delAgain.ok, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('credentials: handles corrupted encrypted file safely without crashing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-corrupt-'));
  const backend = createSoftwareCipherBackend('test-passphrase-32-chars-long-!!');
  const svc = createCredentialService({
    storageBackend: backend,
    getStorageDir: () => tmpDir
  });

  await svc.saveCredential('conn_corrupt', 'ValidSecretBeforeCorruption');

  // Deliberately corrupt the file on disk
  const encFile = path.join(tmpDir, 'conn_corrupt.enc');
  assert.ok(fs.existsSync(encFile));
  fs.writeFileSync(encFile, Buffer.from([0x00, 0xde, 0xad, 0xbe, 0xef, 0xff]));

  // hasCredential handles the error cleanly and returns false
  assert.equal(await svc.hasCredential('conn_corrupt'), false);

  // getCredential throws a clean sanitized error rather than crashing
  await assert.rejects(
    async () => svc.getCredential('conn_corrupt'),
    /Failed to decrypt credential record/
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('credentials: invalid inputs rejected strictly without leaking secret', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-invalid-'));
  const backend = createSoftwareCipherBackend('test-passphrase-32-chars-long-!!');
  const svc = createCredentialService({
    storageBackend: backend,
    getStorageDir: () => tmpDir
  });

  await assert.rejects(async () => svc.saveCredential('', 'secret'), /Invalid credential identifier/);
  await assert.rejects(async () => svc.saveCredential('ref', ''), /Cannot store empty credential/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

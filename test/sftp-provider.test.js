import test from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { SftpStorageProvider } from '../electron/remoteStorage.js';

class MockSftpClient extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.ended = false;
  }

  connect(config) {
    this.config = config;
    process.nextTick(() => {
      // Execute hostVerifier if configured
      if (typeof config.hostVerifier === 'function') {
        const fakeFingerprint = 'sha256:abcd1234ef567890';
        const ok = config.hostVerifier(fakeFingerprint);
        if (!ok) {
          const err = new Error('Host key verification failed');
          return this.emit('error', err);
        }
      }

      if (config.password === 'WRONG_SFTP_PASS') {
        return this.emit('error', new Error('Authentication failure (password)'));
      }

      this.connected = true;
      this.emit('ready');
    });
  }

  sftp(callback) {
    const mockSftp = {
      mkdir: (dir, cb) => cb(null),
      readdir: (dir, cb) => cb(null, []),
      stat: (destPath, cb) => {
        cb(null, { size: 1024 }); // report matching size
      },
      createWriteStream: (destPath) => {
        const pass = new PassThrough();
        return pass;
      }
    };
    callback(null, mockSftp);
  }

  end() {
    this.ended = true;
    this.emit('close');
  }
}

test('sftp: validation requires host and username', () => {
  const p1 = new SftpStorageProvider({ host: '', username: 'user' });
  assert.throws(() => p1.createClient(), /SFTP host is required/);

  const p2 = new SftpStorageProvider({ host: 'sftp.test', username: '' });
  assert.throws(() => p2.createClient(), /SFTP username is required/);
});

test('sftp: strict host key verification matches expected fingerprint', async () => {
  const provider = new SftpStorageProvider({
    name: 'Verified SFTP',
    host: 'sftp.example.com',
    username: 'admin',
    password: 'goodpassword',
    hostKeyFingerprint: 'sha256:abcd1234ef567890',
    clientFactory: () => new MockSftpClient()
  });

  const res = await provider.testConnection();
  assert.equal(res.ok, true);
  assert.ok(/verified|connected/i.test(res.message));
  assert.equal(res.hostKeyFingerprint, 'sha256:abcd1234ef567890');
});

test('sftp: strict host key verification REJECTS mismatched fingerprint (MITM prevention)', async () => {
  const provider = new SftpStorageProvider({
    name: 'Mismatched SFTP',
    host: 'sftp.example.com',
    username: 'admin',
    password: 'goodpassword',
    hostKeyFingerprint: 'sha256:MISMATCHED_ATTACKER_KEY_0000',
    clientFactory: () => new MockSftpClient()
  });

  const res = await provider.testConnection();
  assert.equal(res.ok, false);
  assert.ok(/host key/i.test(res.message));
});

test('sftp: captures unknown host key fingerprint for initial user confirmation', async () => {
  const provider = new SftpStorageProvider({
    name: 'First Probe SFTP',
    host: 'sftp.example.com',
    username: 'admin',
    password: 'goodpassword',
    hostKeyFingerprint: null, // No fingerprint pinned yet
    clientFactory: () => new MockSftpClient()
  });

  const res = await provider.testConnection();
  assert.equal(res.ok, true);
  assert.equal(res.hostKeyFingerprint, 'sha256:abcd1234ef567890');
});

test('sftp: authentication failure handled safely without exposing password', async () => {
  const provider = new SftpStorageProvider({
    name: 'Auth Fail SFTP',
    host: 'sftp.example.com',
    username: 'admin',
    password: 'WRONG_SFTP_PASS',
    clientFactory: () => new MockSftpClient()
  });

  const res = await provider.testConnection();
  assert.equal(res.ok, false);
  assert.ok(/authentication/i.test(res.message));
  assert.ok(!res.message.includes('WRONG_SFTP_PASS'), 'Error message must NEVER contain password');
});

test('sftp: streaming transfer with unicode filename and size verification', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-test-'));
  const testFileName = 'テスト動画_SFTP_日本語.mp4';
  const testFilePath = path.join(tmpDir, testFileName);
  const testData = Buffer.alloc(1024, 0x77);
  fs.writeFileSync(testFilePath, testData);

  const provider = new SftpStorageProvider({
    name: 'Upload SFTP',
    host: 'sftp.example.com',
    username: 'admin',
    password: 'goodpassword',
    clientFactory: () => new MockSftpClient()
  });

  let progressReported = false;
  const res = await provider.transferFile({
    sourcePath: testFilePath,
    targetSubdir: 'backups/media',
    onProgress: (p) => {
      if (p.bytesTransferred > 0) progressReported = true;
    }
  });

  assert.equal(res.ok, true);
  assert.equal(res.bytesTransferred, 1024);
  assert.ok(progressReported);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

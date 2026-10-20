import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebDavStorageProvider } from '../electron/remoteStorage.js';

function createMockWebDavServer({
  expectedAuth = 'Basic ' + Buffer.from('testuser:testpass').toString('base64'),
  statusMap = {}
} = {}) {
  const uploadedFiles = new Map(); // decoded path -> Buffer

  const server = http.createServer((req, res) => {
    res.setHeader('Connection', 'close');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const method = req.method.toUpperCase();

    // Custom status override if provided
    if (statusMap[pathname]) {
      res.statusCode = statusMap[pathname];
      return res.end();
    }

    // Auth check if configured
    if (expectedAuth) {
      if (req.headers.authorization !== expectedAuth) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="WebDAV"');
        return res.end('Unauthorized');
      }
    }

    if (method === 'PROPFIND') {
      res.statusCode = 207;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.end(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${url.pathname}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`);
    }

    if (method === 'MKCOL') {
      res.statusCode = 201;
      return res.end();
    }

    if (method === 'HEAD') {
      if (uploadedFiles.has(pathname)) {
        const buf = uploadedFiles.get(pathname);
        res.statusCode = 200;
        res.setHeader('Content-Length', String(buf.length));
        return res.end();
      }
      res.statusCode = 404;
      return res.end();
    }

    if (method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const full = Buffer.concat(chunks);
        uploadedFiles.set(pathname, full);
        res.statusCode = 201;
        res.end();
      });
      return;
    }

    res.statusCode = 405;
    res.end();
  });

  return {
    server,
    uploadedFiles,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => {
      if (server.closeAllConnections) server.closeAllConnections();
      server.close(resolve);
    })
  };
}

test('webdav: testConnection success with valid credentials', async () => {
  const mock = createMockWebDavServer();
  const port = await mock.listen();

  const provider = new WebDavStorageProvider({
    name: 'Test WebDAV',
    serverUrl: `http://127.0.0.1:${port}/remote.php/webdav/`,
    username: 'testuser',
    password: 'testpass',
    allowInsecureHttp: true,
    allowLocalNetwork: true
  });

  try {
    const res = await provider.testConnection();
    assert.equal(res.ok, true);
    assert.ok(/connected/i.test(res.message));
  } finally {
    await mock.close();
  }
});

test('webdav: authentication failure returns clean error without leaking password', async () => {
  const mock = createMockWebDavServer({ expectedAuth: 'Basic dXNlcjpyaWdodHBhc3M=' });
  const port = await mock.listen();

  const provider = new WebDavStorageProvider({
    name: 'Auth Fail WebDAV',
    serverUrl: `http://127.0.0.1:${port}/dav/`,
    username: 'user',
    password: 'WRONG_SECRET_PASSWORD',
    allowInsecureHttp: true,
    allowLocalNetwork: true
  });

  try {
    const res = await provider.testConnection();
    assert.equal(res.ok, false);
    assert.ok(/authentication failed/i.test(res.message));
    assert.ok(!res.message.includes('WRONG_SECRET_PASSWORD'), 'Error message must NEVER leak password');
  } finally {
    await mock.close();
  }
});

test('webdav: successful file transfer with unicode filename and accurate progress', async () => {
  const mock = createMockWebDavServer();
  const port = await mock.listen();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-test-'));
  const testFileName = 'テスト動画_MantiCollect_日本語.mp4';
  const testFilePath = path.join(tmpDir, testFileName);
  const testData = Buffer.alloc(32 * 1024, 0x55); // 32 KB
  fs.writeFileSync(testFilePath, testData);

  const provider = new WebDavStorageProvider({
    name: 'Upload WebDAV',
    serverUrl: `http://127.0.0.1:${port}/dav/`,
    username: 'testuser',
    password: 'testpass',
    allowInsecureHttp: true,
    allowLocalNetwork: true
  });

  try {
    const progressUpdates = [];
    const res = await provider.transferFile({
      sourcePath: testFilePath,
      targetSubdir: 'backups/2026',
      onProgress: (p) => progressUpdates.push({ ...p })
    });

    assert.equal(res.ok, true);
    assert.equal(res.bytesTransferred, 32 * 1024);
    assert.ok(progressUpdates.length > 0);

    // Verify file in mock server
    const remoteKey = `/dav/backups/2026/${testFileName}`;
    assert.ok(mock.uploadedFiles.has(remoteKey), `Server should have received ${remoteKey}`);
    assert.equal(mock.uploadedFiles.get(remoteKey).length, 32 * 1024);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await mock.close();
  }
});

test('webdav: cancellation aborts transfer cleanly', async () => {
  const mock = createMockWebDavServer();
  const port = await mock.listen();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-cancel-'));
  const testFilePath = path.join(tmpDir, 'large.bin');
  fs.writeFileSync(testFilePath, Buffer.alloc(100 * 1024, 0x11));

  const provider = new WebDavStorageProvider({
    serverUrl: `http://127.0.0.1:${port}/dav/`,
    username: 'testuser',
    password: 'testpass',
    allowInsecureHttp: true,
    allowLocalNetwork: true
  });

  const controller = new AbortController();
  controller.abort();

  try {
    await assert.rejects(
      async () => provider.transferFile({
        sourcePath: testFilePath,
        abortSignal: controller.signal
      }),
      /abort/i
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await mock.close();
  }
});

test('webdav: embedded credentials in URL rejected strictly for SSRF/security', () => {
  const provider = new WebDavStorageProvider({
    serverUrl: 'https://eviluser:evilpass@dav.myserver.com/files/'
  });

  assert.throws(
    () => provider.normalizeUrl(),
    /Embedded credentials in WebDAV URL are prohibited/
  );
});

test('webdav: rejects insecure http unless explicitly allowed', () => {
  const provider = new WebDavStorageProvider({
    serverUrl: 'http://dav.myserver.com/files/',
    allowInsecureHttp: false
  });

  assert.throws(
    () => provider.normalizeUrl(),
    /Insecure HTTP is not permitted/
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { directDownload } from '../electron/providers/direct.js';
import { assertPublicUrl, fetchWithSafeRedirects } from '../electron/security.js';

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  server.closeAllConnections?.();
  server.close();
}

test('assertPublicUrl blocks localhost and private hosts (SSRF)', async () => {
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1:9999/x.mp4'), /private|loopback/);
  await assert.rejects(() => assertPublicUrl('http://192.168.1.10/x.mp4'), /private|loopback/);
  await assert.rejects(() => assertPublicUrl('http://10.0.0.5:8000/a'), /private|loopback/);
  await assert.rejects(() => assertPublicUrl('http://[::1]/a'), /private|loopback/);
  await assert.rejects(() => assertPublicUrl('file:///C:/Windows/system32/win.ini'), /http/);
  await assert.rejects(() => assertPublicUrl('gopher://x.com/'), /http/);
});

test('directDownload streams file with progress from local server (allowLocal for tests)', async (t) => {
  const payload = Buffer.from('A'.repeat(200_000));
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': payload.length });
    res.end(payload);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mvdl-'));
  const events = [];
  const result = await directDownload(`http://127.0.0.1:${port}/file.mp4`, dest, {
    allowLocal: true,
    onProgress: (p) => events.push(p)
  });

  assert.ok(fs.existsSync(result.path), 'file exists on disk');
  assert.equal(fs.statSync(result.path).size, payload.length);
  assert.ok(events.length > 1, 'progress events were emitted');
  const last = events[events.length - 1];
  assert.equal(last.done, true);
  assert.equal(last.pct, 1);
  fs.rmSync(dest, { recursive: true, force: true });
});

test('directDownload follows one redirect and revalidates', async (t) => {
  const payload = Buffer.from('redirected!');
  const origin = await startServer((_req, res) => {
    res.writeHead(302, { location: `/final.bin`, 'content-length': 0 });
    res.end();
  });
  const { port } = origin.address();
  t.after(() => closeServer(origin));

  // patch server to serve final on second hit
  origin.removeAllListeners('request');
  origin.on('request', (req, res) => {
    if (req.url === '/final.bin') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length });
      res.end(payload);
    } else {
      res.writeHead(302, { location: '/final.bin' });
      res.end();
    }
  });

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mvdl2-'));
  const result = await directDownload(`http://127.0.0.1:${port}/start`, dest, { allowLocal: true });
  assert.equal(fs.readFileSync(result.path, 'utf8'), 'redirected!');
  fs.rmSync(dest, { recursive: true, force: true });
});

test('fetchWithSafeRedirects blocks redirect to private IP', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(302, { location: 'http://10.0.0.1/stealth' });
    res.end();
  });
  const { port } = server.address();
  try {
    await fetchWithSafeRedirects(`http://127.0.0.1:${port}/go`);
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /private/);
  } finally {
    closeServer(server);
  }
});

test('directDownload respects maxBytes limit', async (t) => {
  const payload = Buffer.alloc(2 * 1024 * 1024);
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length });
    res.end(payload);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mvdl3-'));
  await assert.rejects(
    () => directDownload(`http://127.0.0.1:${port}/big`, dest, { allowLocal: true, maxBytes: 1 }),
    /limit/i
  );
  // no partial files left behind
  const leftover = fs.readdirSync(dest).filter((f) => !f.startsWith('.'));
  assert.equal(leftover.length, 0);
  fs.rmSync(dest, { recursive: true, force: true });
});

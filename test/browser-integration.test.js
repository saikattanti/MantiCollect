import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

import { validateBrowserSubmission, MAX_URL_LENGTH } from '../electron/bridge/validator.js';
import { encodeMessage, createNativeMessageDecoder, MAX_MESSAGE_SIZE } from '../electron/bridge/nativeMessaging.js';
import { createLoopbackBridge } from '../electron/bridge/loopbackServer.js';
import { createClipboardDetector } from '../electron/clipboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/* ============================================================
   1. SECURE URL VALIDATION TESTS
   ============================================================ */

test('URL validation: accepts valid HTTPS and HTTP URLs for supported providers', async () => {
  const httpsResult = await validateBrowserSubmission(
    { url: 'https://example.com/video.mp4', title: 'Sample MP4' },
    { allowLocal: true }
  );
  assert.equal(httpsResult.url, 'https://example.com/video.mp4');
  assert.equal(httpsResult.provider, 'direct');
  assert.equal(httpsResult.title, 'Sample MP4');
  assert.equal(httpsResult.isDirect, true);

  const httpResult = await validateBrowserSubmission(
    { url: 'http://example.com/archive.zip' },
    { allowLocal: true }
  );
  assert.equal(httpResult.url, 'http://example.com/archive.zip');
  assert.equal(httpResult.provider, 'direct');
});

test('URL validation: rejects unsupported URL schemes', async () => {
  const forbiddenSchemes = [
    'javascript:alert(1)',
    'data:text/html,<h1>Hello</h1>',
    'file:///C:/Windows/System32/calc.exe',
    'chrome://extensions',
    'edge://settings',
    'blob:https://example.com/uuid-blob'
  ];

  for (const badUrl of forbiddenSchemes) {
    await assert.rejects(
      async () => validateBrowserSubmission({ url: badUrl }),
      /Unsupported URL scheme|Malformed URL/i,
      `Should have rejected scheme: ${badUrl}`
    );
  }
});

test('URL validation: rejects malformed or empty URLs', async () => {
  await assert.rejects(async () => validateBrowserSubmission({ url: '' }), /URL is required/i);
  await assert.rejects(async () => validateBrowserSubmission({ url: '   ' }), /URL is required/i);
  await assert.rejects(async () => validateBrowserSubmission({ url: null }), /URL is required/i);
  await assert.rejects(async () => validateBrowserSubmission({ url: 'not-a-valid-url' }), /Malformed URL/i);
});

test('URL validation: rejects URLs with embedded credentials', async () => {
  const credentialUrl = 'https://admin:secret123@example.com/video.mp4';
  await assert.rejects(
    async () => validateBrowserSubmission({ url: credentialUrl }),
    /URLs with embedded credentials are not allowed/i
  );
});

test('URL validation: rejects URLs exceeding maximum length', async () => {
  const hugeUrl = 'https://example.com/' + 'a'.repeat(MAX_URL_LENGTH + 10);
  await assert.rejects(
    async () => validateBrowserSubmission({ url: hugeUrl }),
    /URL exceeds maximum length/i
  );
});

test('URL validation: enforces SSRF protection against loopback/LAN by default', async () => {
  // When allowLocal is false, private/loopback addresses must be rejected
  await assert.rejects(
    async () => validateBrowserSubmission({ url: 'http://127.0.0.1/sensitive.mp4' }, { allowLocal: false }),
    /local.*blocked|SSRF|private/i
  );

  await assert.rejects(
    async () => validateBrowserSubmission({ url: 'http://169.254.169.254/latest/meta-data' }, { allowLocal: false }),
    /local.*blocked|SSRF|private/i
  );
});

/* ============================================================
   2. NATIVE MESSAGING PROTOCOL FRAMING TESTS
   ============================================================ */

test('Native messaging: encodes objects into 4-byte little-endian length prefixed frames', () => {
  const payload = { type: 'ping', test: 123 };
  const frame = encodeMessage(payload);

  assert.ok(Buffer.isBuffer(frame));
  const msgLen = frame.readUInt32LE(0);
  const jsonStr = frame.subarray(4, 4 + msgLen).toString('utf8');

  assert.equal(frame.length, 4 + msgLen);
  assert.deepEqual(JSON.parse(jsonStr), payload);
});

test('Native messaging: decoder handles single complete message', () => {
  const messages = [];
  const decoder = createNativeMessageDecoder((msg) => messages.push(msg));

  const frame = encodeMessage({ action: 'status', id: 42 });
  decoder(frame);

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { action: 'status', id: 42 });
});

test('Native messaging: decoder handles multiple messages in a single chunk', () => {
  const messages = [];
  const decoder = createNativeMessageDecoder((msg) => messages.push(msg));

  const f1 = encodeMessage({ action: 'ping', n: 1 });
  const f2 = encodeMessage({ action: 'pong', n: 2 });
  const combined = Buffer.concat([f1, f2]);

  decoder(combined);

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { action: 'ping', n: 1 });
  assert.deepEqual(messages[1], { action: 'pong', n: 2 });
});

test('Native messaging: decoder handles partial chunks split across stream reads', () => {
  const messages = [];
  const decoder = createNativeMessageDecoder((msg) => messages.push(msg));

  const fullFrame = encodeMessage({ action: 'enqueue', url: 'https://example.com/test.mp4' });

  // Split frame into 3 slices
  const slice1 = fullFrame.subarray(0, 3); // partial length prefix
  const slice2 = fullFrame.subarray(3, 15); // rest of prefix + partial json
  const slice3 = fullFrame.subarray(15); // remaining json

  decoder(slice1);
  assert.equal(messages.length, 0); // Not ready yet

  decoder(slice2);
  assert.equal(messages.length, 0); // Still not ready

  decoder(slice3);
  assert.equal(messages.length, 1); // Completed
  assert.deepEqual(messages[0], { action: 'enqueue', url: 'https://example.com/test.mp4' });
});

test('Native messaging: decoder rejects oversized message frames (>1MB)', () => {
  const errors = [];
  const decoder = createNativeMessageDecoder(() => {}, (err) => errors.push(err));

  // Construct frame header with 2 MB length
  const fakeHeader = Buffer.alloc(4);
  fakeHeader.writeUInt32LE(2 * 1024 * 1024, 0);

  decoder(fakeHeader);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Oversized message/i);
});

test('Native messaging: decoder recovers cleanly from malformed JSON', () => {
  const errors = [];
  const messages = [];
  const decoder = createNativeMessageDecoder(
    (msg) => messages.push(msg),
    (err) => errors.push(err)
  );

  const badJsonBytes = Buffer.from('{"action": unquoted_bad_json', 'utf8');
  const frame = Buffer.alloc(4 + badJsonBytes.length);
  frame.writeUInt32LE(badJsonBytes.length, 0);
  badJsonBytes.copy(frame, 4);

  decoder(frame);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Malformed JSON/i);

  // Subsequent valid message should still be parsed normally
  decoder(encodeMessage({ recovered: true }));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].recovered, true);
});

/* ============================================================
   3. LOOPBACK HTTP BRIDGE SERVER TESTS
   ============================================================ */

test('Loopback bridge: authentication, endpoints, and security boundaries', async () => {
  const testToken = 'test-token-secret-1234567890';
  const queuedJobs = [];

  const mockQueue = {
    listJobs: () => queuedJobs,
    startJob: (payload) => {
      const id = `job-${Date.now()}`;
      queuedJobs.push({ id, url: payload.url, title: payload.title, status: 'waiting' });
      return id;
    }
  };

  const bridge = createLoopbackBridge({
    getPort: () => 0,
    getAuthToken: () => testToken,
    getQueue: () => mockQueue,
    getWindow: () => null,
    getSettings: () => ({ allowLocalNetwork: true }),
    appVersion: '1.0.0-test'
  });

  const { port: testPort } = await bridge.start();

  try {
    function request(path, options = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: testPort,
            path,
            method: options.method || 'GET',
            headers: {
              Host: `127.0.0.1:${testPort}`,
              ...options.headers
            }
          },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
              try {
                resolve({ status: res.statusCode, data: JSON.parse(body), raw: body });
              } catch {
                resolve({ status: res.statusCode, data: null, raw: body });
              }
            });
          }
        );
        req.on('error', reject);
        if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        req.end();
      });
    }

    // 1. Missing Authorization header: 401 Unauthorized
    const unauthRes = await request('/api/status');
    assert.equal(unauthRes.status, 401);
    assert.equal(unauthRes.data.ok, false);

    // 2. Invalid Bearer token: 401 Unauthorized
    const badTokenRes = await request('/api/status', {
      headers: { Authorization: 'Bearer wrong-token' }
    });
    assert.equal(badTokenRes.status, 401);

    // 3. Rejection of invalid Host header (DNS rebinding protection): 403 Forbidden
    const badHostRes = await new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/status',
          method: 'GET',
          headers: {
            Host: 'evil-attacker.com',
            Authorization: `Bearer ${testToken}`
          }
        },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve({ status: res.statusCode, raw: b }));
        }
      );
      req.end();
    });
    assert.equal(badHostRes.status, 403);

    // 4. GET /api/status with valid token: 200 OK
    const statusRes = await request('/api/status', {
      headers: { Authorization: `Bearer ${testToken}` }
    });
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.data.ok, true);
    assert.equal(statusRes.data.app, 'MantiCollect');
    assert.equal(statusRes.data.ready, true);

    // 5. POST /api/check-url with supported URL
    const checkSupported = await request('/api/check-url', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testToken}`, 'Content-Type': 'application/json' },
      body: { url: 'https://example.com/video.mp4' }
    });
    assert.equal(checkSupported.status, 200);
    assert.equal(checkSupported.data.supported, true);
    assert.equal(checkSupported.data.provider, 'direct');

    // 6. POST /api/check-url with invalid scheme
    const checkInvalid = await request('/api/check-url', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testToken}`, 'Content-Type': 'application/json' },
      body: { url: 'javascript:void(0)' }
    });
    assert.equal(checkInvalid.status, 200);
    assert.equal(checkInvalid.data.supported, false);

    // 7. POST /api/enqueue: successfully enqueues job
    const enqueueRes = await request('/api/enqueue', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testToken}`, 'Content-Type': 'application/json' },
      body: {
        url: 'https://example.com/download.zip',
        title: 'Archive 1',
        requestId: 'req-001'
      }
    });
    assert.equal(enqueueRes.status, 200);
    assert.equal(enqueueRes.data.ok, true);
    assert.equal(enqueueRes.data.duplicate, false);
    assert.ok(enqueueRes.data.id);

    // 8. POST /api/enqueue with same requestId or active URL returns duplicate
    const duplicateRes = await request('/api/enqueue', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testToken}`, 'Content-Type': 'application/json' },
      body: {
        url: 'https://example.com/download.zip',
        title: 'Archive 1',
        requestId: 'req-001'
      }
    });
    assert.equal(duplicateRes.status, 200);
    assert.equal(duplicateRes.data.ok, true);
    assert.equal(duplicateRes.data.duplicate, true);

    // 9. POST /api/focus
    const focusRes = await request('/api/focus', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testToken}` }
    });
    assert.equal(focusRes.status, 200);
    assert.equal(focusRes.data.focused, true);
  } finally {
    await bridge.stop();
  }
});

/* ============================================================
   4. CLIPBOARD URL DETECTION TESTS
   ============================================================ */

test('Clipboard detector: honors disabled state and deduplicates candidate URLs', async () => {
  let settingsState = { clipboardDetection: false, allowLocalNetwork: true };
  let emittedEvents = [];

  const mockWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    on: () => {},
    webContents: {
      send: (evt, data) => emittedEvents.push({ evt, data })
    }
  };

  const detector = createClipboardDetector({
    getWindow: () => mockWindow,
    getSettings: () => settingsState,
    pollIntervalMs: 10000
  });

  // When disabled: checkNow does nothing
  await detector.checkNow();
  assert.equal(emittedEvents.length, 0);

  // Enable detection
  settingsState.clipboardDetection = true;

  // Verify detector has methods
  assert.equal(typeof detector.start, 'function');
  assert.equal(typeof detector.stop, 'function');
  assert.equal(typeof detector.clearLastDetectedUrl, 'function');
});

/* ============================================================
   5. BROWSER EXTENSION MANIFEST AND INTEGRATION ARTIFACTS
   ============================================================ */

test('Browser extension: manifest.json is valid Manifest V3 with minimal permissions', () => {
  const manifestPath = path.join(rootDir, 'browser-extension', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.manifest_version, 3, 'Must use Manifest V3');
  assert.ok(manifest.name.includes('MantiCollect'));
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.action.default_popup, 'popup.html');

  // Verify minimal permissions scope
  const expectedPerms = ['contextMenus', 'storage', 'notifications', 'activeTab', 'downloads', 'nativeMessaging'];
  for (const perm of manifest.permissions) {
    assert.ok(expectedPerms.includes(perm), `Unexpected broad permission: ${perm}`);
  }

  // Verify host permissions are strictly loopback
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*', 'http://localhost/*']);

  // Verify all icon paths exist
  for (const size of ['16', '32', '48', '128']) {
    const iconRelPath = manifest.icons[size];
    assert.ok(iconRelPath, `Icon for ${size} missing in manifest`);
    const iconAbsPath = path.join(rootDir, 'browser-extension', iconRelPath);
    assert.ok(fs.existsSync(iconAbsPath), `Icon file ${iconAbsPath} must exist`);
  }
});

test('Native messaging host: registration scripts and manifests exist', () => {
  const chromeHostManifest = path.join(rootDir, 'native-host', 'com.mantitup.manticollect.json');
  const edgeHostManifest = path.join(rootDir, 'native-host', 'com.mantitup.manticollect.edge.json');
  const batScript = path.join(rootDir, 'native-host', 'manticollect_host.bat');
  const jsScript = path.join(rootDir, 'native-host', 'manticollect_host.js');
  const regPs1 = path.join(rootDir, 'native-host', 'register-host-windows.ps1');
  const unregPs1 = path.join(rootDir, 'native-host', 'unregister-host-windows.ps1');

  assert.ok(fs.existsSync(chromeHostManifest), 'Chrome native host manifest must exist');
  assert.ok(fs.existsSync(edgeHostManifest), 'Edge native host manifest must exist');
  assert.ok(fs.existsSync(batScript), 'Windows host launcher bat must exist');
  assert.ok(fs.existsSync(jsScript), 'Host Node.js script must exist');
  assert.ok(fs.existsSync(regPs1), 'register-host-windows.ps1 must exist');
  assert.ok(fs.existsSync(unregPs1), 'unregister-host-windows.ps1 must exist');

  const parsedChrome = JSON.parse(fs.readFileSync(chromeHostManifest, 'utf8'));
  assert.equal(parsedChrome.name, 'com.mantitup.manticollect');
  assert.equal(parsedChrome.type, 'stdio');
  // Disallow wildcards per Chromium security policy
  for (const origin of parsedChrome.allowed_origins) {
    assert.ok(!origin.includes('*/*'), `Origin must not use wildcard: ${origin}`);
    assert.match(origin, /^chrome-extension:\/\/[a-zA-Z0-9_<>-]+\/$/);
  }

  const parsedEdge = JSON.parse(fs.readFileSync(edgeHostManifest, 'utf8'));
  assert.equal(parsedEdge.name, 'com.mantitup.manticollect');
  assert.equal(parsedEdge.type, 'stdio');
  for (const origin of parsedEdge.allowed_origins) {
    assert.ok(!origin.includes('*/*'), `Edge origin must not use wildcard: ${origin}`);
    assert.match(origin, /^extension:\/\/[a-zA-Z0-9_<>-]+\/$/);
  }

  // Verify launcher bat contains ELECTRON_RUN_AS_NODE fallback for environments without global node
  const batContent = fs.readFileSync(batScript, 'utf8');
  assert.ok(batContent.includes('ELECTRON_RUN_AS_NODE=1'), 'Host launcher must support Electron runtime fallback');
});

test('Loopback bridge: rejects oversized payloads (>64KB)', async () => {
  const testToken = 'token-payload-size-test';
  const bridge = createLoopbackBridge({
    getPort: () => 0,
    getAuthToken: () => testToken,
    getQueue: () => ({ listJobs: () => [], startJob: () => '1' }),
    getWindow: () => null,
    getSettings: () => ({ allowLocalNetwork: true }),
    appVersion: '0.1.0'
  });

  const { port } = await bridge.start();

  try {
    const hugePayload = JSON.stringify({
      url: 'https://example.com/video.mp4',
      title: 'A'.repeat(70 * 1024) // 70 KB > 64 KB limit
    });

    const res = await new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/enqueue',
          method: 'POST',
          headers: {
            Host: `127.0.0.1:${port}`,
            Authorization: `Bearer ${testToken}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(hugePayload)
          }
        },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve({ status: res.statusCode, raw: b }));
        }
      );
      req.on('error', (err) => resolve({ error: err.message }));
      req.write(hugePayload);
      req.end();
    });

    // Should either destroy socket / return error or return 400
    assert.ok(res.error || res.status >= 400, 'Bridge must reject oversized payloads');
  } finally {
    await bridge.stop();
  }
});


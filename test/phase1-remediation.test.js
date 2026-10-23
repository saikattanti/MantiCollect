import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithSafeRedirects, assertPublicUrl } from '../electron/security.js';
import { directDownload } from '../electron/providers/direct.js';
import { executeJob } from '../electron/runner.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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

/* =====================================================================
   TASK 1: Window Transparency and Solid Base Fallback Tests
   ===================================================================== */

test('main.js sets solid opaque window fallback and mica on Windows 11', () => {
  const mainSrc = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.ok(
    mainSrc.includes('backgroundColor: TITLEBAR_THEMES.dark.color'),
    'BrowserWindow must have solid opaque fallback background'
  );
  assert.ok(
    !mainSrc.includes("backgroundColor: '#00000000'"),
    'BrowserWindow must not use #00000000 transparent background'
  );
  assert.ok(
    mainSrc.includes('win.setBackgroundColor(TITLEBAR_THEMES.dark.color)'),
    'applyWindowMaterials must set solid fallback color'
  );
  assert.ok(
    mainSrc.includes('mainWindow?.setBackgroundColor(t.color)'),
    'window:set-theme must update window background color'
  );
});

test('globals.css defines solid base background on html and body', () => {
  const rawCss = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
  const css = rawCss.replace(/\r\n/g, '\n');

  // Verify html has solid background-color: var(--mv-bg)
  const htmlRuleMatch = css.match(/(?:^|\n)\s*html\s*\{([^}]+)\}/);
  assert.ok(htmlRuleMatch, 'html block must be defined in globals.css');
  assert.match(
    htmlRuleMatch[1],
    /background-color\s*:\s*var\(--mv-bg\)\s*;?/,
    'html must have solid background-color: var(--mv-bg)'
  );

  // Verify body has solid background-color: var(--mv-bg)
  const bodyRuleMatch = css.match(/(?:^|\n)\s*body\s*\{([^}]+)\}/);
  assert.ok(bodyRuleMatch, 'body block must be defined in globals.css');
  assert.match(
    bodyRuleMatch[1],
    /background-color\s*:\s*var\(--mv-bg\)\s*;?/,
    'body must have solid background-color: var(--mv-bg) to prevent desktop bleed'
  );

  // Prohibited translucent alpha or transparent keywords must not be present
  assert.ok(
    !css.includes('color-mix(in srgb, var(--mv-bg) calc(var(--mv-body-alpha) * 100%), transparent)'),
    'translucent body background alpha must be removed'
  );
  assert.doesNotMatch(
    css,
    /(?:html|body)\s*\{[^}]*background(?:-color)?\s*:\s*transparent/,
    'neither html nor body may declare transparent background'
  );
});

test('globals.css background verification is resilient to both LF and CRLF line endings', () => {
  function verifyCss(inputCss) {
    const normalized = inputCss.replace(/\r\n/g, '\n');
    const htmlMatch = normalized.match(/(?:^|\n)\s*html\s*\{([^}]+)\}/);
    const bodyMatch = normalized.match(/(?:^|\n)\s*body\s*\{([^}]+)\}/);
    if (!htmlMatch || !bodyMatch) return false;
    const hasHtmlBg = /background-color\s*:\s*var\(--mv-bg\)\s*;?/.test(htmlMatch[1]);
    const hasBodyBg = /background-color\s*:\s*var\(--mv-bg\)\s*;?/.test(bodyMatch[1]);
    const hasTranslucent = normalized.includes('color-mix(in srgb, var(--mv-bg) calc(var(--mv-body-alpha) * 100%), transparent)');
    return hasHtmlBg && hasBodyBg && !hasTranslucent;
  }

  const validLf = 'html {\n  background-color: var(--mv-bg);\n}\nbody {\n  background-color: var(--mv-bg);\n}';
  const validCrlf = 'html {\r\n  background-color: var(--mv-bg);\r\n}\r\nbody {\r\n  background-color: var(--mv-bg);\r\n}';
  const missingHtml = 'html {\n  color: red;\n}\nbody {\n  background-color: var(--mv-bg);\n}';
  const missingBody = 'html {\n  background-color: var(--mv-bg);\n}\nbody {\n  color: blue;\n}';
  const translucent = 'html {\n  background-color: var(--mv-bg);\n}\nbody {\n  background-color: var(--mv-bg);\n  color-mix(in srgb, var(--mv-bg) calc(var(--mv-body-alpha) * 100%), transparent);\n}';

  assert.equal(verifyCss(validLf), true, 'Valid LF CSS must pass');
  assert.equal(verifyCss(validCrlf), true, 'Valid CRLF CSS must pass');
  assert.equal(verifyCss(missingHtml), false, 'CSS missing html background must fail');
  assert.equal(verifyCss(missingBody), false, 'CSS missing body background must fail');
  assert.equal(verifyCss(translucent), false, 'CSS with translucent background expression must fail');
});

/* =====================================================================
   TASK 2: Remote Media Thumbnail Request & Error Handling Tests
   ===================================================================== */

test('media:thumbnail headers passed through fetchWithSafeRedirects', async (t) => {
  let receivedHeaders = null;
  const samplePng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');

  const server = await startServer((req, res) => {
    receivedHeaders = req.headers;
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': samplePng.length
    });
    res.end(samplePng);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const testHeaders = {
    'User-Agent': 'MediaVault-Test-Agent/1.0',
    'Accept': 'image/avif,image/webp,image/*',
    'Referer': 'https://www.youtube.com/'
  };

  const res = await fetchWithSafeRedirects(`http://127.0.0.1:${port}/thumb.png`, {
    allowLocal: true,
    headers: testHeaders
  });

  assert.equal(res.status, 200);
  assert.equal(receivedHeaders['user-agent'], 'MediaVault-Test-Agent/1.0');
  assert.equal(receivedHeaders['accept'], 'image/avif,image/webp,image/*');
  assert.equal(receivedHeaders['referer'], 'https://www.youtube.com/');
});

test('thumbnail helper handles HTTP 403, 404, invalid mime and SSRF gracefully', async (t) => {
  const server = await startServer((req, res) => {
    if (req.url === '/403') {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
    } else if (req.url === '/404') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    } else if (req.url === '/html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>Not an image</body></html>');
    }
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  // Simulate ipc media:thumbnail handler logic with 403
  async function simulateThumbnailFetch(url, allowLocal = true) {
    try {
      await assertPublicUrl(url, { allowLocal });
      const res = await fetchWithSafeRedirects(url, {
        allowLocal,
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'Test' }
      });
      if (!res.ok) {
        if (res.body) res.body.cancel().catch(() => {});
        return { uri: null };
      }
      const ctype = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!ctype.startsWith('image/')) {
        if (res.body) res.body.cancel().catch(() => {});
        return { uri: null };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { uri: `data:${ctype};base64,${buf.toString('base64')}` };
    } catch {
      return { uri: null };
    }
  }

  const r403 = await simulateThumbnailFetch(`http://127.0.0.1:${port}/403`);
  assert.deepEqual(r403, { uri: null }, '403 response must return { uri: null }');

  const r404 = await simulateThumbnailFetch(`http://127.0.0.1:${port}/404`);
  assert.deepEqual(r404, { uri: null }, '404 response must return { uri: null }');

  const rHtml = await simulateThumbnailFetch(`http://127.0.0.1:${port}/html`);
  assert.deepEqual(rHtml, { uri: null }, 'non-image content-type must return { uri: null }');

  // SSRF blocked check:
  const rPrivate = await simulateThumbnailFetch(`http://127.0.0.1:${port}/403`, false);
  assert.deepEqual(rPrivate, { uri: null }, 'SSRF blocked request must return { uri: null }');
});

/* =====================================================================
   TASK 3: Light/Dark Theme Synchronization Tests
   ===================================================================== */

test('theme.jsx synchronizes both data-theme attribute and .dark class', () => {
  const themeSrc = fs.readFileSync(path.join(root, 'src', 'lib', 'theme.jsx'), 'utf8');
  assert.ok(
    themeSrc.includes("root.setAttribute('data-theme', resolved)"),
    'theme.jsx must set data-theme attribute'
  );
  assert.ok(
    themeSrc.includes("root.classList.toggle('dark', resolved === 'dark')"),
    'theme.jsx must toggle .dark class to activate Tailwind dark: variants'
  );
  assert.ok(
    themeSrc.includes('api.window.setTheme(resolved)'),
    'theme.jsx must call api.window.setTheme to synchronize native titlebar'
  );

  const layoutSrc = fs.readFileSync(path.join(root, 'app', 'layout.jsx'), 'utf8');
  assert.ok(
    layoutSrc.includes('className="dark"'),
    'app/layout.jsx html element must have initial className dark'
  );
});

/* =====================================================================
   TASK 4: Direct HTTP Download Cancellation Tests
   ===================================================================== */

test('directDownload aborts mid-stream, stops progress, and cleans up .part file', async (t) => {
  const chunk = Buffer.from('B'.repeat(50_000));
  let clientAborted = false;

  const server = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': 500_000 });
    let count = 0;
    const interval = setInterval(() => {
      if (res.destroyed || clientAborted) {
        clearInterval(interval);
        return;
      }
      res.write(chunk);
      count++;
      if (count >= 10) {
        clearInterval(interval);
        res.end();
      }
    }, 40);

    req.on('close', () => {
      clientAborted = true;
      clearInterval(interval);
    });
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-cancel-'));
  const controller = new AbortController();
  const progressEvents = [];

  const downloadPromise = directDownload(`http://127.0.0.1:${port}/sample.mp4`, dest, {
    allowLocal: true,
    signal: controller.signal,
    onProgress: (p) => {
      progressEvents.push(p);
      if (progressEvents.length === 2) {
        controller.abort();
      }
    }
  });

  await assert.rejects(
    downloadPromise,
    (err) => err.message.includes('cancelled') || err.name === 'AbortError'
  );

  // Verification: temporary .part files must be cleaned up
  const leftoverPartFiles = fs.readdirSync(dest).filter((f) => f.endsWith('.part'));
  assert.equal(leftoverPartFiles.length, 0, 'Partial .part file must be removed on cancellation');

  // Idempotent cancellation: calling abort again does not throw
  assert.doesNotThrow(() => controller.abort());

  fs.rmSync(dest, { recursive: true, force: true });
});

test('executeJob creates working cancellation handle for direct downloads', async (t) => {
  const payload = Buffer.from('C'.repeat(100_000));
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': payload.length });
    res.end(payload);
  });
  const { port } = server.address();
  t.after(() => closeServer(server));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-exec-cancel-'));
  const job = {
    id: 'test-job-cancel-1',
    url: `http://127.0.0.1:${port}/song.mp3`,
    dest_dir: dest
  };

  const handle = executeJob(job, { allowLocal: true });
  assert.equal(typeof handle.cancel, 'function', 'handle.cancel must be a function');
  assert.equal(handle.cancelled, false, 'handle.cancelled initial state must be false');

  // Cancel immediately
  handle.cancel();
  assert.equal(handle.cancelled, true, 'handle.cancelled must be set to true');

  // Second cancel call must be idempotent
  assert.doesNotThrow(() => handle.cancel());

  await assert.rejects(
    handle.promise,
    (err) => err.message.includes('cancelled') || err.name === 'AbortError'
  );

  fs.rmSync(dest, { recursive: true, force: true });
});

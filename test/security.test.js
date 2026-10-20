import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeFilename,
  uniquePath,
  assertPathWithin,
  ipIsPrivate,
  normalizeUrlInput,
  extensionKind
} from '../electron/security.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('sanitizeFilename strips illegal characters', () => {
  assert.equal(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j.txt'), 'a b c d e f g h i j.txt');
  assert.equal(sanitizeFilename('  spaced   out  '), 'spaced out');
  assert.equal(sanitizeFilename('trailing..'), 'trailing');
});

test('sanitizeFilename blocks Windows reserved names', () => {
  assert.equal(sanitizeFilename('CON'), '_CON');
  assert.equal(sanitizeFilename('NUL.txt'), '_NUL.txt');
  assert.equal(sanitizeFilename('com1'), '_com1');
  assert.equal(sanitizeFilename('LPT9.pdf'), '_LPT9.pdf');
});

test('sanitizeFilename caps length and keeps extension', () => {
  const out = sanitizeFilename('x'.repeat(400) + '.mp4', { maxLength: 100 });
  assert.equal(Buffer.byteLength(out, 'utf8'), 100);
  assert.ok(out.endsWith('.mp4'));
});

test('sanitizeFilename falls back for empty input', () => {
  assert.equal(sanitizeFilename(''), 'untitled');
  assert.equal(sanitizeFilename('///'), 'untitled');
});

test('uniquePath avoids overwrites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-'));
  fs.writeFileSync(path.join(dir, 'a.mp4'), 'x');
  const p1 = uniquePath(dir, 'a.mp4');
  assert.match(p1, /a \(1\)\.mp4$/);
  fs.writeFileSync(p1, 'x');
  const p2 = uniquePath(dir, 'a.mp4');
  assert.match(p2, /a \(2\)\.mp4$/);
  assert.equal(uniquePath(dir, 'new.mp4'), path.join(dir, 'new.mp4'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('assertPathWithin blocks traversal', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mvpath-'));
  const sub = path.join(base, 'sub');
  assert.equal(assertPathWithin(base, path.join(sub, 'file.mp4')), path.join(sub, 'file.mp4'));
  assert.throws(() => assertPathWithin(base, path.join(os.tmpdir(), 'elsewhere.mp4')), /escapes/);
  assert.throws(() => assertPathWithin(base, path.join(base, '..', '..', 'win.ini')), /escapes/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('ipIsPrivate detects reserved ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.5.5', '169.254.1.1', '0.0.0.0', '100.64.0.1', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:10.0.0.1', '::']) {
    assert.ok(ipIsPrivate(ip), `expected private: ${ip}`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946', '2001:4860:4860::8888']) {
    assert.ok(!ipIsPrivate(ip), `expected public: ${ip}`);
  }
});

test('normalizeUrlInput adds https scheme', () => {
  assert.equal(normalizeUrlInput('example.com/video'), 'https://example.com/video');
  assert.equal(normalizeUrlInput('https://example.com/v'), 'https://example.com/v');
  assert.equal(normalizeUrlInput('  ftp://x.com  '), 'ftp://x.com');
  assert.equal(normalizeUrlInput('   '), '');
});

test('extensionKind classifies media URLs', () => {
  assert.deepEqual(extensionKind('https://x.com/a/b.PNG?w=1'), { kind: 'image', extension: 'png' });
  assert.deepEqual(extensionKind('https://x.com/v.mp4'), { kind: 'video', extension: 'mp4' });
  assert.equal(extensionKind('https://x.com/page?ext=mp4'), null);
  assert.equal(extensionKind('not a url'), null);
});

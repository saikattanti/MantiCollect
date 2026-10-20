import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const preloadSrc = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ipcSrc = fs.readFileSync(path.join(root, 'electron', 'ipc.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const queueSrc = fs.readFileSync(path.join(root, 'electron', 'queue.js'), 'utf8');

function extractSet(src, name) {
  const m = src.match(new RegExp(`${name} = new Set\\(\\[(.*?)\\]\\)`, 's'));
  assert.ok(m, `could not find ${name} in preload.cjs`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('every preload invoke channel has a registered main-process handler', () => {
  const invokeChannels = extractSet(preloadSrc, 'INVOKE_CHANNELS');
  const handlerChannels = [...`${ipcSrc}\n${mainSrc}`.matchAll(/handle\('([^']+)'/g)].map((x) => x[1]);
  assert.ok(invokeChannels.length >= 15, `expected >=15 invoke channels, got ${invokeChannels.length}`);
  assert.ok(handlerChannels.length >= 18, `expected >=18 handlers, got ${handlerChannels.length}`);
  for (const c of invokeChannels) {
    assert.ok(handlerChannels.includes(c), `preload exposes "${c}" but no main-process handler is registered for it`);
  }
});

test('every preload event channel is actually emitted by the main process', () => {
  const eventChannels = extractSet(preloadSrc, 'EVENT_CHANNELS');
  assert.ok(eventChannels.length >= 3);
  const mainSources = `${ipcSrc}\n${queueSrc}`;
  for (const e of eventChannels) {
    const emitted = new RegExp(`(?:send|sendToWindow)\\(\\s*'${e}'`).test(mainSources);
    assert.ok(emitted, `preload listens for "${e}" but no main-process code emits it`);
  }
});

test('preload rejects unknown channels (whitelist logic is present)', () => {
  assert.ok(preloadSrc.includes('Blocked IPC channel'), 'preload must reject non-whitelisted invoke channels');
  assert.ok(preloadSrc.includes("contextBridge.exposeInMainWorld"), 'preload must use contextBridge');
});

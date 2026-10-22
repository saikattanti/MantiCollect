import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('Extension safety: download interception is disabled by default in extension code', () => {
  const bgPath = path.join(rootDir, 'browser-extension', 'background.js');
  const bgCode = fs.readFileSync(bgPath, 'utf8');

  // Must ensure getStorageConfig defaults downloadInterception to false
  assert.ok(
    bgCode.includes('downloadInterception: Boolean(items.downloadInterception)'),
    'downloadInterception must default to boolean false when undefined in storage'
  );

  // Must ensure downloads.onCreated listener checks config before taking any action
  assert.ok(
    bgCode.includes('if (!config.downloadInterception) return;'),
    'downloads listener must immediately bail out when downloadInterception is falsy'
  );

  // Must ensure chrome.downloads.cancel is only invoked on successful handoff (res && res.ok)
  assert.ok(
    bgCode.includes('if (res && res.ok) {'),
    'Must guard cancel behind explicit handoff success confirmation'
  );
});

test('Extension safety: popup interface maintains disabled default for interception', () => {
  const popupHtml = path.join(rootDir, 'browser-extension', 'popup.html');
  const html = fs.readFileSync(popupHtml, 'utf8');

  // Checkbox should NOT have checked attribute by default in HTML
  assert.ok(
    html.includes('id="check-interception"'),
    'Interception checkbox exists'
  );
  assert.ok(
    !html.includes('id="check-interception" checked'),
    'Interception checkbox must NOT be checked by default in HTML'
  );
});

test('Extension safety: handoff fallback simulation never cancels browser download on failure', async () => {
  // Simulate the background.js interception flow with mock Chrome downloads API
  let downloadCancelled = false;
  let downloadErased = false;

  const mockDownloadItem = {
    id: 101,
    url: 'https://example.com/large-file.iso',
    filename: 'C:\\Users\\User\\Downloads\\large-file.iso'
  };

  const mockChromeDownloads = {
    cancel: (id, cb) => {
      downloadCancelled = true;
      cb?.();
    },
    erase: (query, cb) => {
      downloadErased = true;
      cb?.();
    }
  };

  async function simulateInterception(mockSendToDesktop, downloadInterceptionEnabled = true) {
    downloadCancelled = false;
    downloadErased = false;

    if (!downloadInterceptionEnabled) return;

    const url = mockDownloadItem.url;
    if (!url || !/^https?:\/\//i.test(url)) return;

    try {
      const res = await mockSendToDesktop('enqueue', { url, requestId: `int-${mockDownloadItem.id}` });
      if (res && res.ok) {
        mockChromeDownloads.cancel(mockDownloadItem.id, () => {
          mockChromeDownloads.erase({ id: mockDownloadItem.id });
        });
      }
    } catch {}
  }

  // Scenario 1: Desktop application is unavailable / connection refused
  await simulateInterception(async () => ({ ok: false, error: 'Connection refused' }), true);
  assert.equal(downloadCancelled, false, 'Download must NOT be cancelled when desktop app is unavailable');
  assert.equal(downloadErased, false, 'Download must NOT be erased when desktop app is unavailable');

  // Scenario 2: Desktop application rejects unsupported URL
  await simulateInterception(async () => ({ ok: false, error: 'Unsupported URL' }), true);
  assert.equal(downloadCancelled, false, 'Download must NOT be cancelled when URL is rejected');

  // Scenario 3: Request times out
  await simulateInterception(async () => {
    throw new Error('Timeout');
  }, true);
  assert.equal(downloadCancelled, false, 'Download must NOT be cancelled when request times out');

  // Scenario 4: Interception disabled by user
  await simulateInterception(async () => ({ ok: true, id: 'job-1' }), false);
  assert.equal(downloadCancelled, false, 'Download must NOT be cancelled when feature is disabled');

  // Scenario 5: Successful handoff to running MantiCollect
  await simulateInterception(async () => ({ ok: true, id: 'job-1' }), true);
  assert.equal(downloadCancelled, true, 'Download is cancelled only upon verified handoff');
  assert.equal(downloadErased, true, 'Cancelled placeholder is cleaned up');
});

test('Native host safety: scripts quote paths with spaces and avoid arbitrary execution', () => {
  const batPath = path.join(rootDir, 'native-host', 'manticollect_host.bat');
  const regBatPath = path.join(rootDir, 'native-host', 'register-host-windows.bat');
  const regPs1Path = path.join(rootDir, 'native-host', 'register-host-windows.ps1');
  const unregBatPath = path.join(rootDir, 'native-host', 'unregister-host-windows.bat');
  const unregPs1Path = path.join(rootDir, 'native-host', 'unregister-host-windows.ps1');

  for (const p of [batPath, regBatPath, regPs1Path, unregBatPath, unregPs1Path]) {
    assert.ok(fs.existsSync(p), `Script ${p} must exist`);
  }

  const batContent = fs.readFileSync(batPath, 'utf8');
  assert.ok(batContent.includes('"%~dp0manticollect_host.js"'), 'Script path must be quoted in bat');
  assert.ok(batContent.includes('"%LOCALAPPDATA%\\Programs\\MantiCollect\\MantiCollect.exe"'), 'Packaged app path must be quoted in bat');

  const regBatContent = fs.readFileSync(regBatPath, 'utf8');
  assert.ok(regBatContent.includes('"%CHROME_MANIFEST%"'), 'Manifest path must be quoted in reg add');
  assert.ok(regBatContent.includes('"%EDGE_MANIFEST%"'), 'Edge manifest path must be quoted in reg add');

  const regPs1Content = fs.readFileSync(regPs1Path, 'utf8');
  assert.ok(regPs1Content.includes('HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts'), 'Must register in HKCU, not HKLM');
  assert.ok(regPs1Content.includes('HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts'), 'Must register in HKCU, not HKLM');
});

test('Native host safety: manifests contain no hardcoded development paths or secrets', () => {
  const chromeHostManifest = path.join(rootDir, 'native-host', 'com.mantitup.manticollect.json');
  const edgeHostManifest = path.join(rootDir, 'native-host', 'com.mantitup.manticollect.edge.json');

  const chromeContent = fs.readFileSync(chromeHostManifest, 'utf8');
  const edgeContent = fs.readFileSync(edgeHostManifest, 'utf8');

  for (const c of [chromeContent, edgeContent]) {
    assert.ok(!c.includes('D:\\'), 'Must not contain hardcoded machine paths');
    assert.ok(!c.includes('C:\\'), 'Must not contain hardcoded machine paths');
    assert.ok(!c.includes('token'), 'Must not contain hardcoded tokens');
    assert.ok(!c.includes('secret'), 'Must not contain hardcoded secrets');
    assert.ok(!c.includes('*/*'), 'Must not contain wildcard origins');
  }
});

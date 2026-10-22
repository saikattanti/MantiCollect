import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import electron from 'electron';

const { app } = typeof electron === 'object' && electron ? electron : { app: null };

export const DEFAULTS = {
  downloadDir: path.join(os.homedir(), 'Downloads', 'MediaVault'),
  concurrency: 2,
  maxFileSizeMB: 0, // 0 = unlimited
  overwrite: 'avoid', // avoid | overwrite
  cookiesFile: '',
  ytdlpPath: '',
  ffmpegPath: '',
  allowLocalNetwork: false,
  probeTimeoutMs: 30000,
  maxConnectionsPerDownload: 4,
  segmentedDownloads: true,
  browserIntegrationEnabled: true,
  browserBridgePort: 52443,
  browserAuthToken: '',
  clipboardDetection: false,
  downloadInterception: false,
  globalUploadLimitKBps: 0,
  perTaskUploadLimitKBps: 0,
  minimizeToTray: false,
  closeToTray: false,
  startMinimized: false,
  notifyOnCloseToTray: true,
  notificationsEnabled: true,
  notifyDownloadComplete: true,
  notifyDownloadFailed: true,
  notifyBackupComplete: true,
  notifyBackupFailed: true,
  notifyBackupStarted: false,
  notifyUpdates: true,
  autoCheckUpdates: true
};

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings() {
  if (cache) return { ...cache };
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = { ...DEFAULTS, ...raw };
  } catch {
    cache = { ...DEFAULTS };
  }
  if (!cache.browserAuthToken) {
    cache.browserAuthToken = randomBytes(32).toString('hex');
  }
  return { ...cache };
}

export function regenerateBrowserAuthToken() {
  const token = randomBytes(32).toString('hex');
  return saveSettings({ browserAuthToken: token });
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  cache = next;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file());
  return { ...next };
}

export function ensureDirs() {
  const s = loadSettings();
  fs.mkdirSync(s.downloadDir, { recursive: true });
}

export function userDataPath() {
  return app.getPath('userData');
}

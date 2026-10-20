import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
  probeTimeoutMs: 30000
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
  return { ...cache };
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

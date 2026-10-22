import { spawn, execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { logger } from './logger.js';

const { app } = typeof electron === 'object' && electron ? electron : { app: null };

function isUsable(p) {
  return typeof p === 'string' && p.length > 0 && (app === null || fs.existsSync(p));
}

export function ffmpegBinaryPath(settings = {}) {
  if (settings.ffmpegPath && fs.existsSync(settings.ffmpegPath)) return settings.ffmpegPath;
  let p = ffmpegStatic;
  if (p && typeof p === 'string' && app && app.isPackaged) {
    const unpacked = p.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) return unpacked;
  }
  if (isUsable(p)) return p;
  return null;
}

export function ffprobeBinaryPath(settings = {}) {
  if (settings.ffmpegPath && fs.existsSync(settings.ffmpegPath)) {
    // ffprobe lives next to ffmpeg in most bundles
    const candidate = path.join(path.dirname(settings.ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fs.existsSync(candidate)) return candidate;
  }
  let p = ffprobeStatic && (ffprobeStatic.path || ffprobeStatic);
  if (p && typeof p === 'string' && app && app.isPackaged) {
    const unpacked = p.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) return unpacked;
  }
  if (isUsable(p)) return p;
  return null;
}

export function ffmpegDirectory(settings = {}) {
  const p = ffmpegBinaryPath(settings);
  return p ? path.dirname(p) : null;
}

export function ytDlpCandidates(settings = {}) {
  const cands = [];
  if (settings.ytdlpPath) cands.push(settings.ytdlpPath);
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const devVendor = path.join(app ? app.getAppPath() : process.cwd(), 'vendor', 'yt-dlp', name);
  const resVendor =
    app && app.isPackaged ? path.join(process.resourcesPath, 'vendor', 'yt-dlp', name) : devVendor;
  const userVendor = app?.getPath ? path.join(app.getPath('userData'), 'vendor', 'yt-dlp', name) : null;
  for (const c of [devVendor, resVendor, userVendor]) if (c && !cands.includes(c)) cands.push(c);
  return cands;
}

function which(cmd) {
  return new Promise((resolve) => {
    const tool = process.platform === 'win32' ? 'where' : 'which';
    execFile(tool, [cmd], (err, out) => {
      if (err) return resolve(null);
      const first = String(out).split(/\r?\n/)[0].trim();
      resolve(first || null);
    });
  });
}

export async function resolveYtDlp(settings = {}) {
  for (const c of ytDlpCandidates(settings)) {
    if (fs.existsSync(c)) return c;
  }
  const onPath = await which(process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  return onPath || null;
}

/**
 * Spawn a child process, stream stdout line-by-line, and expose a cancel()
 * that kills the whole process tree (taskkill /T on Windows).
 * No shell is ever used; args are passed as an array.
 */
export function runYtDlp(bin, args, { onLine, timeoutMs, cwd } = {}) {
  const child = spawn(bin, args, { windowsHide: true, cwd, env: { ...process.env } });
  let stdout = '';
  let stderr = '';
  let settled = false;
  let timeout = null;

  const done = (code, error) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    resolve({ code, stdout, stderr, error: error || null, killed });
  };

  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });

  const killed = { value: false };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    stdout += d;
    if (onLine) for (const line of d.toString().split(/\r?\n/)) if (line) onLine(line, 'out');
  });
  child.stderr.on('data', (d) => {
    stderr += d;
    if (onLine) for (const line of d.toString().split(/\r?\n/)) if (line) onLine(line, 'err');
  });
  child.on('error', (err) => done(-1, err.message));
  child.on('close', (code) => done(code ?? -1));
  if (timeoutMs) {
    timeout = setTimeout(() => {
      killed.value = true;
      killTree(child.pid);
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, timeoutMs);
  }

  return {
    promise,
    pid: child.pid,
    cancel() {
      killed.value = true;
      killTree(child.pid);
    }
  };
}

export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

async function runVersion(bin, arg = '--version', timeoutMs = 8000) {
  try {
    const r = await new Promise((resolve) => {
      const c = spawn(bin, [arg], { windowsHide: true });
      let out = '';
      const t = setTimeout(() => {
        try {
          c.kill();
        } catch {}
      }, timeoutMs);
      c.stdout.on('data', (d) => (out += d));
      c.on('close', () => {
        clearTimeout(t);
        resolve(out.trim());
      });
      c.on('error', () => {
        clearTimeout(t);
        resolve('');
      });
    });
    return r.split(/\r?\n/)[0].slice(0, 200) || null;
  } catch {
    return null;
  }
}

export async function getBinaryStatus(settings = {}) {
  const ffmpeg = ffmpegBinaryPath(settings);
  const ffprobe = ffprobeBinaryPath(settings);
  const ytdlp = await resolveYtDlp(settings);
  const [ffmpegVersion, ffprobeVersion, ytdlpVersion] = await Promise.all([
    runVersion(ffmpeg),
    runVersion(ffprobe),
    runVersion(ytdlp)
  ]);
  return {
    ffmpeg: { available: !!ffmpeg, path: ffmpeg, version: ffmpegVersion },
    ffprobe: { available: !!ffprobe, path: ffprobe, version: ffprobeVersion },
    ytdlp: { available: !!ytdlp, path: ytdlp, version: ytdlpVersion }
  };
}

/**
 * Download the official standalone yt-dlp executable into the vendor
 * directory (dev: <project>/vendor/yt-dlp, packaged: userData/vendor/yt-dlp).
 * Uses the GitHub releases API; the binary is verified by running --version.
 */
export async function installYtDlp({ onProgress } = {}) {
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const asset = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const targetDir =
    app && app.isPackaged
      ? path.join(app.getPath('userData'), 'vendor', 'yt-dlp')
      : path.join(app ? app.getAppPath() : process.cwd(), 'vendor', 'yt-dlp');
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, name);

  onProgress?.({ phase: 'discovering', message: 'Querying GitHub for the latest yt-dlp release' });
  const rel = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
    headers: { 'user-agent': 'manticollect' }
  });
  if (!rel.ok) throw new Error(`GitHub API returned HTTP ${rel.status}`);
  const data = await rel.json();
  const entry = (data.assets || []).find((a) => a.name === asset);
  if (!entry) throw new Error('yt-dlp executable not found in the release assets');

  onProgress?.({ phase: 'downloading', message: `Downloading ${entry.name}` });
  const dl = await fetch(entry.browser_download_url, { headers: { 'user-agent': 'manticollect' } });
  if (!dl.ok || !dl.body) throw new Error(`Download failed (HTTP ${dl.status})`);

  const tmp = `${target}.download`;
  const total = Number(dl.headers.get('content-length')) || 0;
  let received = 0;
  const out = fs.createWriteStream(tmp);
  const reader = dl.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out.write(Buffer.from(value));
    if (onProgress && total) onProgress({ phase: 'downloading', received, total });
  }
  await new Promise((r, j) => out.end(() => r(), j));
  fs.renameSync(tmp, target);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);

  const version = await runVersion(target);
  onProgress?.({ phase: 'verified', message: version || 'installed' });
  logger.info('bins', `yt-dlp installed at ${target} (${version})`);
  return { path: target, version };
}

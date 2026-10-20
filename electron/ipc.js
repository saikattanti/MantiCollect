import path from 'node:path';
import fs from 'node:fs';
import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron';
import { loadSettings, saveSettings, ensureDirs } from './settings.js';
import { assertPublicUrl, normalizeUrlInput, fetchWithSafeRedirects } from './security.js';
import { resolveProvider, capabilityMatrix } from './providers/registry.js';
import { getBinaryStatus, installYtDlp, ffmpegBinaryPath } from './bins.js';
import { scanLibrary, readThumbnail, zipFiles, deleteFiles } from './library.js';
import { logger } from './logger.js';

/**
 * Restricted IPC surface. Every channel is whitelisted and every payload
 * is validated before use. The renderer never gets Node access.
 */
export function registerIpc({ getQueue, getWindow }) {
  const settings = () => loadSettings();

  function handle(channel, fn) {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        const result = await fn(payload ?? {});
        return { ok: true, result };
      } catch (err) {
        logger.warn('ipc', `${channel}: ${err?.message || err}`);
        return { ok: false, error: String(err?.message || err) };
      }
    });
  }

  function requireString(v, name, max = 4000) {
    if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Invalid ${name}`);
    return v.trim();
  }

  function requireArray(v, name, max = 1000) {
    if (!Array.isArray(v) || v.length > max) throw new Error(`Invalid ${name}`);
    return v;
  }

  function sendToWindow(channel, data) {
    const win = getWindow?.();
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  }

  /* ---------------- app ---------------- */

  handle('app:info', async () => {
    const s = settings();
    return {
      version: process.env.npm_package_version || '0.1.0',
      downloadDir: s.downloadDir,
      userData: app.getPath('userData'),
      platform: process.platform
    };
  });

  /* ---------------- probe ---------------- */

  handle('probe', async (p) => {
    const raw = requireString(p.url, 'url');
    const s = settings();
    const url = normalizeUrlInput(raw);
    await assertPublicUrl(url, { allowLocal: s.allowLocalNetwork });
    const provider = resolveProvider(url);
    if (!provider) throw new Error('No provider can handle this URL');

    if (provider.isDirect) {
      return provider.getMetadata(url, { allowLocal: s.allowLocalNetwork });
    }

    const bins = await import('./bins.js');
    const bin = await bins.resolveYtDlp(s);
    if (!bin) {
      throw new Error('yt-dlp is not installed. Use Settings → Binaries → Install yt-dlp, or run: npm run setup-bins');
    }
    const result = await provider.getMetadata(url, {
      ytdlpBin: bin,
      cookiesFile: s.cookiesFile || null,
      probeTimeoutMs: s.probeTimeoutMs
    });
    return result;
  });

  /* ---------------- jobs ---------------- */

  handle('jobs:list', async () => getQueue().listJobs());

  handle('jobs:start', async (p) => {
    const url = requireString(p.url, 'url');
    const s = settings();
    await assertPublicUrl(normalizeUrlInput(url), { allowLocal: s.allowLocalNetwork });
    const extra =
      p.extra && typeof p.extra === 'object'
        ? {
            formatOption: p.extra.formatOption || null,
            playlistItems: Array.isArray(p.extra.playlistItems) ? p.extra.playlistItems.slice(0, 5000) : null,
            expectedId: typeof p.extra.expectedId === 'string' ? p.extra.expectedId.slice(0, 120) : null,
            filename: typeof p.extra.filename === 'string' ? p.extra.filename.slice(0, 200) : null,
            thumbnail: typeof p.extra.thumbnail === 'string' ? p.extra.thumbnail.slice(0, 2000) : null
          }
        : null;
    const id = getQueue().startJob({
      url: normalizeUrlInput(url),
      provider: typeof p.provider === 'string' ? p.provider.slice(0, 40) : null,
      kind: typeof p.kind === 'string' ? p.kind.slice(0, 20) : null,
      title: typeof p.title === 'string' ? p.title.slice(0, 300) : null,
      format: typeof p.format === 'string' ? p.format.slice(0, 200) : null,
      destDir: typeof p.destDir === 'string' ? path.resolve(p.destDir) : null,
      collectionId: typeof p.collectionId === 'string' ? p.collectionId.slice(0, 60) : null,
      extra
    });
    return { id };
  });

  handle('jobs:pause', async (p) => getQueue().pauseJob(requireString(p.id, 'id', 64)));
  handle('jobs:resume', async (p) => getQueue().resumeJob(requireString(p.id, 'id', 64)));
  handle('jobs:cancel', async (p) => getQueue().cancelJob(requireString(p.id, 'id', 64)));
  handle('jobs:retry', async (p) => getQueue().retryJob(requireString(p.id, 'id', 64)));
  handle('jobs:remove', async (p) => getQueue().removeJob(requireString(p.id, 'id', 64)));
  handle('jobs:clear-completed', async () => getQueue().clearCompleted());

  /* ---------------- batch validation ---------------- */

  handle('batch:validate', async (p) => {
    const urls = requireArray(p.urls, 'urls', 500).map((u) => String(u).trim()).filter(Boolean);
    const s = settings();
    const seen = new Set();
    const results = [];
    for (const raw of urls) {
      if (seen.has(raw)) {
        results.push({ url: raw, ok: false, duplicate: true, error: 'Duplicate URL' });
        continue;
      }
      seen.add(raw);
      try {
        const url = normalizeUrlInput(raw);
        await assertPublicUrl(url, { allowLocal: s.allowLocalNetwork });
        const provider = resolveProvider(url);
        results.push({
          url,
          ok: !!provider,
          duplicate: false,
          provider: provider ? provider.id : null,
          providerName: provider ? provider.name : null,
          direct: !!provider?.isDirect
        });
      } catch (err) {
        results.push({ url: raw, ok: false, duplicate: false, error: err.message });
      }
    }
    return { results, total: urls.length };
  });

  /* ---------------- library ---------------- */

  handle('library:scan', async () => {
    ensureDirs();
    return { baseDir: settings().downloadDir, files: scanLibrary(settings().downloadDir) };
  });

  handle('library:thumbnail', async (p) => {
    const fp = requireString(p.path, 'path', 500);
    return readThumbnail(fp, settings().downloadDir);
  });

  handle('library:delete', async (p) => {
    const paths = requireArray(p.paths, 'paths', 500).map((x) => requireString(x, 'path', 500));
    ensureDirs();
    return { removed: deleteFiles(paths, settings().downloadDir) };
  });

  handle('library:zip', async (p) => {
    const paths = requireArray(p.paths, 'paths', 500).map((x) => requireString(x, 'path', 500));
    if (!paths.length) throw new Error('No files selected');
    ensureDirs();
    const baseDir = settings().downloadDir;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const destPath = path.join(baseDir, `mediavault-export-${stamp}.zip`);
    if (fs.existsSync(destPath)) throw new Error('An export file already exists with that name');
    zipFiles({
      files: paths,
      destPath,
      baseDir,
      onProgress: (prog) => sendToWindow('zip:progress', prog)
    })
      .then((r) => sendToWindow('zip:progress', { phase: 'complete', ...r }))
      .catch((err) => {
        logger.error('library', `zip failed: ${err.message}`);
        sendToWindow('zip:progress', { phase: 'error', error: err.message });
      });
    return { started: true, destPath };
  });

  /* ---------------- library ↔ jobs join ---------------- */

  handle('library:missing', async (p) => {
    const jobs = getQueue().listJobs();
    const missing = [];
    for (const j of jobs) {
      if (j.resultPath) {
        try {
          if (!fs.existsSync(j.resultPath)) missing.push({ id: j.id, title: j.title, resultPath: j.resultPath, finishedAt: j.finishedAt });
        } catch {}
      }
    }
    return { missing };
  });

  /* ---------------- remote thumbnails (secure proxy) ---------------- */

  // The renderer CSP allows only same-origin/data/blob images, so remote
  // thumbnail hosts (i.ytimg.com, cdn.sndcdn.io, …) are fetched here with
  // the same URL validation as downloads and returned as data: URIs.
  handle('media:thumbnail', async (p) => {
    try {
      const raw = requireString(p.url, 'url', 2000);
      const s = settings();
      const url = normalizeUrlInput(raw);
      await assertPublicUrl(url, { allowLocal: s.allowLocalNetwork });

      let referer = 'https://www.google.com/';
      try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        if (host.includes('ytimg.com') || host.includes('youtube.com') || host.includes('googlevideo.com') || host.includes('googleusercontent.com')) {
          referer = 'https://www.youtube.com/';
        } else if (host.includes('instagram.com') || host.includes('cdninstagram.com')) {
          referer = 'https://www.instagram.com/';
        } else if (host.includes('twimg.com') || host.includes('twitter.com') || host.includes('x.com')) {
          referer = 'https://x.com/';
        } else if (host.includes('tiktok.com') || host.includes('tiktokcdn.com')) {
          referer = 'https://www.tiktok.com/';
        } else if (host.includes('sndcdn.com') || host.includes('soundcloud.com')) {
          referer = 'https://soundcloud.com/';
        } else if (host.includes('redd.it') || host.includes('reddit.com')) {
          referer = 'https://www.reddit.com/';
        } else {
          referer = `${u.protocol}//${u.host}/`;
        }
      } catch {}

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': referer,
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site'
      };

      const res = await fetchWithSafeRedirects(url, {
        allowLocal: s.allowLocalNetwork,
        signal: AbortSignal.timeout(10000),
        headers
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
      if (buf.byteLength > 2 * 1024 * 1024) return { uri: null };
      return { uri: `data:${ctype};base64,${buf.toString('base64')}` };
    } catch {
      return { uri: null };
    }
  });

  /* ---------------- settings ---------------- */

  handle('settings:get', async () => settings());

  handle('settings:set', async (p) => {
    const patch = p.patch && typeof p.patch === 'object' ? p.patch : null;
    if (!patch) throw new Error('Invalid patch');
    const s = settings();
    const next = { ...s };
    if (patch.downloadDir !== undefined) {
      next.downloadDir = path.resolve(requireString(patch.downloadDir, 'downloadDir', 500));
      fs.mkdirSync(next.downloadDir, { recursive: true });
    }
    if (patch.concurrency !== undefined) {
      const n = Number(patch.concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 8) throw new Error('Concurrency must be 1-8');
      next.concurrency = n;
    }
    if (patch.maxFileSizeMB !== undefined) {
      const n = Number(patch.maxFileSizeMB);
      if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error('Invalid max file size');
      next.maxFileSizeMB = n;
    }
    if (patch.overwrite !== undefined && !['avoid', 'overwrite'].includes(patch.overwrite)) throw new Error('Invalid overwrite mode');
    if (patch.allowLocalNetwork !== undefined) next.allowLocalNetwork = !!patch.allowLocalNetwork;
    if (patch.cookiesFile !== undefined) next.cookiesFile = requireString(patch.cookiesFile, 'cookiesFile', 500);
    if (patch.ytdlpPath !== undefined) next.ytdlpPath = requireString(patch.ytdlpPath, 'ytdlpPath', 500);
    if (patch.ffmpegPath !== undefined) next.ffmpegPath = requireString(patch.ffmpegPath, 'ffmpegPath', 500);
    if (patch.probeTimeoutMs !== undefined) {
      const n = Number(patch.probeTimeoutMs);
      if (!Number.isFinite(n) || n < 5000 || n > 120000) throw new Error('Probe timeout must be 5000-120000 ms');
      next.probeTimeoutMs = n;
    }
    return saveSettings(next);
  });

  /* ---------------- platforms ---------------- */

  handle('platforms:list', async () => capabilityMatrix());

  /* ---------------- dialogs & shell ---------------- */

  handle('dialog:select-directory', async () => {
    const win = getWindow?.();
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths.length) return { path: null };
    return { path: r.filePaths[0] };
  });

  handle('path:reveal', async (p) => {
    const fp = requireString(p.path, 'path', 500);
    const base = settings().downloadDir;
    if (!fs.existsSync(fp)) throw new Error('File does not exist');
    if (!fp.startsWith(path.resolve(base))) throw new Error('Path outside the download directory');
    shell.showItemInFolder(fp);
    return { revealed: true };
  });

  /* ---------------- binaries ---------------- */

  handle('bins:status', async () => getBinaryStatus(settings()));

  handle('bins:install-ytdlp', async () => {
    const result = await installYtDlp({
      onProgress: (prog) => sendToWindow('ytdlp:install', prog)
    });
    return result;
  });

  /* ---------------- queue recovery on startup ---------------- */
  getQueue().recover();
}

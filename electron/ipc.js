import path from 'node:path';
import fs from 'node:fs';
import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron';
import { loadSettings, saveSettings, ensureDirs, regenerateBrowserAuthToken } from './settings.js';
import { assertPublicUrl, normalizeUrlInput, fetchWithSafeRedirects } from './security.js';
import { resolveProvider, capabilityMatrix } from './providers/registry.js';
import { getBinaryStatus, installYtDlp, ffmpegBinaryPath } from './bins.js';
import { scanLibrary, readThumbnail, zipFiles, deleteFiles } from './library.js';
import { queryLibrary } from './libraryQuery.js';
import { createMetadataService } from './metadata.js';
import {
  listCollections,
  getCollection,
  createCollection,
  renameCollection,
  deleteCollection,
  addItemsToCollection,
  removeItemsFromCollection
} from './collections.js';
import { exportFilesToDirectory, formatMetadataAsJson, formatMetadataAsCsv } from './export.js';
import { createConversionService, CONVERSION_PRESETS } from './converter.js';
import { LocalNasStorageProvider, WebDavStorageProvider, SftpStorageProvider, S3StorageProvider } from './remoteStorage.js';
import { isEncryptionAvailable } from './credentials.js';
import { getStorageConnectionManager as defaultGetStorageConnMgr } from './storageConnections.js';
import { createUploadQueue } from './uploadQueue.js';
import { getBackupScheduler as defaultGetBackupScheduler } from './backupScheduler.js';
import { getDb } from './db.js';
import { logger } from './logger.js';

/**
 * Restricted IPC surface. Every channel is whitelisted and every payload
 * is validated before use. The renderer never gets Node access.
 */
export function registerIpc({
  getQueue,
  getWindow,
  getClipboardDetector,
  getMetadataService,
  getConversionService,
  getStorageConnectionManager,
  getUploadQueue,
  getBackupScheduler
}) {
  const settings = () => loadSettings();
  const metadataService = getMetadataService ? getMetadataService() : createMetadataService({ getDbInstance: getDb, getSettings: loadSettings });
  const conversionService = getConversionService ? getConversionService() : createConversionService({ getDbInstance: getDb, getSettings: loadSettings, getWindow });
  const storageConnMgr = getStorageConnectionManager ? getStorageConnectionManager() : defaultGetStorageConnMgr();
  const uploadQueue = getUploadQueue ? getUploadQueue() : createUploadQueue({ getDbInstance: getDb, getSettings: loadSettings, getWindow, getConnectionManager: () => storageConnMgr });
  const backupScheduler = getBackupScheduler ? getBackupScheduler() : defaultGetBackupScheduler({ getDbInstance: getDb, getWindow, getConnectionManager: () => storageConnMgr, getUploadQueueInstance: () => uploadQueue });

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
    if (patch.browserIntegrationEnabled !== undefined) next.browserIntegrationEnabled = !!patch.browserIntegrationEnabled;
    if (patch.browserBridgePort !== undefined) {
      const port = Number(patch.browserBridgePort);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535');
      next.browserBridgePort = port;
    }
    if (patch.clipboardDetection !== undefined) next.clipboardDetection = !!patch.clipboardDetection;
    if (patch.downloadInterception !== undefined) next.downloadInterception = !!patch.downloadInterception;
    if (patch.globalUploadLimitKBps !== undefined) {
      const n = Number(patch.globalUploadLimitKBps);
      if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new Error('Invalid global upload limit');
      next.globalUploadLimitKBps = Math.floor(n);
    }
    if (patch.perTaskUploadLimitKBps !== undefined) {
      const n = Number(patch.perTaskUploadLimitKBps);
      if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new Error('Invalid per-task upload limit');
      next.perTaskUploadLimitKBps = Math.floor(n);
    }
    return saveSettings(next);
  });

  /* ---------------- browser integration & clipboard ---------------- */

  handle('browser:status', async () => {
    const s = settings();
    const appRoot = app?.getAppPath ? app.getAppPath() : process.cwd();
    const extDir = path.resolve(appRoot, 'browser-extension');
    const nativeHostDir = path.resolve(appRoot, 'native-host');
    return {
      enabled: Boolean(s.browserIntegrationEnabled),
      port: s.browserBridgePort || 52443,
      token: s.browserAuthToken || '',
      extensionDir: extDir,
      nativeHostDir: nativeHostDir,
      clipboardDetection: Boolean(s.clipboardDetection),
      downloadInterception: Boolean(s.downloadInterception)
    };
  });

  handle('browser:regenerate-token', async () => {
    const next = regenerateBrowserAuthToken();
    return { token: next.browserAuthToken };
  });

  handle('browser:open-extension-dir', async () => {
    const appRoot = app?.getAppPath ? app.getAppPath() : process.cwd();
    const extDir = path.resolve(appRoot, 'browser-extension');
    if (fs.existsSync(extDir)) {
      shell.openPath(extDir);
      return { opened: true, path: extDir };
    }
    return { opened: false, error: 'Directory not found' };
  });

  handle('browser:open-host-dir', async () => {
    const appRoot = app?.getAppPath ? app.getAppPath() : process.cwd();
    const hostDir = path.resolve(appRoot, 'native-host');
    if (fs.existsSync(hostDir)) {
      shell.openPath(hostDir);
      return { opened: true, path: hostDir };
    }
    return { opened: false, error: 'Directory not found' };
  });

  handle('clipboard:get-detected', async () => {
    return { url: getClipboardDetector?.()?.getLastDetectedUrl() || null };
  });

  handle('clipboard:clear', async () => {
    getClipboardDetector?.()?.clearLastDetectedUrl();
    return { cleared: true };
  });

  // Emitted events references for telemetry and bridge updates
  function emitBridgeEvents(data) {
    sendToWindow('clipboard:detected', data);
    sendToWindow('browser:download-queued', data);
  }

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

  /* ---------------- Phase 7: Media Library Organization & Query ---------------- */

  handle('library:query', async (p) => {
    return queryLibrary({
      search: typeof p.search === 'string' ? p.search : '',
      category: typeof p.category === 'string' ? p.category : 'all',
      collectionId: p.collectionId ? String(p.collectionId) : null,
      platform: typeof p.platform === 'string' ? p.platform : 'all',
      sort: typeof p.sort === 'string' ? p.sort : 'date',
      order: p.order === 'asc' ? 'asc' : 'desc',
      limit: Number.isInteger(p.limit) && p.limit > 0 ? Math.min(p.limit, 200) : 50,
      offset: Number.isInteger(p.offset) && p.offset >= 0 ? p.offset : 0
    });
  });

  handle('library:probe-file', async (p) => {
    const filePath = requireString(p.filePath, 'filePath', 1000);
    return metadataService.probeFile(filePath);
  });

  handle('library:probe-batch', async (p) => {
    const filePaths = requireArray(p.filePaths, 'filePaths', 500).map((x) => requireString(x, 'filePath', 1000));
    return metadataService.probeBatch(filePaths);
  });

  /* ---------------- Phase 7: Collections Management ---------------- */

  handle('collections:list', async () => {
    return listCollections();
  });

  handle('collections:get', async (p) => {
    const id = requireString(p.id, 'id', 100);
    return getCollection(id);
  });

  handle('collections:create', async (p) => {
    const name = requireString(p.name, 'name', 200);
    const description = typeof p.description === 'string' ? p.description : '';
    const color = typeof p.color === 'string' ? p.color : '#00e5ff';
    return createCollection(name, description, color);
  });

  handle('collections:rename', async (p) => {
    const id = requireString(p.id, 'id', 100);
    const name = requireString(p.name, 'name', 200);
    return renameCollection(id, name);
  });

  handle('collections:delete', async (p) => {
    const id = requireString(p.id, 'id', 100);
    return deleteCollection(id);
  });

  handle('collections:add-items', async (p) => {
    const id = requireString(p.collectionId, 'collectionId', 100);
    const itemPaths = requireArray(p.itemPaths, 'itemPaths', 500).map((x) => requireString(x, 'itemPath', 1000));
    return addItemsToCollection(id, itemPaths);
  });

  handle('collections:remove-items', async (p) => {
    const id = requireString(p.collectionId, 'collectionId', 100);
    const itemPaths = requireArray(p.itemPaths, 'itemPaths', 500).map((x) => requireString(x, 'itemPath', 1000));
    return removeItemsFromCollection(id, itemPaths);
  });

  /* ---------------- Phase 7: Batch Selection and Export ---------------- */

  handle('export:select-dir', async () => {
    const win = getWindow?.();
    const r = await dialog.showOpenDialog(win, {
      title: 'Select Export Destination Folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths.length) return { path: null };
    return { path: r.filePaths[0] };
  });

  handle('export:select-file', async (p) => {
    const win = getWindow?.();
    const defaultName = typeof p.defaultName === 'string' ? p.defaultName : 'export';
    const filters = Array.isArray(p.filters) ? p.filters : [];
    const r = await dialog.showSaveDialog(win, {
      title: 'Select Export File',
      defaultPath: defaultName,
      filters
    });
    if (r.canceled || !r.filePath) return { path: null };
    return { path: r.filePath };
  });

  handle('export:files', async (p) => {
    const filePaths = requireArray(p.filePaths, 'filePaths', 500).map((x) => requireString(x, 'filePath', 1000));
    const targetDir = requireString(p.targetDir, 'targetDir', 1000);
    return exportFilesToDirectory({
      filePaths,
      targetDir,
      onProgress: (prog) => sendToWindow('export:progress', prog)
    });
  });

  handle('export:json', async (p) => {
    const items = requireArray(p.items, 'items', 2000);
    const targetPath = requireString(p.targetPath, 'targetPath', 1000);
    const jsonStr = formatMetadataAsJson(items);
    await fs.promises.writeFile(path.resolve(targetPath), jsonStr, 'utf8');
    return { ok: true, targetPath, count: items.length };
  });

  handle('export:csv', async (p) => {
    const items = requireArray(p.items, 'items', 2000);
    const targetPath = requireString(p.targetPath, 'targetPath', 1000);
    const csvStr = formatMetadataAsCsv(items);
    await fs.promises.writeFile(path.resolve(targetPath), csvStr, 'utf8');
    return { ok: true, targetPath, count: items.length };
  });

  /* ---------------- Phase 7: Safe FFmpeg Conversion Presets ---------------- */

  handle('converter:presets', async () => {
    return Object.values(CONVERSION_PRESETS);
  });

  handle('converter:list', async () => {
    return conversionService.listConversions();
  });

  handle('converter:start', async (p) => {
    const sourcePath = requireString(p.sourcePath, 'sourcePath', 1000);
    const presetId = requireString(p.presetId, 'presetId', 100);
    const destDir = typeof p.destDir === 'string' && p.destDir.trim() ? p.destDir.trim() : null;
    const durationSeconds = typeof p.durationSeconds === 'number' ? p.durationSeconds : null;
    return conversionService.startConversion({ sourcePath, presetId, destDir, durationSeconds });
  });

  handle('converter:cancel', async (p) => {
    const taskId = requireString(p.taskId, 'taskId', 100);
    return { cancelled: conversionService.cancelConversion(taskId) };
  });

  handle('converter:clear', async () => {
    return { cleared: conversionService.clearCompletedConversions() };
  });

  /* ---------------- Phase 7: Remote Storage Architecture ---------------- */

  handle('remote:nas-test', async (p) => {
    const basePath = requireString(p.basePath, 'basePath', 1000);
    const provider = new LocalNasStorageProvider({ basePath });
    return provider.testConnection();
  });

  handle('remote:nas-transfer', async (p) => {
    const sourcePath = requireString(p.sourcePath, 'sourcePath', 1000);
    const basePath = requireString(p.basePath, 'basePath', 1000);
    const targetSubdir = typeof p.targetSubdir === 'string' ? p.targetSubdir : '';
    const provider = new LocalNasStorageProvider({ basePath });
    return provider.transferFile({ sourcePath, targetSubdir });
  });

  /* ---------------- Phase 8: Secure Credentials & Storage Connections ---------------- */

  handle('credentials:status', async () => {
    return {
      available: isEncryptionAvailable(),
      platform: process.platform
    };
  });

  handle('storage:connections:list', async () => {
    return storageConnMgr.listConnections();
  });

  handle('storage:connections:get', async (p) => {
    const id = requireString(p.id, 'id', 120);
    return storageConnMgr.getConnection(id);
  });

  handle('storage:connections:save', async (p) => {
    const name = requireString(p.name, 'name', 200);
    const providerType = requireString(p.providerType || p.provider_type, 'providerType', 40);
    const host = typeof p.host === 'string' ? p.host.trim() : null;
    const port = p.port !== undefined && p.port !== null ? Number(p.port) : null;
    const basePath = typeof (p.basePath ?? p.base_path) === 'string' ? (p.basePath ?? p.base_path).trim() : '';
    const username = typeof p.username === 'string' ? p.username.trim() : null;
    const allowInsecureHttp = Boolean(p.allowInsecureHttp || p.allow_insecure_http);
    const hostKeyFingerprint = typeof (p.hostKeyFingerprint ?? p.host_key_fingerprint) === 'string' ? (p.hostKeyFingerprint ?? p.host_key_fingerprint).trim() : null;
    const region = typeof p.region === 'string' ? p.region.trim() : null;
    const forcePathStyle = Boolean(p.forcePathStyle || p.force_path_style);
    const credential = (typeof p.credential === 'object' && p.credential) || (typeof p.credential === 'string' && p.credential.trim()) ? p.credential : null;
    const removeCredential = Boolean(p.removeCredential);

    if (p.id) {
      const id = requireString(p.id, 'id', 120);
      return storageConnMgr.updateConnection(id, {
        name,
        host,
        port,
        base_path: basePath,
        username,
        allow_insecure_http: allowInsecureHttp,
        host_key_fingerprint: hostKeyFingerprint,
        region,
        force_path_style: forcePathStyle,
        secret: credential,
        removeSecret: removeCredential
      });
    }

    return storageConnMgr.createConnection({
      name,
      provider_type: providerType,
      host,
      port,
      base_path: basePath,
      username,
      allow_insecure_http: allowInsecureHttp,
      host_key_fingerprint: hostKeyFingerprint,
      region,
      force_path_style: forcePathStyle,
      secret: credential
    });
  });

  handle('storage:connections:delete', async (p) => {
    const id = requireString(p.id, 'id', 120);
    return storageConnMgr.deleteConnection(id);
  });

  handle('storage:connections:test', async (p) => {
    let provider;
    const s = settings();
    const allowLocalNetwork = Boolean(s.allowLocalNetwork);

    if (p.id) {
      const id = requireString(p.id, 'id', 120);
      const conn = await storageConnMgr.getInternalConnection(id);
      if (!conn) throw new Error(`Storage connection not found: ${id}`);

      if (conn.provider_type === 'local_nas') {
        provider = new LocalNasStorageProvider({ name: conn.name, basePath: conn.base_path });
      } else if (conn.provider_type === 'webdav') {
        provider = new WebDavStorageProvider({
          name: conn.name,
          serverUrl: conn.host,
          username: conn.username,
          password: conn.secret,
          allowInsecureHttp: Boolean(conn.allow_insecure_http),
          allowLocalNetwork
        });
      } else if (conn.provider_type === 'sftp') {
        provider = new SftpStorageProvider({
          name: conn.name,
          host: conn.host,
          port: conn.port || 22,
          username: conn.username,
          password: conn.secret,
          hostKeyFingerprint: conn.host_key_fingerprint,
          allowLocalNetwork
        });
      } else if (conn.provider_type === 's3') {
        let accessKeyId = conn.username;
        let secretAccessKey = null;
        let sessionToken = null;
        if (typeof conn.secret === 'object' && conn.secret) {
          accessKeyId = conn.secret.accessKeyId || accessKeyId;
          secretAccessKey = conn.secret.secretAccessKey;
          sessionToken = conn.secret.sessionToken;
        } else if (typeof conn.secret === 'string') {
          try {
            const parsed = JSON.parse(conn.secret);
            if (parsed && typeof parsed === 'object') {
              accessKeyId = parsed.accessKeyId || accessKeyId;
              secretAccessKey = parsed.secretAccessKey;
              sessionToken = parsed.sessionToken;
            } else {
              secretAccessKey = conn.secret;
            }
          } catch {
            secretAccessKey = conn.secret;
          }
        }

        provider = new S3StorageProvider({
          name: conn.name,
          endpoint: conn.host,
          region: conn.region || 'us-east-1',
          bucket: conn.base_path,
          accessKeyId,
          secretAccessKey,
          sessionToken,
          forcePathStyle: Boolean(conn.force_path_style),
          allowInsecureHttp: Boolean(conn.allow_insecure_http),
          allowLocalNetwork
        });
      }
    } else {
      const providerType = requireString(p.providerType || p.provider_type, 'providerType', 40);
      if (providerType === 'local_nas') {
        provider = new LocalNasStorageProvider({
          name: typeof p.name === 'string' ? p.name : 'Local NAS',
          basePath: requireString(p.basePath || p.base_path, 'basePath', 1000)
        });
      } else if (providerType === 'webdav') {
        provider = new WebDavStorageProvider({
          name: typeof p.name === 'string' ? p.name : 'WebDAV',
          serverUrl: requireString(p.host, 'host', 1000),
          username: typeof p.username === 'string' ? p.username : null,
          password: typeof p.credential === 'string' ? p.credential : null,
          allowInsecureHttp: Boolean(p.allowInsecureHttp || p.allow_insecure_http),
          allowLocalNetwork
        });
      } else if (providerType === 'sftp') {
        provider = new SftpStorageProvider({
          name: typeof p.name === 'string' ? p.name : 'SFTP',
          host: requireString(p.host, 'host', 1000),
          port: Number(p.port) || 22,
          username: requireString(p.username, 'username', 200),
          password: typeof p.credential === 'string' ? p.credential : null,
          hostKeyFingerprint: typeof p.hostKeyFingerprint === 'string' ? p.hostKeyFingerprint : null,
          allowLocalNetwork
        });
      } else if (providerType === 's3') {
        let accessKeyId = typeof p.username === 'string' ? p.username : null;
        let secretAccessKey = null;
        let sessionToken = null;
        if (typeof p.credential === 'object' && p.credential) {
          accessKeyId = p.credential.accessKeyId || accessKeyId;
          secretAccessKey = p.credential.secretAccessKey;
          sessionToken = p.credential.sessionToken;
        } else if (typeof p.credential === 'string') {
          try {
            const parsed = JSON.parse(p.credential);
            if (parsed && typeof parsed === 'object') {
              accessKeyId = parsed.accessKeyId || accessKeyId;
              secretAccessKey = parsed.secretAccessKey;
              sessionToken = parsed.sessionToken;
            } else {
              secretAccessKey = p.credential;
            }
          } catch {
            secretAccessKey = p.credential;
          }
        }

        provider = new S3StorageProvider({
          name: typeof p.name === 'string' ? p.name : 'S3',
          endpoint: typeof p.host === 'string' ? p.host : null,
          region: typeof p.region === 'string' ? p.region : 'us-east-1',
          bucket: requireString(p.basePath || p.base_path, 'basePath', 1000),
          accessKeyId,
          secretAccessKey,
          sessionToken,
          forcePathStyle: Boolean(p.forcePathStyle || p.force_path_style),
          allowInsecureHttp: Boolean(p.allowInsecureHttp || p.allow_insecure_http),
          allowLocalNetwork
        });
      } else {
        throw new Error(`Unsupported provider type: ${providerType}`);
      }
    }

    const testRes = await provider.testConnection();
    if (testRes.ok && p.id) {
      storageConnMgr.recordSuccess(p.id);
    }
    return testRes;
  });

  /* ---------------- Phase 8: Upload Queue ---------------- */

  handle('storage:upload:start', async (p) => {
    const connectionId = requireString(p.connectionId, 'connectionId', 120);
    const remoteSubdir = typeof p.remoteSubdir === 'string' ? p.remoteSubdir.trim() : '';
    const taskLimitKBps = typeof p.taskLimitKBps === 'number' ? Math.max(0, p.taskLimitKBps) : 0;

    if (Array.isArray(p.sourcePaths)) {
      const sourcePaths = requireArray(p.sourcePaths, 'sourcePaths', 500).map((x) => requireString(x, 'sourcePath', 1000));
      return uploadQueue.enqueueBatch({
        sourcePaths,
        connectionId,
        remoteSubdir,
        taskLimitKBps
      });
    }

    const sourcePath = requireString(p.sourcePath, 'sourcePath', 1000);
    return uploadQueue.enqueueUpload({
      sourcePath,
      connectionId,
      remotePath: remoteSubdir,
      taskLimitKBps
    });
  });

  handle('storage:upload:list', async (p) => {
    const limit = typeof p.limit === 'number' ? Math.min(500, Math.max(1, p.limit)) : 100;
    return uploadQueue.listUploads(limit);
  });

  handle('storage:upload:cancel', async (p) => {
    const id = requireString(p.id, 'id', 120);
    return { cancelled: uploadQueue.cancelUpload(id) };
  });

  handle('storage:upload:clear', async () => {
    return { cleared: uploadQueue.clearCompleted() };
  });

  /* ---------------- Phase 9: Backup Scheduler ---------------- */

  handle('backup:schedule:list', async () => {
    return backupScheduler.listSchedules();
  });

  handle('backup:schedule:get', async (p) => {
    const id = requireString(p.id, 'id', 120);
    return backupScheduler.getSchedule(id);
  });

  handle('backup:schedule:save', async (p) => {
    return backupScheduler.saveSchedule(p);
  });

  handle('backup:schedule:delete', async (p) => {
    const id = requireString(p.id, 'id', 120);
    return backupScheduler.deleteSchedule(id);
  });

  handle('backup:schedule:toggle', async (p) => {
    const id = requireString(p.id, 'id', 120);
    const enabled = Boolean(p.enabled);
    return backupScheduler.toggleSchedule(id, enabled);
  });

  handle('backup:schedule:run-now', async (p) => {
    const id = requireString(p.id, 'id', 120);
    backupScheduler.executeSchedule(id, true);
    return { ok: true, id };
  });

  handle('backup:run:list', async (p) => {
    const limit = typeof p.limit === 'number' ? Math.min(200, Math.max(1, p.limit)) : 50;
    return backupScheduler.listRuns(limit);
  });

  handle('backup:run:get', async (p) => {
    const id = requireString(p.id, 'id', 120);
    return backupScheduler.getRunDetails(id);
  });

  // Emitted event references for conversion telemetry
  function emitConversionEvents(data) {
    sendToWindow('conversion:progress', data);
    sendToWindow('conversion:updated', data);
  }

  // Emitted event references for telemetry verification
  function emitUploadEvents(data) {
    sendToWindow('upload:progress', data);
    sendToWindow('upload:updated', data);
  }

  // Emitted event references for backup scheduling & run telemetry
  function emitBackupEvents(data) {
    sendToWindow('backup:schedules:updated', data);
    sendToWindow('backup:runs:updated', data);
  }

  /* ---------------- queue & scheduler recovery on startup ---------------- */
  getQueue().recover();
  uploadQueue.recover();
  backupScheduler.recover();
}


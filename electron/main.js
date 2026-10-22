import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, session, shell, ipcMain, protocol } from 'electron';
import { logger } from './logger.js';
import { initDb, closeDb, getDb } from './db.js';
import { ensureDirs, loadSettings } from './settings.js';
import { createQueue } from './queue.js';
import { registerIpc } from './ipc.js';
import { createLoopbackBridge } from './bridge/loopbackServer.js';
import { createClipboardDetector } from './clipboard.js';
import { DEV_CSP, PROD_CSP } from '../src/lib/csp.js';
import { getStorageConnectionManager } from './storageConnections.js';
import { createUploadQueue } from './uploadQueue.js';
import { createBackupScheduler } from './backupScheduler.js';
import { createTrayManager } from './tray.js';
import { createUpdateService } from './updater.js';
import { createNotificationService } from './notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.NEXT_DEV_SERVER_URL;

if (app?.setName) {
  app.setName('MantiCollect');
} else if (app) {
  app.name = 'MantiCollect';
}

// Staged boot diagnostics (works in console-less packaged builds).
const bootLog = (m) => {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'mvault-boot.log'), `${new Date().toISOString()} ${m}\n`);
  } catch {}
};
bootLog('main.js loaded');

let mainWindow = null;
let queue = null;
let bridgeServer = null;
let clipboardDetector = null;
let trayManager = null;
let updateService = null;
let notificationService = null;
let backupScheduler = null;
let uploadQueue = null;
let isQuitting = false;
app.isQuitting = false;
let hasNotifiedCloseToTray = false;
let shutdownDone = false;

// Privileged app scheme: the static Next.js export is served from
// mvault://app/ so asset URLs have a real origin (file:// would break
// Next's root-absolute /_next paths and leaves an opaque CSP origin).
// Must be registered before the app is ready.
const APP_SCHEME = 'mvault';
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);
bootLog('schemes registered');

// Title bar overlay colors per theme (kept in sync with the CSS token themes).
const TITLEBAR_THEMES = {
  dark: { color: '#0b0d12', symbolColor: '#a4adba' },
  light: { color: '#f2f4f8', symbolColor: '#465060' }
};

const gotLock = app.requestSingleInstanceLock();
bootLog(gotLock ? 'lock: acquired' : 'lock: DENIED (another instance)');
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function applyWindowMaterials(win) {
    // Windows 11 (build >= 22000): native Mica behind the main surface.
    // Fallback: solid background color.
    try {
      const isWin11 = process.platform === 'win32' && parseInt(os.release().split('.')[2] || '0', 10) >= 22000;
      if (isWin11 && win.setBackgroundMaterial) {
        try {
          win.setBackgroundMaterial('micaDark');
          return 'micaDark';
        } catch {
          win.setBackgroundMaterial('mica');
          return 'mica';
        }
      }
    } catch {
      /* material API unavailable */
    }
    try {
      win.setBackgroundColor(TITLEBAR_THEMES.dark.color);
    } catch {}
    return 'solid';
  }

  function createWindow() {
    const shotIdx = process.argv.indexOf('--screenshot');
    // Deep-link for headless verification: --screenshot <out.png> [route]
    // route is a Next.js path like "queue" or "universal" (no leading slash).
    const shotRoute =
      shotIdx !== -1 && process.argv[shotIdx + 2] && !process.argv[shotIdx + 2].startsWith('-')
        ? process.argv[shotIdx + 2].replace(/^#?\/?/, '')
        : '';

    const iconIco = path.join(__dirname, 'assets', 'icon.ico');
    const iconPng = path.join(__dirname, 'assets', 'icon.png');
    const windowIcon = process.platform === 'win32' && fs.existsSync(iconIco) ? iconIco : iconPng;

    mainWindow = new BrowserWindow({
      width: 1360,
      height: 880,
      minWidth: 1100,
      minHeight: 680,
      show: false,
      // Solid opaque base color so desktop content never bleeds through.
      backgroundColor: TITLEBAR_THEMES.dark.color,
      title: 'MantiCollect — A Mantitup Product',
      icon: windowIcon,
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...TITLEBAR_THEMES.dark },
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        devTools: isDev
      }
    });

    applyWindowMaterials(mainWindow);

    const wc = mainWindow.webContents;

    // Never open new windows; external links go to the system browser.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    // Lock navigation to the app itself.
    wc.on('will-navigate', (e, url) => {
      const allowed = isDev ? url.startsWith(process.env.NEXT_DEV_SERVER_URL) : url.startsWith(`${APP_SCHEME}://`);
      if (!allowed) e.preventDefault();
    });

    // Local app only needs clipboard (paste URLs). Everything else denied.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(['clipboard-read', 'clipboard-sanitized-write'].includes(permission));
    });

    // Inject the CSP (applies to file:// and the dev server alike).
    const csp = isDev ? DEV_CSP : PROD_CSP;
    const headless = process.argv.includes('--smoke') || process.argv.includes('--screenshot');
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (headless && details.resourceType === 'mainFrame') {
        console.log('CSP_APPLIED ' + details.url);
      }
      callback({
        responseHeaders: {
          ...(details.responseHeaders || {}),
          'Content-Security-Policy': [csp]
        }
      });
    });

    if (isDev) {
      mainWindow.loadURL(process.env.NEXT_DEV_SERVER_URL + (shotRoute ? '/' + shotRoute : ''));
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
      mainWindow.loadURL(shotRoute ? `${APP_SCHEME}://app/${shotRoute}` : `${APP_SCHEME}://app/`);
    }

    mainWindow.once('ready-to-show', () => {
      const s = loadSettings();
      const isHeadless = smokeIdx !== -1 || shotIdx !== -1;
      if (!s.startMinimized || isHeadless) {
        mainWindow.show();
      }
    });

    mainWindow.on('minimize', (e) => {
      const s = loadSettings();
      if (s.minimizeToTray) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

    mainWindow.on('close', (e) => {
      if (isQuitting || app.isQuitting) return;
      const s = loadSettings();
      if (s.closeToTray) {
        e.preventDefault();
        mainWindow.hide();
        if (s.notifyOnCloseToTray && !hasNotifiedCloseToTray) {
          hasNotifiedCloseToTray = true;
          notificationService?.showNotification({
            type: 'custom',
            title: 'MantiCollect',
            body: 'MantiCollect is running in the system tray. Background tasks and schedules will continue.',
            route: '/'
          });
        }
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    const smokeIdx = process.argv.indexOf('--smoke');
    if (smokeIdx !== -1 || shotIdx !== -1) {
      // surface renderer console warnings/errors for headless verification
      const consoleLines = [];
      wc.on('console-message', (_e, level, message) => {
        consoleLines.push(`[${level}] ${message}`);
        if (level >= 2) console.log(`RENDERER_CONSOLE[${level}] ${message}`);
      });
      wc.on('render-process-gone', (_e, details) => {
        console.log(`RENDERER_GONE reason=${details.reason}`);
      });
      wc.once('did-finish-load', () => {
        if (shotIdx !== -1) {
          const outPath =
            process.argv[shotIdx + 1] && !process.argv[shotIdx + 1].startsWith('--')
              ? process.argv[shotIdx + 1]
              : path.join(__dirname, '..', '.qwen', 'tmp', 'ui.png');
          setTimeout(async () => {
            try {
              if (process.env.TEST_THEME === 'light') {
                await wc.executeJavaScript(
                  `(() => {
                    document.documentElement.classList.remove('dark');
                    document.documentElement.setAttribute('data-theme', 'light');
                    localStorage.setItem('mv-theme', 'light');
                  })()`
                );
                await new Promise((r) => setTimeout(r, 300));
              } else if (process.env.TEST_THEME === 'dark') {
                await wc.executeJavaScript(
                  `(() => {
                    document.documentElement.classList.add('dark');
                    document.documentElement.setAttribute('data-theme', 'dark');
                    localStorage.setItem('mv-theme', 'dark');
                  })()`
                );
                await new Promise((r) => setTimeout(r, 300));
              }
              if (process.env.TEST_SCROLL) {
                await wc.executeJavaScript(
                  `(() => {
                    const scrollTarget = '${process.env.TEST_SCROLL}';
                    let el = null;
                    try { el = document.querySelector(scrollTarget); } catch {}
                    if (el) el.scrollIntoView();
                    else {
                      const m = document.querySelector('main');
                      if (m) m.scrollTop = parseInt(scrollTarget, 10) || 500;
                    }
                  })()`
                );
                await new Promise((r) => setTimeout(r, 300));
              }
              // Positive hydration check: the client tree must be mounted
              // with real interactive elements, not just prerendered HTML.
              const probe = await wc.executeJavaScript(
                `(() => {
                  const inputs = document.querySelectorAll('input, select, button').length;
                  const active = document.querySelector('nav a[aria-current]');
                  return JSON.stringify({
                    ready: document.readyState,
                    controls: inputs,
                    bodyLen: document.body.innerHTML.length,
                    hydrated: !!document.querySelector('[data-sonner-toast], main, nav'),
                    path: window.location.pathname,
                    activeNav: active ? active.getAttribute('href') : null,
                    // Dashboard engine card shows real binary versions when found.
                    ytDlpVersionShown: /20\\d{2}\\.\\d{2}\\.\\d{2}/.test(document.body.innerText || '')
                  });
                })()`,
                true
              );
              console.log('DOM_PROBE ' + probe);
              const img = await wc.capturePage();
              fs.mkdirSync(path.dirname(outPath), { recursive: true });
              fs.writeFileSync(outPath, img.toPNG());
              console.log('SCREENSHOT_SAVED ' + outPath);
              // Packaged builds have no console; persist the report beside
              // the screenshot so headless runs remain verifiable.
              fs.writeFileSync(
                `${outPath}.probe.json`,
                JSON.stringify({ probe: JSON.parse(probe), console: consoleLines }, null, 2)
              );
              console.log('PROBE_SAVED ' + outPath + '.probe.json');
            } catch (e) {
              console.log('SCREENSHOT_FAIL ' + (e && e.message));
            }
            app.exit(0);
          }, 1800);
        } else {
          console.log('SMOKE_OK');
          setTimeout(() => app.exit(0), 200);
        }
      });
      setTimeout(() => {
        console.log('SMOKE_TIMEOUT');
        app.exit(1);
      }, 25000);
    }
  }

  /* -------- window controls (custom title bar) -------- */

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:get-state', () => ({
    maximized: mainWindow ? mainWindow.isMaximized() : false,
    minimized: mainWindow ? mainWindow.isMinimized() : false
  }));
  ipcMain.handle('window:set-theme', (_e, theme) => {
    const isLight = theme === 'light';
    const t = TITLEBAR_THEMES[isLight ? 'light' : 'dark'];
    try {
      mainWindow?.setTitleBarOverlay(t);
      mainWindow?.setBackgroundColor(t.color);
      if (mainWindow?.setBackgroundMaterial) {
        try {
          mainWindow.setBackgroundMaterial(isLight ? 'mica' : 'micaDark');
        } catch {}
      }
    } catch {}
    return true;
  });

  app.whenReady().then(async () => {
    bootLog('whenReady resolved');
    try {
      // Serve the static export from the privileged scheme. Canonical route
      // URLs are mapped to their static-export files (/universal ->
      // universal.html) so the renderer always sees the route path, never
      // the .html file name (which would desync server/client hydration).
      // Files are read through Node's fs (asar-aware in Electron), so this
      // works both with the unpacked dist/ (dev) and inside app.asar (packaged).
      const MIME = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.map': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.txt': 'text/plain; charset=utf-8',
        '.webmanifest': 'application/manifest+json'
      };
      const distDir = path.resolve(__dirname, '..', 'dist');
      protocol.handle(APP_SCHEME, (request) => {
        try {
          const u = new URL(request.url);
          let p = decodeURIComponent(u.pathname);
          if (p === '/' || p === '') p = '/index.html';
          const candidates = [p, `${p}.html`, `${p}/index.html`];
          for (const cand of candidates) {
            const filePath = path.resolve(distDir, `.${cand}`);
            if (filePath !== distDir && !filePath.startsWith(distDir + path.sep)) continue;
            let st;
            try {
              st = fs.statSync(filePath);
            } catch {
              continue;
            }
            if (!st.isFile()) continue;
            const buf = fs.readFileSync(filePath);
            const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
            return new Response(buf, { status: 200, headers: { 'Content-Type': type } });
          }
          return new Response('not found', { status: 404 });
        } catch {
          return new Response('bad request', { status: 400 });
        }
      });

      bootLog('protocol handled');

      ensureDirs();
      bootLog('dirs ensured');
      initDb();
      bootLog('db initialized');

      notificationService = createNotificationService({
        getSettings: loadSettings,
        getWindow: () => mainWindow,
        iconPath: path.join(__dirname, 'assets', 'icon.png')
      });
      bootLog('notification service created');

      updateService = createUpdateService({
        getSettings: loadSettings,
        getWindow: () => mainWindow,
        onNotification: (notif) => {
          notificationService?.notifyUpdateAvailable({ version: notif?.version });
        }
      });
      bootLog('updater service created');

      const storageConnMgr = getStorageConnectionManager();
      uploadQueue = createUploadQueue({
        getDbInstance: getDb,
        getSettings: loadSettings,
        getWindow: () => mainWindow,
        getConnectionManager: () => storageConnMgr
      });
      bootLog('upload queue created');

      backupScheduler = createBackupScheduler({
        getDbInstance: getDb,
        getWindow: () => mainWindow,
        getConnectionManager: () => storageConnMgr,
        getUploadQueueInstance: () => uploadQueue,
        onBackupStarted: (schedule, run) => {
          notificationService?.notifyBackupStarted({
            scheduleName: schedule?.name,
            runId: run?.id
          });
        },
        onBackupCompleted: (schedule, run) => {
          notificationService?.notifyBackupCompleted({
            scheduleName: schedule?.name,
            runId: run?.id,
            itemsCompleted: run?.items_completed,
            bytesTransferred: run?.bytes_transferred
          });
        },
        onBackupFailed: (schedule, run, err) => {
          notificationService?.notifyBackupFailed({
            scheduleName: schedule?.name,
            runId: run?.id,
            error: err?.message || err
          });
        }
      });
      bootLog('backup scheduler created');

      queue = createQueue({
        getWindow: () => mainWindow,
        onJobCompleted: (job) => {
          notificationService?.notifyDownloadComplete({
            id: job?.id,
            title: job?.title || job?.metadata?.title || 'Download',
            targetPath: job?.targetPath
          });
          trayManager?.updateMenu();
        },
        onJobFailed: (job, err) => {
          notificationService?.notifyDownloadFailed({
            id: job?.id,
            title: job?.title || job?.metadata?.title || 'Download',
            error: err?.message || err
          });
          trayManager?.updateMenu();
        }
      });
      bootLog('queue created');

      clipboardDetector = createClipboardDetector({
        getWindow: () => mainWindow,
        getSettings: loadSettings
      });
      clipboardDetector.start();
      bootLog('clipboard detector started');

      bridgeServer = createLoopbackBridge({
        getPort: () => loadSettings().browserBridgePort || 52443,
        getAuthToken: () => loadSettings().browserAuthToken,
        getQueue: () => queue,
        getWindow: () => mainWindow,
        getSettings: loadSettings,
        appVersion: process.env.npm_package_version || '0.1.0'
      });
      bridgeServer.start().catch((err) => {
        logger.warn('main', `Loopback bridge failed to bind: ${err?.message || err}`);
      });
      bootLog('bridge server started');

      trayManager = createTrayManager({
        getWindow: () => mainWindow,
        getQueue: () => queue,
        getUpdateService: () => updateService,
        onQuit: handleExplicitQuit,
        iconPath: path.join(__dirname, 'assets', 'tray-icon.png')
      });
      trayManager.init();
      bootLog('tray manager initialized');

      registerIpc({
        getQueue: () => queue,
        getWindow: () => mainWindow,
        getClipboardDetector: () => clipboardDetector,
        getStorageConnectionManager: () => storageConnMgr,
        getUploadQueue: () => uploadQueue,
        getBackupScheduler: () => backupScheduler,
        getUpdateService: () => updateService,
        getNotificationService: () => notificationService,
        onQuit: handleExplicitQuit
      });
      bootLog('ipc registered');

      createWindow();
      bootLog('window created');
      logger.info('main', `MantiCollect started (dev=${isDev})`);
    } catch (err) {
      logger.error('main', `startup failed: ${err?.stack || err}`);
      app.exit(1);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  function performGracefulShutdown() {
    if (shutdownDone) return;
    shutdownDone = true;
    try {
      if (trayManager) {
        trayManager.destroy();
        trayManager = null;
      }
    } catch (e) {
      logger.warn('main', `Tray destroy error: ${e?.message}`);
    }
    try {
      if (backupScheduler) {
        backupScheduler.shutdown();
        backupScheduler = null;
      }
    } catch (e) {
      logger.warn('main', `Backup scheduler shutdown error: ${e?.message}`);
    }
    try {
      if (uploadQueue) {
        uploadQueue.shutdown();
        uploadQueue = null;
      }
    } catch (e) {
      logger.warn('main', `Upload queue shutdown error: ${e?.message}`);
    }
    try {
      if (clipboardDetector) {
        clipboardDetector.stop();
        clipboardDetector = null;
      }
    } catch (e) {
      logger.warn('main', `Clipboard detector stop error: ${e?.message}`);
    }
    try {
      if (bridgeServer) {
        bridgeServer.stop();
        bridgeServer = null;
      }
    } catch (e) {
      logger.warn('main', `Bridge stop error: ${e?.message}`);
    }
    try {
      if (queue) {
        queue.shutdown();
        queue = null;
      }
    } catch (e) {
      logger.warn('main', `Queue shutdown error: ${e?.message}`);
    }
    try {
      closeDb();
    } catch (e) {
      logger.warn('main', `DB close error: ${e?.message}`);
    }
  }

  function handleExplicitQuit() {
    isQuitting = true;
    app.isQuitting = true;
    performGracefulShutdown();
    app.quit();
  }

  app.on('before-quit', () => {
    isQuitting = true;
    app.isQuitting = true;
  });

  app.on('will-quit', () => {
    performGracefulShutdown();
  });

  app.on('window-all-closed', () => {
    const s = loadSettings();
    if (s.closeToTray && !isQuitting && !app.isQuitting) {
      return;
    }
    performGracefulShutdown();
    app.quit();
  });
}

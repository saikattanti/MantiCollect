import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, session, shell, ipcMain, protocol } from 'electron';
import { logger } from './logger.js';
import { initDb, closeDb } from './db.js';
import { ensureDirs, loadSettings } from './settings.js';
import { createQueue } from './queue.js';
import { registerIpc } from './ipc.js';
import { createLoopbackBridge } from './bridge/loopbackServer.js';
import { createClipboardDetector } from './clipboard.js';
import { DEV_CSP, PROD_CSP } from '../src/lib/csp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.NEXT_DEV_SERVER_URL;

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

    mainWindow = new BrowserWindow({
      width: 1360,
      height: 880,
      minWidth: 1100,
      minHeight: 680,
      show: false,
      // Solid opaque base color so desktop content never bleeds through.
      backgroundColor: TITLEBAR_THEMES.dark.color,
      title: 'MediaVault',
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

    mainWindow.once('ready-to-show', () => mainWindow.show());
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
      queue = createQueue({ getWindow: () => mainWindow });
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

      registerIpc({
        getQueue: () => queue,
        getWindow: () => mainWindow,
        getClipboardDetector: () => clipboardDetector
      });
      bootLog('ipc registered');
      createWindow();
      bootLog('window created');
      logger.info('main', `MediaVault started (dev=${isDev})`);
    } catch (err) {
      logger.error('main', `startup failed: ${err?.stack || err}`);
      app.exit(1);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    try {
      if (clipboardDetector) clipboardDetector.stop();
      if (bridgeServer) bridgeServer.stop();
      if (queue) queue.shutdown();
    } catch {}
    closeDb();
    app.quit();
  });
}

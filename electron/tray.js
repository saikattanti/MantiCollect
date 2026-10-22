import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { logger } from './logger.js';

const { Tray: ElectronTray, Menu: ElectronMenu, nativeImage: ElectronNativeImage } =
  typeof electron === 'object' && electron ? electron : { Tray: null, Menu: null, nativeImage: null };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * System Tray Manager.
 *
 * Coordinates a single native system tray icon and context menu with real application
 * states (active downloads, pause/resume, cloud backups, updates, quit).
 */
export function createTrayManager({
  getWindow = () => null,
  getQueue = () => null,
  getUpdateService = () => null,
  onQuit = () => null,
  TrayClass = ElectronTray,
  MenuClass = ElectronMenu,
  nativeImageClass = ElectronNativeImage,
  iconPath = null
} = {}) {
  let trayInstance = null;

  function getTrayIcon() {
    if (iconPath) {
      return nativeImageClass?.createFromPath ? nativeImageClass.createFromPath(iconPath) : iconPath;
    }
    const defaultPath = path.join(__dirname, 'assets', 'tray-icon.png');
    return nativeImageClass?.createFromPath ? nativeImageClass.createFromPath(defaultPath) : defaultPath;
  }

  function showWindow(route = null) {
    const win = getWindow?.();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();

      if (route && typeof route === 'string') {
        try {
          win.webContents.send('navigation:navigate', route);
        } catch {}
      }
    }
  }

  function buildContextMenu() {
    const queue = getQueue?.();
    const jobs = queue?.listJobs ? queue.listJobs() : [];

    const activeDownloads = jobs.filter((j) => ['downloading', 'fetching_metadata', 'processing', 'resuming'].includes(j.status));
    const pausedDownloads = jobs.filter((j) => j.status === 'paused');

    const updater = getUpdateService?.();

    const template = [
      {
        label: 'Open MantiCollect',
        click: () => showWindow()
      },
      { type: 'separator' },
      {
        label: activeDownloads.length > 0 ? `Active Downloads (${activeDownloads.length})` : 'Downloads (Idle)',
        enabled: true,
        click: () => showWindow('/queue')
      }
    ];

    if (activeDownloads.length > 0) {
      template.push({
        label: 'Pause All Downloads',
        click: () => {
          for (const j of activeDownloads) {
            try {
              queue.pauseJob(j.id);
            } catch {}
          }
          updateMenu();
        }
      });
    }

    if (pausedDownloads.length > 0) {
      template.push({
        label: `Resume Downloads (${pausedDownloads.length})`,
        click: () => {
          for (const j of pausedDownloads) {
            try {
              queue.resumeJob(j.id);
            } catch {}
          }
          updateMenu();
        }
      });
    }

    template.push(
      {
        label: 'View Cloud Backups',
        click: () => showWindow('/backups')
      },
      { type: 'separator' },
      {
        label: 'Check for Updates',
        click: () => {
          if (updater?.checkForUpdates) {
            updater.checkForUpdates(true);
          }
          showWindow('/settings');
        }
      },
      { type: 'separator' },
      {
        label: 'Quit MantiCollect',
        click: () => {
          if (typeof onQuit === 'function') {
            onQuit();
          }
        }
      }
    );

    return MenuClass.buildFromTemplate(template);
  }

  function init() {
    if (trayInstance) {
      return trayInstance; // Prevent duplicate tray icons
    }

    if (!TrayClass) {
      logger.info('tray', 'TrayClass unavailable (test or headless mode)');
      return null;
    }

    try {
      const icon = getTrayIcon();
      trayInstance = new TrayClass(icon);
      trayInstance.setToolTip('MantiCollect — A Mantitup Product');

      const menu = buildContextMenu();
      trayInstance.setContextMenu(menu);

      // Single-click or double-click restores the window
      trayInstance.on('click', () => {
        const win = getWindow?.();
        if (win && !win.isDestroyed()) {
          if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
            win.hide();
          } else {
            showWindow();
          }
        }
      });

      trayInstance.on('double-click', () => {
        showWindow();
      });

      logger.info('tray', 'System tray icon initialized');
      return trayInstance;
    } catch (err) {
      logger.warn('tray', `Failed to initialize system tray: ${err.message}`);
      trayInstance = null;
      return null;
    }
  }

  function updateMenu() {
    if (!trayInstance || !MenuClass) return;
    try {
      const menu = buildContextMenu();
      trayInstance.setContextMenu(menu);

      const queue = getQueue?.();
      const jobs = queue?.listJobs ? queue.listJobs() : [];
      const activeCount = jobs.filter((j) => ['downloading', 'fetching_metadata', 'processing', 'resuming'].includes(j.status)).length;

      if (activeCount > 0) {
        trayInstance.setToolTip(`MantiCollect — ${activeCount} active download${activeCount > 1 ? 's' : ''}`);
      } else {
        trayInstance.setToolTip('MantiCollect — A Mantitup Product');
      }
    } catch (err) {
      logger.warn('tray', `Failed to update tray menu: ${err.message}`);
    }
  }

  function destroy() {
    if (trayInstance) {
      try {
        trayInstance.destroy();
      } catch {}
      trayInstance = null;
      logger.info('tray', 'System tray destroyed');
    }
  }

  function getInstance() {
    return trayInstance;
  }

  return {
    init,
    updateMenu,
    destroy,
    getInstance
  };
}

let _defaultTrayManager = null;
export function getTrayManager(opts) {
  if (!_defaultTrayManager || opts) {
    _defaultTrayManager = createTrayManager(opts);
  }
  return _defaultTrayManager;
}

import electron from 'electron';
import { loadSettings } from './settings.js';
import { logger } from './logger.js';

const { app } = typeof electron === 'object' && electron ? electron : { app: null };

export const UPDATER_STATES = {
  UNSUPPORTED_DEV: 'unsupported_dev',
  IDLE: 'idle',
  CHECKING: 'checking',
  AVAILABLE: 'available',
  DOWNLOADING: 'downloading',
  READY: 'ready',
  UP_TO_DATE: 'up-to-date',
  ERROR: 'error'
};

/**
 * Secure Auto-Updater Service.
 *
 * Provides a truthful, robust updater abstraction that strictly reports genuine
 * package and update conditions without fake percentages or simulated release feeds.
 */
export function createUpdateService({
  appVersion = process.env.npm_package_version || '0.1.0',
  isPackaged = app ? app.isPackaged : false,
  getSettings = loadSettings,
  getWindow = () => null,
  rawUpdater = null // Optional electron-updater instance when available in production
} = {}) {
  let currentState = !isPackaged ? UPDATER_STATES.UNSUPPORTED_DEV : UPDATER_STATES.IDLE;
  let statusMessage = !isPackaged
    ? 'Development build — automatic updates are disabled in unpacked development mode.'
    : 'Up to date';
  let availableVersion = null;
  let downloadProgress = null;
  let lastCheckedAt = null;
  let isChecking = false;

  function sendToWindow(channel, data) {
    const win = getWindow?.();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send(channel, data);
      } catch {}
    }
  }

  function getStatus() {
    return {
      state: currentState,
      message: statusMessage,
      currentVersion: appVersion,
      availableVersion,
      downloadProgress,
      lastCheckedAt,
      isPackaged: Boolean(isPackaged)
    };
  }

  function broadcastStatus() {
    sendToWindow('updater:status', getStatus());
  }

  function sanitizeError(err) {
    if (!err) return 'Unknown update error';
    const msg = typeof err === 'string' ? err : err.message || String(err);
    // Remove query params and auth tokens
    return msg.replace(/([?&](?:token|sig|key|signature|auth)=)[^&\s]+/gi, '$1***');
  }

  async function checkForUpdates(manual = false) {
    if (isChecking) {
      return getStatus();
    }

    lastCheckedAt = Date.now();

    if (!isPackaged) {
      currentState = UPDATER_STATES.UNSUPPORTED_DEV;
      statusMessage = 'Development build — production auto-updates require an installed, signed package.';
      broadcastStatus();
      return getStatus();
    }

    if (!rawUpdater) {
      currentState = UPDATER_STATES.IDLE;
      statusMessage = 'Update feed is not configured for this build target.';
      broadcastStatus();
      return getStatus();
    }

    isChecking = true;
    currentState = UPDATER_STATES.CHECKING;
    statusMessage = 'Checking for updates…';
    broadcastStatus();

    try {
      // Configure rawUpdater secure defaults
      rawUpdater.autoDownload = false;
      rawUpdater.autoInstallOnAppQuit = false;

      const result = await rawUpdater.checkForUpdates();
      isChecking = false;

      if (result && result.updateInfo && result.updateInfo.version !== appVersion) {
        currentState = UPDATER_STATES.AVAILABLE;
        availableVersion = result.updateInfo.version;
        statusMessage = `Update v${availableVersion} is available.`;
      } else {
        currentState = UPDATER_STATES.UP_TO_DATE;
        availableVersion = null;
        statusMessage = `MantiCollect v${appVersion} is up to date.`;
      }
    } catch (err) {
      isChecking = false;
      currentState = UPDATER_STATES.ERROR;
      statusMessage = `Update check failed: ${sanitizeError(err)}`;
      logger.warn('updater', `Update check failed: ${err.message}`);
    }

    broadcastStatus();
    return getStatus();
  }

  async function downloadUpdate() {
    if (!isPackaged || !rawUpdater || currentState !== UPDATER_STATES.AVAILABLE) {
      return getStatus();
    }

    currentState = UPDATER_STATES.DOWNLOADING;
    downloadProgress = 0;
    statusMessage = 'Downloading update…';
    broadcastStatus();

    try {
      await rawUpdater.downloadUpdate();
      currentState = UPDATER_STATES.READY;
      downloadProgress = 100;
      statusMessage = `Update v${availableVersion} is ready to install.`;
    } catch (err) {
      currentState = UPDATER_STATES.ERROR;
      downloadProgress = null;
      statusMessage = `Download failed: ${sanitizeError(err)}`;
      logger.warn('updater', `Download failed: ${err.message}`);
    }

    broadcastStatus();
    return getStatus();
  }

  function quitAndInstall() {
    if (currentState !== UPDATER_STATES.READY || !rawUpdater) {
      throw new Error('No update is downloaded and ready to install');
    }

    logger.info('updater', 'Restarting application to apply update…');
    rawUpdater.quitAndInstall(false, true);
  }

  // Hook rawUpdater events if provided
  if (rawUpdater) {
    try {
      rawUpdater.on('download-progress', (progressObj) => {
        if (progressObj && typeof progressObj.percent === 'number') {
          downloadProgress = Math.min(100, Math.max(0, Math.round(progressObj.percent)));
          broadcastStatus();
        }
      });

      rawUpdater.on('update-downloaded', (info) => {
        currentState = UPDATER_STATES.READY;
        availableVersion = info?.version || availableVersion;
        downloadProgress = 100;
        statusMessage = `Update v${availableVersion} downloaded. Restart to install.`;
        broadcastStatus();
      });

      rawUpdater.on('error', (err) => {
        currentState = UPDATER_STATES.ERROR;
        statusMessage = `Update error: ${sanitizeError(err)}`;
        broadcastStatus();
      });
    } catch {}
  }

  return {
    getStatus,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    UPDATER_STATES
  };
}

let _defaultUpdater = null;
export function getUpdateService(opts) {
  if (!_defaultUpdater || opts) {
    _defaultUpdater = createUpdateService(opts);
  }
  return _defaultUpdater;
}

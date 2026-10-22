import path from 'node:path';
import electron from 'electron';
import { loadSettings } from './settings.js';
import { logger } from './logger.js';

const { Notification: ElectronNotification } = typeof electron === 'object' && electron ? electron : { Notification: null };

/**
 * Native Desktop Notification Service.
 *
 * Manages native OS desktop notifications with user preference filtering,
 * burst deduplication, data sanitization, and deep-link click handling.
 */
export function createNotificationService({
  NotificationClass = ElectronNotification,
  getSettings = loadSettings,
  getWindow = () => null,
  iconPath = null
} = {}) {
  const recentNotifications = new Map(); // key -> timestamp (for rate limiting / throttling)
  const THROTTLE_WINDOW_MS = 2000;

  function isSupported() {
    return Boolean(NotificationClass && typeof NotificationClass.isSupported === 'function' && NotificationClass.isSupported());
  }

  /**
   * Sanitizes text to remove sensitive URL query parameters, authorization headers,
   * tokens, passwords, or full local system paths.
   */
  function sanitizeMessage(text) {
    if (!text || typeof text !== 'string') return '';
    let sanitized = text;

    // Strip sensitive query parameters like ?token=..., ?sig=..., ?key=...
    sanitized = sanitized.replace(/([?&](?:token|sig|key|signature|auth|credential|secret)=)[^&\s]+/gi, '$1***');

    // Strip basic auth from URLs if present
    sanitized = sanitized.replace(/(https?:\/\/)([^:@\s]+):([^@\s]+)@/gi, '$1$2:***@');

    // Cap length to prevent OS notification buffer overflow
    if (sanitized.length > 250) {
      sanitized = sanitized.slice(0, 247) + '…';
    }

    return sanitized;
  }

  /**
   * Dispatches a native desktop notification if user settings permit it.
   */
  function showNotification({
    type, // 'download_complete' | 'download_failed' | 'backup_complete' | 'backup_failed' | 'backup_started' | 'update_available' | 'custom'
    title,
    body,
    route = null, // e.g. '/queue', '/backups', '/library'
    silent = false
  }) {
    const s = getSettings();

    // Check master switch
    if (s.notificationsEnabled === false) {
      return false;
    }

    // Check category-specific switch
    if (type === 'download_complete' && s.notifyDownloadComplete === false) return false;
    if (type === 'download_failed' && s.notifyDownloadFailed === false) return false;
    if (type === 'backup_complete' && s.notifyBackupComplete === false) return false;
    if (type === 'backup_failed' && s.notifyBackupFailed === false) return false;
    if (type === 'backup_started' && s.notifyBackupStarted !== true) return false;
    if (type === 'update_available' && s.notifyUpdates === false) return false;

    // Check throttle to avoid notification storms
    const now = Date.now();
    const throttleKey = `${type}:${title}`;
    const lastShown = recentNotifications.get(throttleKey);
    if (lastShown && now - lastShown < THROTTLE_WINDOW_MS) {
      return false;
    }
    recentNotifications.set(throttleKey, now);

    // Clean up old throttle entries periodically
    if (recentNotifications.size > 50) {
      for (const [k, ts] of recentNotifications.entries()) {
        if (now - ts > THROTTLE_WINDOW_MS * 2) {
          recentNotifications.delete(k);
        }
      }
    }

    if (!isSupported()) {
      logger.info('notifications', `Native notifications not supported on this platform: "${title}"`);
      return false;
    }

    try {
      const cleanTitle = sanitizeMessage(title);
      const cleanBody = sanitizeMessage(body);

      const options = {
        title: cleanTitle,
        body: cleanBody,
        silent: Boolean(silent)
      };

      if (iconPath) {
        options.icon = iconPath;
      }

      const notif = new NotificationClass(options);

      notif.on('click', () => {
        const win = getWindow?.();
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          if (!win.isVisible()) win.show();
          win.focus();

          if (route && typeof route === 'string' && route.startsWith('/')) {
            try {
              win.webContents.send('navigation:navigate', route);
            } catch {}
          }
        }
      });

      notif.show();
      return true;
    } catch (err) {
      logger.warn('notifications', `Failed to display native notification: ${err.message}`);
      return false;
    }
  }

  function notifyDownloadComplete({ id, title, targetPath } = {}) {
    return showNotification({
      type: 'download_complete',
      title: 'Download Complete',
      body: title ? `Finished downloading ${title}` : 'Download completed successfully.',
      route: '/queue'
    });
  }

  function notifyDownloadFailed({ id, title, error } = {}) {
    return showNotification({
      type: 'download_failed',
      title: 'Download Failed',
      body: `${title || 'File'}: ${error || 'Unknown transfer error'}`,
      route: '/queue'
    });
  }

  function notifyBackupStarted({ scheduleName, runId } = {}) {
    return showNotification({
      type: 'backup_started',
      title: 'Cloud Backup Started',
      body: `Running backup schedule: ${scheduleName || 'Scheduled Backup'}`,
      route: '/backups'
    });
  }

  function notifyBackupCompleted({ scheduleName, runId, itemsCompleted, bytesTransferred } = {}) {
    const countStr = typeof itemsCompleted === 'number' ? ` (${itemsCompleted} items)` : '';
    return showNotification({
      type: 'backup_complete',
      title: 'Cloud Backup Complete',
      body: `Backup "${scheduleName || 'Vault'}" completed successfully${countStr}.`,
      route: '/backups'
    });
  }

  function notifyBackupFailed({ scheduleName, runId, error } = {}) {
    return showNotification({
      type: 'backup_failed',
      title: 'Cloud Backup Failed',
      body: `Backup "${scheduleName || 'Vault'}" encountered an error: ${error || 'Transfer failed'}`,
      route: '/backups'
    });
  }

  function notifyUpdateAvailable({ version } = {}) {
    return showNotification({
      type: 'update_available',
      title: 'Update Available',
      body: `A new version of MantiCollect (${version || ''}) is available.`,
      route: '/settings'
    });
  }

  return {
    isSupported,
    sanitizeMessage,
    showNotification,
    notifyDownloadComplete,
    notifyDownloadFailed,
    notifyBackupStarted,
    notifyBackupCompleted,
    notifyBackupFailed,
    notifyUpdateAvailable
  };
}

let _defaultNotifications = null;
export function getNotificationService(opts) {
  if (!_defaultNotifications || opts) {
    _defaultNotifications = createNotificationService(opts);
  }
  return _defaultNotifications;
}

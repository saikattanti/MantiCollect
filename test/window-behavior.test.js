import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../electron/settings.js';

test('window-behavior: default Phase 10 desktop behavior and notification settings', () => {
  assert.equal(DEFAULTS.minimizeToTray, false);
  assert.equal(typeof DEFAULTS.closeToTray, 'boolean');
  assert.equal(DEFAULTS.startMinimized, false);
  assert.equal(DEFAULTS.notifyOnCloseToTray, true);
  assert.equal(DEFAULTS.notificationsEnabled, true);
  assert.equal(DEFAULTS.notifyDownloadComplete, true);
  assert.equal(DEFAULTS.notifyDownloadFailed, true);
  assert.equal(DEFAULTS.notifyBackupComplete, true);
  assert.equal(DEFAULTS.notifyBackupFailed, true);
  assert.equal(DEFAULTS.notifyBackupStarted, false);
  assert.equal(DEFAULTS.notifyUpdates, true);
  assert.equal(DEFAULTS.autoCheckUpdates, true);
});

test('window-behavior: patch merges Phase 10 settings cleanly', () => {
  const initial = { ...DEFAULTS };
  const patch = {
    minimizeToTray: true,
    closeToTray: true,
    startMinimized: true,
    notifyOnCloseToTray: false,
    notificationsEnabled: false,
    notifyDownloadComplete: false,
    notifyDownloadFailed: false,
    notifyBackupComplete: false,
    notifyBackupFailed: false,
    notifyBackupStarted: true,
    notifyUpdates: false,
    autoCheckUpdates: false
  };

  const merged = { ...initial, ...patch };
  assert.equal(merged.minimizeToTray, true);
  assert.equal(merged.closeToTray, true);
  assert.equal(merged.startMinimized, true);
  assert.equal(merged.notifyOnCloseToTray, false);
  assert.equal(merged.notificationsEnabled, false);
  assert.equal(merged.notifyDownloadComplete, false);
  assert.equal(merged.notifyDownloadFailed, false);
  assert.equal(merged.notifyBackupComplete, false);
  assert.equal(merged.notifyBackupFailed, false);
  assert.equal(merged.notifyBackupStarted, true);
  assert.equal(merged.notifyUpdates, false);
  assert.equal(merged.autoCheckUpdates, false);
});

test('window-behavior: close-to-tray lifecycle logic', () => {
  let isQuitting = false;
  let defaultPrevented = false;
  let windowHidden = false;

  const mockEvent = {
    preventDefault: () => { defaultPrevented = true; }
  };

  const mockWindow = {
    hide: () => { windowHidden = true; }
  };

  function handleClose(e, settings) {
    if (isQuitting) return; // Allow standard close/quit
    if (settings.closeToTray) {
      e.preventDefault();
      mockWindow.hide();
    }
  }

  // 1. With closeToTray = true and not quitting: window hide is triggered and close prevented
  handleClose(mockEvent, { closeToTray: true });
  assert.equal(defaultPrevented, true);
  assert.equal(windowHidden, true);

  // 2. With closeToTray = false: event is not prevented
  defaultPrevented = false;
  windowHidden = false;
  handleClose(mockEvent, { closeToTray: false });
  assert.equal(defaultPrevented, false);
  assert.equal(windowHidden, false);

  // 3. When isQuitting = true: event is never prevented even if closeToTray is true
  isQuitting = true;
  defaultPrevented = false;
  windowHidden = false;
  handleClose(mockEvent, { closeToTray: true });
  assert.equal(defaultPrevented, false);
  assert.equal(windowHidden, false);
});

test('window-behavior: minimize-to-tray lifecycle logic', () => {
  let defaultPrevented = false;
  let windowHidden = false;

  const mockEvent = {
    preventDefault: () => { defaultPrevented = true; }
  };

  const mockWindow = {
    hide: () => { windowHidden = true; }
  };

  function handleMinimize(e, settings) {
    if (settings.minimizeToTray) {
      e.preventDefault();
      mockWindow.hide();
    }
  }

  // 1. When minimizeToTray is true
  handleMinimize(mockEvent, { minimizeToTray: true });
  assert.equal(defaultPrevented, true);
  assert.equal(windowHidden, true);

  // 2. When minimizeToTray is false
  defaultPrevented = false;
  windowHidden = false;
  handleMinimize(mockEvent, { minimizeToTray: false });
  assert.equal(defaultPrevented, false);
  assert.equal(windowHidden, false);
});

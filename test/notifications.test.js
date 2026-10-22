import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationService } from '../electron/notifications.js';

class MockNotification {
  static instances = [];
  static supported = true;

  static isSupported() {
    return MockNotification.supported;
  }

  constructor(options) {
    this.options = options;
    this.shown = false;
    this.listeners = new Map();
    MockNotification.instances.push(this);
  }

  on(event, fn) {
    this.listeners.set(event, fn);
  }

  show() {
    this.shown = true;
  }
}

function createMockWindow() {
  const events = [];
  return {
    events,
    visible: false,
    minimized: false,
    focused: false,
    destroyed: false,
    isVisible() { return this.visible; },
    isMinimized() { return this.minimized; },
    isFocused() { return this.focused; },
    isDestroyed() { return this.destroyed; },
    show() { this.visible = true; },
    hide() { this.visible = false; },
    restore() { this.minimized = false; },
    focus() { this.focused = true; },
    webContents: {
      send: (ch, payload) => events.push({ ch, payload })
    }
  };
}

test('notifications: sensitive data sanitization', () => {
  const service = createNotificationService({
    NotificationClass: MockNotification,
    getSettings: () => ({ notificationsEnabled: true })
  });

  const cleanQuery = service.sanitizeMessage('https://example.com/vault.mp4?token=secret12345&sig=abcdef987');
  assert.ok(!cleanQuery.includes('secret12345'), 'Must strip query token value');
  assert.ok(!cleanQuery.includes('abcdef987'), 'Must strip signature value');
  assert.ok(cleanQuery.includes('***'));

  const cleanAuth = service.sanitizeMessage('https://alice:supersecretpassword@vault.internal/media.mkv');
  assert.ok(!cleanAuth.includes('supersecretpassword'), 'Must strip URL basic auth password');
  assert.ok(cleanAuth.includes('***'));

  const longText = 'a'.repeat(400);
  const cleanLong = service.sanitizeMessage(longText);
  assert.ok(cleanLong.length <= 250, 'Must truncate excessively long messages');
  assert.ok(cleanLong.endsWith('…'));
});

test('notifications: user preference filtering', () => {
  MockNotification.instances = [];

  let currentSettings = {
    notificationsEnabled: false, // Master switch OFF
    notifyDownloadComplete: true
  };

  const service = createNotificationService({
    NotificationClass: MockNotification,
    getSettings: () => currentSettings
  });

  // When master switch is off, no notifications are shown
  const shownMasterOff = service.showNotification({
    type: 'download_complete',
    title: 'Download Finished',
    body: 'test.mp4'
  });
  assert.equal(shownMasterOff, false);
  assert.equal(MockNotification.instances.length, 0);

  // Turn master switch ON, but turn notifyDownloadComplete OFF
  currentSettings = {
    notificationsEnabled: true,
    notifyDownloadComplete: false,
    notifyDownloadFailed: true
  };

  const shownCompleteDisabled = service.showNotification({
    type: 'download_complete',
    title: 'Download Finished',
    body: 'test.mp4'
  });
  assert.equal(shownCompleteDisabled, false);

  // Category enabled -> successfully shows
  const shownFailedEnabled = service.showNotification({
    type: 'download_failed',
    title: 'Download Error',
    body: 'Connection reset'
  });
  assert.equal(shownFailedEnabled, true);
  assert.equal(MockNotification.instances.length, 1);
  assert.equal(MockNotification.instances[0].shown, true);
});

test('notifications: burst throttling suppresses rapid duplicate events', () => {
  MockNotification.instances = [];
  const service = createNotificationService({
    NotificationClass: MockNotification,
    getSettings: () => ({ notificationsEnabled: true, notifyDownloadComplete: true })
  });

  const first = service.showNotification({
    type: 'download_complete',
    title: 'Download Finished',
    body: 'video1.mp4'
  });
  assert.equal(first, true);

  // Immediate second call with identical type and title is suppressed
  const duplicate = service.showNotification({
    type: 'download_complete',
    title: 'Download Finished',
    body: 'video2.mp4'
  });
  assert.equal(duplicate, false);
  assert.equal(MockNotification.instances.length, 1);
});

test('notifications: click triggers window focus and safe internal navigation', () => {
  MockNotification.instances = [];
  const win = createMockWindow();
  win.visible = false;
  win.minimized = true;

  const service = createNotificationService({
    NotificationClass: MockNotification,
    getWindow: () => win,
    getSettings: () => ({ notificationsEnabled: true, notifyBackupComplete: true })
  });

  service.notifyBackupCompleted({
    scheduleName: 'Nightly S3 Vault',
    runId: 'run-101',
    itemsCompleted: 5,
    bytesTransferred: 10485760
  });

  assert.equal(MockNotification.instances.length, 1);
  const notif = MockNotification.instances[0];

  // Trigger notification click event
  const clickHandler = notif.listeners.get('click');
  assert.ok(clickHandler);
  clickHandler();

  assert.equal(win.visible, true);
  assert.equal(win.minimized, false);
  assert.equal(win.focused, true);

  // Validates internal route navigation was sent
  assert.equal(win.events.length, 1);
  assert.equal(win.events[0].ch, 'navigation:navigate');
  assert.equal(win.events[0].payload, '/backups');
});

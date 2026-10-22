import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrayManager } from '../electron/tray.js';

class MockTray {
  constructor(icon) {
    this.icon = icon;
    this.toolTip = '';
    this.contextMenu = null;
    this.listeners = new Map();
    this.isDestroyed = false;
  }

  setToolTip(tip) {
    this.toolTip = tip;
  }

  setContextMenu(menu) {
    this.contextMenu = menu;
  }

  on(event, fn) {
    this.listeners.set(event, fn);
  }

  destroy() {
    this.isDestroyed = true;
  }
}

class MockMenu {
  static buildFromTemplate(template) {
    return { template };
  }
}

function createMockWindow() {
  return {
    visible: false,
    minimized: false,
    focused: false,
    destroyed: false,
    navEvents: [],
    isVisible() { return this.visible; },
    isMinimized() { return this.minimized; },
    isFocused() { return this.focused; },
    isDestroyed() { return this.destroyed; },
    show() { this.visible = true; },
    hide() { this.visible = false; },
    restore() { this.minimized = false; },
    focus() { this.focused = true; },
    webContents: {
      send: (channel, data) => {
        // mock webContents
      }
    }
  };
}

test('tray: idempotent initialization and duplicate prevention', () => {
  const win = createMockWindow();
  const manager = createTrayManager({
    getWindow: () => win,
    TrayClass: MockTray,
    MenuClass: MockMenu,
    nativeImageClass: { createFromPath: (p) => p },
    iconPath: 'test/icon.png'
  });

  const tray1 = manager.init();
  assert.ok(tray1 instanceof MockTray);
  assert.equal(tray1.toolTip, 'MantiCollect — A Mantitup Product');

  // Calling init again returns the existing instance without creating a second tray
  const tray2 = manager.init();
  assert.strictEqual(tray1, tray2);
  assert.strictEqual(manager.getInstance(), tray1);

  manager.destroy();
  assert.equal(tray1.isDestroyed, true);
  assert.strictEqual(manager.getInstance(), null);
});

test('tray: window restore on click and double-click', () => {
  const win = createMockWindow();
  win.visible = false;
  win.minimized = true;

  const manager = createTrayManager({
    getWindow: () => win,
    TrayClass: MockTray,
    MenuClass: MockMenu,
    nativeImageClass: { createFromPath: (p) => p }
  });

  const tray = manager.init();
  assert.ok(tray);

  // Trigger double-click
  const doubleClickFn = tray.listeners.get('double-click');
  assert.ok(doubleClickFn);
  doubleClickFn();

  assert.equal(win.visible, true);
  assert.equal(win.minimized, false);
  assert.equal(win.focused, true);

  // If window is visible and focused, single click toggles it to hidden
  const clickFn = tray.listeners.get('click');
  assert.ok(clickFn);
  clickFn();
  assert.equal(win.visible, false);

  // Next click restores and shows it again
  clickFn();
  assert.equal(win.visible, true);

  manager.destroy();
});

test('tray: menu template reflects real queue states', () => {
  const pausedJobs = [];
  const resumedJobs = [];
  const mockQueue = {
    listJobs: () => [
      { id: 'job-1', status: 'downloading' },
      { id: 'job-2', status: 'paused' }
    ],
    pauseJob: (id) => pausedJobs.push(id),
    resumeJob: (id) => resumedJobs.push(id)
  };

  let quitCalled = false;
  let updateCheckCalled = false;
  const mockUpdater = {
    checkForUpdates: () => { updateCheckCalled = true; }
  };

  const manager = createTrayManager({
    getQueue: () => mockQueue,
    getUpdateService: () => mockUpdater,
    onQuit: () => { quitCalled = true; },
    TrayClass: MockTray,
    MenuClass: MockMenu,
    nativeImageClass: { createFromPath: (p) => p }
  });

  const tray = manager.init();
  const template = tray.contextMenu.template;

  // Labels present
  const openItem = template.find((i) => i.label === 'Open MantiCollect');
  assert.ok(openItem);

  const activeItem = template.find((i) => i.label && i.label.includes('Active Downloads (1)'));
  assert.ok(activeItem);

  const pauseItem = template.find((i) => i.label === 'Pause All Downloads');
  assert.ok(pauseItem);
  pauseItem.click();
  assert.deepEqual(pausedJobs, ['job-1']);

  const resumeItem = template.find((i) => i.label && i.label.includes('Resume Downloads (1)'));
  assert.ok(resumeItem);
  resumeItem.click();
  assert.deepEqual(resumedJobs, ['job-2']);

  const updateItem = template.find((i) => i.label === 'Check for Updates');
  assert.ok(updateItem);
  updateItem.click();
  assert.equal(updateCheckCalled, true);

  const quitItem = template.find((i) => i.label === 'Quit MantiCollect');
  assert.ok(quitItem);
  quitItem.click();
  assert.equal(quitCalled, true);

  manager.destroy();
});

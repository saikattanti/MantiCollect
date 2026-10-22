import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateService } from '../electron/updater.js';

test('updater: honest development mode status', async () => {
  const service = createUpdateService({
    isPackaged: false,
    appVersion: '0.1.0'
  });

  const status = service.getStatus();
  assert.equal(status.state, 'unsupported_dev');
  assert.equal(status.isPackaged, false);
  assert.equal(status.currentVersion, '0.1.0');
  assert.ok(status.message.includes('Development build'));

  // Checking in development returns unsupported_dev without network requests
  const checkResult = await service.checkForUpdates(true);
  assert.equal(checkResult.state, 'unsupported_dev');
});

test('updater: install rejected when not ready', () => {
  const service = createUpdateService({
    isPackaged: false,
    appVersion: '0.1.0'
  });

  // Calling quitAndInstall when state is not 'ready' throws clear error
  assert.throws(
    () => service.quitAndInstall(),
    /No update is downloaded and ready to install/
  );
});

test('updater: error sanitization preserves user privacy', async () => {
  const service = createUpdateService({
    isPackaged: true,
    rawUpdater: {
      checkForUpdates: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:443 with secret ?token=super_secret_auth_token');
      }
    }
  });

  const checkResult = await service.checkForUpdates(true);
  assert.equal(checkResult.state, 'error');
  assert.ok(!checkResult.message.includes('super_secret_auth_token'), 'Sensitive secrets must be sanitized from error messages');
  assert.ok(checkResult.message.includes('***'));
});

test('updater: broadcasts status updates to window', async () => {
  const broadcastEvents = [];
  const mockWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, data) => broadcastEvents.push({ channel, data })
    }
  };

  const service = createUpdateService({
    isPackaged: true,
    getWindow: () => mockWindow,
    rawUpdater: {
      checkForUpdates: async () => {
        return {
          updateInfo: {
            version: '0.2.0',
            releaseNotes: 'Phase 10 Release'
          }
        };
      }
    }
  });

  const result = await service.checkForUpdates(true);
  assert.equal(result.state, 'available');
  assert.equal(result.availableVersion, '0.2.0');

  // Verify 'updater:status' with available state was broadcast to the renderer
  const availableBroadcast = broadcastEvents.find((e) => e.channel === 'updater:status' && e.data.state === 'available');
  assert.ok(availableBroadcast);
  assert.equal(availableBroadcast.data.availableVersion, '0.2.0');
});

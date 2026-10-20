const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = new Set([
  'app:info',
  'probe',
  'jobs:list',
  'jobs:start',
  'jobs:pause',
  'jobs:resume',
  'jobs:cancel',
  'jobs:retry',
  'jobs:remove',
  'jobs:clear-completed',
  'batch:validate',
  'library:scan',
  'library:thumbnail',
  'library:delete',
  'library:zip',
  'library:missing',
  'media:thumbnail',
  'settings:get',
  'settings:set',
  'platforms:list',
  'dialog:select-directory',
  'path:reveal',
  'bins:status',
  'bins:install-ytdlp',
  'window:minimize',
  'window:toggle-maximize',
  'window:close',
  'window:get-state',
  'window:set-theme'
]);

const EVENT_CHANNELS = new Set(['jobs:updated', 'zip:progress', 'ytdlp:install']);

contextBridge.exposeInMainWorld('mv', {
  invoke(channel, payload) {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(event, callback) {
    if (!EVENT_CHANNELS.has(event)) return () => {};
    const listener = (_e, data) => callback(data);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  }
});

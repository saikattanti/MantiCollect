const mv = () => window.mv;

export function invoke(channel, payload) {
  return mv().invoke(channel, payload).then((res) => {
    if (!res.ok) throw new Error(res.error);
    return res.result;
  });
}

export function onEvent(event, callback) {
  return mv().on(event, callback);
}

export const api = {
  info: () => invoke('app:info'),
  probe: (url) => invoke('probe', { url }),
  jobs: {
    list: () => invoke('jobs:list'),
    start: (p) => invoke('jobs:start', p),
    pause: (id) => invoke('jobs:pause', { id }),
    resume: (id) => invoke('jobs:resume', { id }),
    cancel: (id) => invoke('jobs:cancel', { id }),
    retry: (id) => invoke('jobs:retry', { id }),
    remove: (id) => invoke('jobs:remove', { id }),
    clearCompleted: () => invoke('jobs:clear-completed')
  },
  batchValidate: (urls) => invoke('batch:validate', { urls }),
  library: {
    scan: () => invoke('library:scan'),
    thumbnail: (p) => invoke('library:thumbnail', { path: p }),
    delete: (paths) => invoke('library:delete', { paths }),
    zip: (paths) => invoke('library:zip', { paths }),
    missing: () => invoke('library:missing')
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', { patch })
  },
  platforms: () => invoke('platforms:list'),
  selectDirectory: () => invoke('dialog:select-directory'),
  reveal: (path) => invoke('path:reveal', { path }),
  mediaThumbnail: (url) => invoke('media:thumbnail', { url }),
  bins: {
    status: () => invoke('bins:status'),
    installYtDlp: () => invoke('bins:install-ytdlp')
  },
  window: {
    setTheme: (theme) => invoke('window:set-theme', theme),
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggle-maximize'),
    close: () => invoke('window:close'),
    getState: () => invoke('window:get-state')
  },
  browser: {
    status: () => invoke('browser:status'),
    regenerateToken: () => invoke('browser:regenerate-token'),
    openExtensionDir: () => invoke('browser:open-extension-dir'),
    openHostDir: () => invoke('browser:open-host-dir')
  },
  clipboard: {
    getDetected: () => invoke('clipboard:get-detected'),
    clear: () => invoke('clipboard:clear')
  }
};

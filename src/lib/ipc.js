const mv = () => {
  if (typeof window !== 'undefined' && window.mv) return window.mv;
  return {
    invoke: async (channel) => {
      if (channel === 'settings:get') {
        return {
          ok: true,
          result: {
            downloadDir: 'C:\\Downloads',
            globalUploadLimitKBps: 0,
            perTaskUploadLimitKBps: 0,
            allowLocalNetwork: false
          }
        };
      }
      if (channel === 'storage:connections:list') {
        return {
          ok: true,
          result: [
            {
              id: 'mock-s3-1',
              name: 'AWS S3 Production Vault',
              provider_type: 's3',
              host: null,
              base_path: 'mantitup-media-backups',
              region: 'us-east-1',
              force_path_style: 0,
              hasCredentials: true,
              last_success_at: Date.now() - 3600000
            }
          ]
        };
      }
      if (channel === 'backup:schedules:list') {
        return {
          ok: true,
          result: [
            {
              id: 'sched-mock-1',
              name: 'Nightly S3 Cloud Vault',
              enabled: 1,
              source_type: 'entire_library',
              destination_connection_id: 'mock-s3-1',
              remote_prefix: 'backups/media/',
              recurrence_type: 'daily',
              daily_time: '02:00',
              next_run_at: Date.now() + 18000000,
              last_run_at: Date.now() - 72000000,
              last_status: 'completed'
            }
          ]
        };
      }
      if (channel === 'backup:runs:list') {
        return {
          ok: true,
          result: [
            {
              id: 'run-mock-1',
              schedule_id: 'sched-mock-1',
              schedule_name: 'Nightly S3 Cloud Vault',
              connection_name: 'AWS S3 Production Vault',
              started_at: Date.now() - 72000000,
              finished_at: Date.now() - 71800000,
              status: 'completed',
              items_completed: 12,
              items_failed: 0,
              items_skipped: 3,
              items_total: 15,
              bytes_transferred: 485000000
            }
          ]
        };
      }
      if (channel === 'collections:list') {
        return {
          ok: true,
          result: [
            { id: 'col-1', name: 'Documentaries', item_count: 8 }
          ]
        };
      }
      if (channel === 'updater:status') {
        return {
          ok: true,
          result: {
            state: 'unsupported_dev',
            message: 'Development build — automatic updates are disabled in unpacked development mode.',
            currentVersion: '0.1.0',
            availableVersion: null,
            downloadProgress: null,
            lastCheckedAt: Date.now(),
            isPackaged: false
          }
        };
      }
      if (channel === 'updater:check') {
        return {
          ok: true,
          result: {
            state: 'unsupported_dev',
            message: 'Development build — production auto-updates require an installed, signed package.',
            currentVersion: '0.1.0'
          }
        };
      }
      if (channel === 'notifications:test') {
        return { ok: true, result: { ok: true, shown: true } };
      }
      if (channel === 'app:quit') {
        return { ok: true, result: { ok: true } };
      }
      return { ok: true, result: [] };
    },
    on: () => () => {}
  };
};

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
    missing: () => invoke('library:missing'),
    query: (params) => invoke('library:query', params || {}),
    probeFile: (filePath) => invoke('library:probe-file', { filePath }),
    probeBatch: (filePaths) => invoke('library:probe-batch', { filePaths })
  },
  collections: {
    list: () => invoke('collections:list'),
    get: (id) => invoke('collections:get', { id }),
    create: (p) => invoke('collections:create', p),
    rename: (id, name) => invoke('collections:rename', { id, name }),
    delete: (id) => invoke('collections:delete', { id }),
    addItems: (collectionId, itemPaths) => invoke('collections:add-items', { collectionId, itemPaths }),
    removeItems: (collectionId, itemPaths) => invoke('collections:remove-items', { collectionId, itemPaths })
  },
  export: {
    selectDir: () => invoke('export:select-dir'),
    selectFile: (p) => invoke('export:select-file', p || {}),
    files: (filePaths, targetDir) => invoke('export:files', { filePaths, targetDir }),
    json: (items, targetPath) => invoke('export:json', { items, targetPath }),
    csv: (items, targetPath) => invoke('export:csv', { items, targetPath })
  },
  converter: {
    presets: () => invoke('converter:presets'),
    list: () => invoke('converter:list'),
    start: (p) => invoke('converter:start', p),
    cancel: (taskId) => invoke('converter:cancel', { taskId }),
    clear: () => invoke('converter:clear')
  },
  remote: {
    nasTest: (basePath) => invoke('remote:nas-test', { basePath }),
    nasTransfer: (p) => invoke('remote:nas-transfer', p)
  },
  credentials: {
    status: () => invoke('credentials:status')
  },
  storage: {
    connections: {
      list: () => invoke('storage:connections:list'),
      get: (id) => invoke('storage:connections:get', { id }),
      save: (p) => invoke('storage:connections:save', p),
      delete: (id) => invoke('storage:connections:delete', { id }),
      test: (p) => invoke('storage:connections:test', p)
    },
    upload: {
      start: (p) => invoke('storage:upload:start', p),
      list: (p) => invoke('storage:upload:list', p || {}),
      cancel: (id) => invoke('storage:upload:cancel', { id }),
      clear: () => invoke('storage:upload:clear')
    }
  },
  backup: {
    schedules: {
      list: () => invoke('backup:schedule:list'),
      get: (id) => invoke('backup:schedule:get', { id }),
      save: (p) => invoke('backup:schedule:save', p),
      delete: (id) => invoke('backup:schedule:delete', { id }),
      toggle: (id, enabled) => invoke('backup:schedule:toggle', { id, enabled }),
      runNow: (id) => invoke('backup:schedule:run-now', { id })
    },
    runs: {
      list: (p) => invoke('backup:run:list', p || {}),
      get: (id) => invoke('backup:run:get', { id })
    }
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
  },
  app: {
    quit: () => invoke('app:quit')
  },
  updater: {
    status: () => invoke('updater:status'),
    check: (manual = true) => invoke('updater:check', { manual }),
    install: () => invoke('updater:install')
  },
  notifications: {
    test: (p) => invoke('notifications:test', p || {})
  }
};

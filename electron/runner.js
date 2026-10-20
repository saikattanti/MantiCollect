import fs from 'node:fs';
import { resolveProvider, directDownload, DIRECT, allProviders } from './providers/registry.js';
import { segmentedDownload } from './providers/segmented.js';
import { loadSettings } from './settings.js';
import { ffmpegDirectory, resolveYtDlp } from './bins.js';
import { assertPublicUrl } from './security.js';

/**
 * Execute one job. Returns {promise, cancel} synchronously.
 * The probe (metadata + format selection) already happened in the UI;
 * job.extra carries the chosen formatOption / playlistItems / expectedId.
 */
export function executeJob(job, hooks = {}) {
  const settings = loadSettings();
  const ctx = {
    ffmpegDir: ffmpegDirectory(settings),
    cookiesFile: settings.cookiesFile || null,
    allowLocal: !!(hooks.allowLocal ?? settings.allowLocalNetwork),
    probeTimeoutMs: settings.probeTimeoutMs,
    maxBytes: settings.maxFileSizeMB || 0
  };
  const destDir = job.dest_dir || settings.downloadDir;
  fs.mkdirSync(destDir, { recursive: true });

  let extra = {};
  try {
    extra = JSON.parse(job.extra || '{}');
  } catch {}

  let provider;
  try {
    if (job.provider === 'direct') {
      provider = DIRECT;
    } else if (job.provider) {
      provider = allProviders().find((p) => p.id === job.provider) || resolveProvider(job.url);
    } else {
      provider = resolveProvider(job.url);
    }
  } catch (err) {
    return { promise: Promise.reject(new Error(err.message)), cancel() {} };
  }
  if (!provider) {
    return { promise: Promise.reject(new Error('No provider can handle this URL')), cancel() {} };
  }

  // SSRF guard applies to direct fetches; yt-dlp fetches are also pre-validated.
  const guard = assertPublicUrl(job.url, { allowLocal: ctx.allowLocal });

  if (provider.isDirect) {
    const cancelController = new AbortController();
    const pauseController = new AbortController();
    const handle = {
      cancelled: false,
      paused: false,
      promise: null,
      cancel() {
        if (handle.cancelled) return;
        handle.cancelled = true;
        cancelController.abort();
      },
      pause() {
        if (handle.paused || handle.cancelled) return;
        handle.paused = true;
        pauseController.abort();
      }
    };

    handle.promise = guard
      .catch((err) => {
        if (handle.cancelled) {
          const cancelErr = new Error('Download cancelled');
          cancelErr.name = 'AbortError';
          throw cancelErr;
        }
        throw err;
      })
      .then(() => {
        if (handle.cancelled) {
          const err = new Error('Download cancelled');
          err.name = 'AbortError';
          throw err;
        }
        if (handle.paused) {
          return { paused: true, path: job.partial_path, bytes: job.bytes_done || 0 };
        }

        let existingPlan = null;
        try {
          if (job.segment_plan) existingPlan = JSON.parse(job.segment_plan);
        } catch {}

        const wantsSegmented =
          settings.segmentedDownloads !== false &&
          (job.is_segmented === 1 || existingPlan != null || (!job.bytes_done && job.is_segmented !== 0));
        const connections = Math.min(8, Math.max(1, Number(settings.maxConnectionsPerDownload) || 4));

        const directOpts = {
          allowLocal: ctx.allowLocal,
          maxBytes: ctx.maxBytes,
          overwrite: settings.overwrite,
          filename: extra.filename || undefined,
          signal: cancelController.signal,
          pauseSignal: pauseController.signal,
          isResume: job.status === 'resuming' || (job.bytes_done > 0 && !!job.partial_path),
          partialPath: job.partial_path || null,
          etag: job.etag || null,
          lastModified: job.last_modified || null,
          preservePartialOnError: true,
          onMetadata: hooks.onMetadata,
          onProgress: (p) => {
            if (!handle.cancelled && !handle.paused) hooks.onProgress?.(p);
          }
        };

        if (wantsSegmented && connections > 1) {
          return segmentedDownload(job.url, destDir, {
            ...directOpts,
            connections,
            plan: existingPlan
          }).then((res) => {
            if (res?.fallbackToSingle) {
              return directDownload(job.url, destDir, directOpts);
            }
            return res;
          });
        }

        return directDownload(job.url, destDir, directOpts);
      })
      .then((r) => r);

    return handle;
  }

  // yt-dlp-backed provider: the binary is resolved asynchronously, but the
  // handle itself must be returned synchronously so the queue can cancel it.
  let dlHandle = null;
  const handle = {
    cancelled: false,
    paused: false,
    promise: null,
    cancel() {
      if (handle.cancelled) return;
      handle.cancelled = true;
      if (dlHandle) dlHandle.cancel();
    },
    pause() {
      if (handle.paused || handle.cancelled) return;
      handle.paused = true;
      if (dlHandle) dlHandle.cancel();
    }
  };

  handle.promise = resolveYtDlp(settings)
    .then((bin) => {
      if (handle.cancelled) {
        const cancelErr = new Error('Download cancelled');
        cancelErr.name = 'AbortError';
        throw cancelErr;
      }
      if (!bin) {
        throw new Error('yt-dlp is not installed. Use Settings → Binaries → Install yt-dlp, or run: npm run setup-bins');
      }
      return guard.then(() => {
        if (handle.cancelled) {
          const cancelErr = new Error('Download cancelled');
          cancelErr.name = 'AbortError';
          throw cancelErr;
        }
        dlHandle = provider.startDownload(
          {
            url: job.url,
            destDir,
            formatOption: extra.formatOption || null,
            playlistItems: extra.playlistItems || null,
            expectedId: extra.expectedId || null,
            onProgress: (ev) => {
              if (!handle.cancelled && !handle.paused) hooks.onProgress?.(ev);
            }
          },
          { ...ctx, ytdlpBin: bin }
        );
        return dlHandle.promise;
      });
    })
    .catch((err) => {
      if (handle.cancelled || /cancel|abort/i.test(err?.message)) {
        const cancelErr = new Error('Download cancelled');
        cancelErr.name = 'AbortError';
        throw cancelErr;
      }
      throw err;
    });

  return handle;
}

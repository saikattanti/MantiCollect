import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ffprobeBinaryPath } from './bins.js';
import { getDb } from './db.js';
import { loadSettings } from './settings.js';
import { logger } from './logger.js';

/**
 * Technical Media Metadata Extraction Service using FFprobe with SQLite caching.
 *
 * Requirements:
 * - Asynchronous, non-blocking child process execution.
 * - 10-second bounded timeout to prevent hangs on corrupted files.
 * - Caches extracted metadata in SQLite to avoid repeatedly probing unchanged files.
 * - Preserves accuracy: unknown fields remain null; never fabricates values.
 */
export function createMetadataService({
  getDbInstance = getDb,
  getSettings = loadSettings
} = {}) {
  const db = () => getDbInstance();

  function getCachedMetadata(filePath) {
    if (!filePath || typeof filePath !== 'string') return null;
    try {
      const row = db().prepare('SELECT * FROM media_metadata WHERE file_path = ?').get(filePath);
      return row || null;
    } catch {
      return null;
    }
  }

  function saveMetadata(meta) {
    try {
      db()
        .prepare(
          `INSERT OR REPLACE INTO media_metadata (
             file_path, file_size, file_mtime, duration, width, height,
             video_codec, audio_codec, format_name, bitrate, channels,
             sample_rate, probed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          meta.file_path,
          meta.file_size,
          meta.file_mtime,
          meta.duration ?? null,
          meta.width ?? null,
          meta.height ?? null,
          meta.video_codec ?? null,
          meta.audio_codec ?? null,
          meta.format_name ?? null,
          meta.bitrate ?? null,
          meta.channels ?? null,
          meta.sample_rate ?? null,
          meta.probed_at
        );
    } catch (err) {
      logger.warn('metadata', `Failed to cache metadata for ${meta.file_path}: ${err.message}`);
    }
  }

  function probeWithFfprobe(bin, filePath, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const args = [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        '-show_error',
        filePath
      ];

      const child = spawn(bin, args, { windowsHide: true });
      let stdout = '';
      let timer = null;
      let settled = false;

      function finish(res) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(res);
      }

      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        finish({ ok: false, error: 'FFprobe timed out after 10s' });
      }, timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => (stdout += d));

      child.on('error', (err) => finish({ ok: false, error: err.message }));
      child.on('close', (code) => {
        if (code !== 0) {
          finish({ ok: false, error: `FFprobe exited with code ${code}` });
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          finish({ ok: true, data: parsed });
        } catch (err) {
          finish({ ok: false, error: `Invalid JSON from FFprobe: ${err.message}` });
        }
      });
    });
  }

  async function probeFile(filePath, { force = false } = {}) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Valid file path is required');
    }

    const resolved = path.resolve(filePath);
    let st;
    try {
      st = fs.statSync(resolved);
      if (!st.isFile()) throw new Error('Path is not a regular file');
    } catch (err) {
      return { file_path: resolved, error: `Cannot read file: ${err.message}` };
    }

    const mtimeMs = Math.round(st.mtimeMs);

    // Check disk cache first unless forced
    if (!force) {
      const cached = getCachedMetadata(resolved);
      if (cached && cached.file_size === st.size && Math.abs(cached.file_mtime - st.mtimeMs) < 1000) {
        return cached;
      }
    }

    const s = getSettings();
    const ffprobeBin = ffprobeBinaryPath(s);
    if (!ffprobeBin) {
      const fallback = {
        file_path: resolved,
        file_size: st.size,
        file_mtime: mtimeMs,
        duration: null,
        width: null,
        height: null,
        video_codec: null,
        audio_codec: null,
        format_name: null,
        bitrate: null,
        channels: null,
        sample_rate: null,
        probed_at: Date.now(),
        error: 'FFprobe executable not found'
      };
      saveMetadata(fallback);
      return fallback;
    }

    const probeRes = await probeWithFfprobe(ffprobeBin, resolved);
    if (!probeRes.ok || !probeRes.data) {
      const failed = {
        file_path: resolved,
        file_size: st.size,
        file_mtime: mtimeMs,
        duration: null,
        width: null,
        height: null,
        video_codec: null,
        audio_codec: null,
        format_name: null,
        bitrate: null,
        channels: null,
        sample_rate: null,
        probed_at: Date.now(),
        error: probeRes.error || 'Probe failed'
      };
      saveMetadata(failed);
      return failed;
    }

    const data = probeRes.data;
    const format = data.format || {};
    const streams = Array.isArray(data.streams) ? data.streams : [];

    // Parse video stream
    const videoStream = streams.find(
      (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1
    );

    // Parse audio stream
    const audioStream = streams.find((s) => s.codec_type === 'audio');

    let duration = null;
    if (format.duration && !Number.isNaN(Number(format.duration))) {
      duration = Math.round(Number(format.duration) * 10) / 10;
    } else if (videoStream?.duration && !Number.isNaN(Number(videoStream.duration))) {
      duration = Math.round(Number(videoStream.duration) * 10) / 10;
    } else if (audioStream?.duration && !Number.isNaN(Number(audioStream.duration))) {
      duration = Math.round(Number(audioStream.duration) * 10) / 10;
    }

    const width = videoStream?.width ? parseInt(videoStream.width, 10) : null;
    const height = videoStream?.height ? parseInt(videoStream.height, 10) : null;
    const videoCodec = videoStream?.codec_name || null;
    const audioCodec = audioStream?.codec_name || null;
    const formatName = format.format_name ? format.format_name.split(',')[0].trim() : null;
    const bitrate = format.bit_rate ? parseInt(format.bit_rate, 10) : null;
    const channels = audioStream?.channels ? parseInt(audioStream.channels, 10) : null;
    const sampleRate = audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : null;

    const meta = {
      file_path: resolved,
      file_size: st.size,
      file_mtime: mtimeMs,
      duration,
      width,
      height,
      video_codec: videoCodec,
      audio_codec: audioCodec,
      format_name: formatName,
      bitrate,
      channels,
      sample_rate: sampleRate,
      probed_at: Date.now()
    };

    saveMetadata(meta);
    logger.info('metadata', `Extracted metadata for ${path.basename(resolved)}: duration=${duration}s, res=${width}x${height}, vcodec=${videoCodec}, acodec=${audioCodec}`);
    return meta;
  }

  async function batchProbe(filePaths, { concurrency = 2, force = false } = {}) {
    if (!Array.isArray(filePaths)) return [];
    const results = [];
    const queue = [...filePaths];

    async function worker() {
      while (queue.length > 0) {
        const p = queue.shift();
        try {
          const res = await probeFile(p, { force });
          results.push(res);
        } catch (err) {
          results.push({ file_path: p, error: err.message });
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  return {
    probeFile,
    batchProbe,
    getCachedMetadata
  };
}

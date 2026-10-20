import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ffmpegBinaryPath } from './bins.js';
import { getDb } from './db.js';
import { loadSettings } from './settings.js';
import { uniqueDestPath } from './export.js';
import { logger } from './logger.js';

/**
 * Strict allowlist of safe FFmpeg conversion presets.
 * No arbitrary flags from the renderer are permitted.
 */
export const CONVERSION_PRESETS = {
  mp4_universal: {
    id: 'mp4_universal',
    label: 'MP4 Universal (H.264 / AAC)',
    category: 'video',
    targetExt: '.mp4',
    description: 'High compatibility for TV, web, mobile, and Windows Media Player.',
    args: ['-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']
  },
  mp4_small: {
    id: 'mp4_small',
    label: 'MP4 Small File (H.264 Compressed)',
    category: 'video',
    targetExt: '.mp4',
    description: 'Compact file size (CRF 28) optimized for messaging or archiving.',
    args: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart']
  },
  webm_vp9: {
    id: 'webm_vp9',
    label: 'WebM (VP9 / Opus)',
    category: 'video',
    targetExt: '.webm',
    description: 'Open standard format optimized for modern web browsers.',
    args: ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k']
  },
  extract_audio_mp3: {
    id: 'extract_audio_mp3',
    label: 'Extract Audio to MP3',
    category: 'video_to_audio',
    targetExt: '.mp3',
    description: 'Extract audio track from video to standard MP3 (VBR Q2).',
    args: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2']
  },
  extract_audio_aac: {
    id: 'extract_audio_aac',
    label: 'Extract Audio to M4A (AAC)',
    category: 'video_to_audio',
    targetExt: '.m4a',
    description: 'Extract audio track to high-fidelity AAC (256 kbps).',
    args: ['-vn', '-c:a', 'aac', '-b:a', '256k']
  },
  audio_mp3: {
    id: 'audio_mp3',
    label: 'Convert to MP3',
    category: 'audio',
    targetExt: '.mp3',
    description: 'High quality variable bitrate MP3 for any audio player.',
    args: ['-c:a', 'libmp3lame', '-q:a', '2']
  },
  audio_aac: {
    id: 'audio_aac',
    label: 'Convert to M4A / AAC',
    category: 'audio',
    targetExt: '.m4a',
    description: 'AAC audio format at 256 kbps.',
    args: ['-c:a', 'aac', '-b:a', '256k']
  },
  audio_wav: {
    id: 'audio_wav',
    label: 'Convert to WAV (PCM)',
    category: 'audio',
    targetExt: '.wav',
    description: 'Lossless uncompressed 16-bit audio for editing.',
    args: ['-c:a', 'pcm_s16le']
  }
};

/**
 * Parses FFmpeg time string "HH:MM:SS.ms" or microseconds into seconds.
 */
export function parseFfTime(str) {
  if (!str) return 0;
  if (/^\d+(\.\d+)?$/.test(str)) {
    // If integer microseconds
    const num = parseFloat(str);
    return num > 1000000 ? num / 1000000 : num;
  }
  const parts = str.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const mins = parseFloat(parts[1]) || 0;
    const secs = parseFloat(parts[2]) || 0;
    return hours * 3600 + mins * 60 + secs;
  }
  return 0;
}

/**
 * Media Conversion Manager backed by SQLite.
 */
export function createConversionService({
  getDbInstance = getDb,
  getSettings = loadSettings,
  getWindow = () => null
} = {}) {
  const db = () => getDbInstance();
  const activeProcesses = new Map(); // id -> childProcess

  function sendToWindow(channel, data) {
    const win = getWindow?.();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send(channel, data);
      } catch {}
    }
  }

  function listConversions() {
    return db().prepare('SELECT * FROM conversions ORDER BY created_at DESC LIMIT 100').all();
  }

  function getConversion(id) {
    return db().prepare('SELECT * FROM conversions WHERE id = ?').get(id) || null;
  }

  function persist(id, fields) {
    const sets = Object.keys(fields).map((k) => `${k} = ?`);
    if (!sets.length) return;
    try {
      db()
        .prepare(`UPDATE conversions SET ${sets.join(', ')} WHERE id = ?`)
        .run(...Object.values(fields), id);
    } catch {}
  }

  async function startConversion({ sourcePath, presetId, destDir = null, durationSeconds = null }) {
    if (!sourcePath || typeof sourcePath !== 'string') {
      throw new Error('Source file path is required');
    }

    const resolvedSource = path.resolve(sourcePath);
    if (!fs.existsSync(resolvedSource)) {
      throw new Error('Source file does not exist on disk');
    }

    const preset = CONVERSION_PRESETS[presetId];
    if (!preset) {
      throw new Error(`Invalid conversion preset: ${presetId}`);
    }

    const targetDir = destDir ? path.resolve(destDir) : path.dirname(resolvedSource);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const baseName = path.basename(resolvedSource, path.extname(resolvedSource));
    let desiredName = `${baseName}${preset.targetExt}`;
    // If converting in the same directory and extension matches, avoid collision with source
    if (targetDir === path.dirname(resolvedSource) && desiredName === path.basename(resolvedSource)) {
      desiredName = `${baseName}-converted${preset.targetExt}`;
    }

    const finalDestPath = uniqueDestPath(targetDir, desiredName);

    // Prevent overwriting source file
    if (finalDestPath.toLowerCase() === resolvedSource.toLowerCase()) {
      throw new Error('Target destination matches source file path');
    }

    const id = randomUUID();
    const now = Date.now();

    db()
      .prepare(
        `INSERT INTO conversions (id, source_path, dest_path, preset_id, status, progress, created_at)
         VALUES (?, ?, ?, ?, 'waiting', 0, ?)`
      )
      .run(id, resolvedSource, finalDestPath, presetId, now);

    logger.info('converter', `Created conversion job ${id} (${presetId}) for ${path.basename(resolvedSource)}`);
    sendToWindow('conversion:updated', listConversions());

    // Run asynchronously
    executeConversion(id, { sourcePath: resolvedSource, destPath: finalDestPath, preset, durationSeconds });

    return { id, sourcePath: resolvedSource, destPath: finalDestPath, presetId, status: 'waiting' };
  }

  function executeConversion(id, { sourcePath, destPath, preset, durationSeconds }) {
    const s = getSettings();
    const ffmpegBin = ffmpegBinaryPath(s);

    if (!ffmpegBin) {
      persist(id, { status: 'failed', error: 'FFmpeg binary not found on system', finished_at: Date.now() });
      sendToWindow('conversion:updated', listConversions());
      return;
    }

    const tempDest = `${destPath}.converting-${id}.tmp`;
    persist(id, { status: 'converting' });
    sendToWindow('conversion:updated', listConversions());

    // Arguments: input file, preset parameters, output temp file
    // -y allows overwriting temp file if left from prior attempt
    const args = ['-y', '-i', sourcePath, ...preset.args, tempDest];

    const child = spawn(ffmpegBin, args, { windowsHide: true });
    activeProcesses.set(id, child);

    let stderr = '';
    let settled = false;

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (data) => {
      stderr += data;
      // Parse time=HH:MM:SS.ms to update progress
      const match = data.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/);
      if (match && durationSeconds && durationSeconds > 0) {
        const currentSecs = parseFfTime(match[1]);
        const pct = Math.min(99, Math.max(0, Math.round((currentSecs / durationSeconds) * 1000) / 10));
        persist(id, { progress: pct });
        sendToWindow('conversion:progress', { id, progress: pct, currentSecs, totalSecs: durationSeconds });
      }
    });

    function cleanupTemp() {
      try {
        if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
      } catch {}
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      activeProcesses.delete(id);
      cleanupTemp();
      persist(id, { status: 'failed', error: err.message, finished_at: Date.now() });
      sendToWindow('conversion:updated', listConversions());
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      activeProcesses.delete(id);

      const job = getConversion(id);
      if (job?.status === 'cancelled') {
        cleanupTemp();
        sendToWindow('conversion:updated', listConversions());
        return;
      }

      if (code === 0 && fs.existsSync(tempDest)) {
        try {
          fs.renameSync(tempDest, destPath);
          persist(id, { status: 'completed', progress: 100, finished_at: Date.now() });
          logger.info('converter', `Conversion completed: ${path.basename(destPath)}`);
        } catch (err) {
          cleanupTemp();
          persist(id, { status: 'failed', error: `Rename failed: ${err.message}`, finished_at: Date.now() });
        }
      } else {
        cleanupTemp();
        persist(id, {
          status: 'failed',
          error: `FFmpeg exited with code ${code}. ${stderr.slice(-200)}`,
          finished_at: Date.now()
        });
      }

      sendToWindow('conversion:updated', listConversions());
    });
  }

  function cancelConversion(id) {
    const job = getConversion(id);
    if (!job) return false;

    persist(id, { status: 'cancelled', finished_at: Date.now() });

    const child = activeProcesses.get(id);
    if (child) {
      try {
        child.kill('SIGTERM');
      } catch {}
      activeProcesses.delete(id);
    }

    sendToWindow('conversion:updated', listConversions());
    return true;
  }

  function clearCompletedConversions() {
    db().prepare("DELETE FROM conversions WHERE status IN ('completed', 'failed', 'cancelled')").run();
    sendToWindow('conversion:updated', listConversions());
    return true;
  }

  function recover() {
    try {
      const interrupted = db().prepare("SELECT * FROM conversions WHERE status IN ('converting', 'waiting')").all();
      for (const job of interrupted) {
        persist(job.id, {
          status: 'failed',
          error: 'Interrupted by application restart',
          finished_at: Date.now()
        });
        const tempDest = `${job.dest_path}.converting-${job.id}.tmp`;
        if (fs.existsSync(tempDest)) {
          try { fs.unlinkSync(tempDest); } catch {}
        }
      }
    } catch {}
  }

  // Recover any interrupted conversions on startup
  recover();

  return {
    listConversions,
    getConversion,
    startConversion,
    cancelConversion,
    clearCompletedConversions,
    recover,
    getPresets: () => CONVERSION_PRESETS
  };
}

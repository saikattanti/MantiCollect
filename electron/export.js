import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { sanitizeFilename } from './security.js';
import { logger } from './logger.js';

/**
 * Disambiguates destination filename if a file with the same name already exists.
 * E.g., "video.mp4" -> "video (1).mp4"
 */
export function uniqueDestPath(targetDir, originalName) {
  const safeName = sanitizeFilename(originalName);
  const ext = path.extname(safeName);
  const base = path.basename(safeName, ext);

  let candidate = path.join(targetDir, safeName);
  let counter = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(targetDir, `${base} (${counter})${ext}`);
    counter++;
  }

  return candidate;
}

/**
 * Copies multiple files to a target directory with progress, duplicate disambiguation,
 * and detailed error reporting.
 */
export async function exportFilesToDirectory({
  filePaths,
  targetDir,
  onProgress = () => {},
  abortSignal = null
}) {
  if (!targetDir || typeof targetDir !== 'string') {
    throw new Error('Target directory is required');
  }

  const resolvedDir = path.resolve(targetDir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error('Target directory does not exist');
  }

  const st = fs.statSync(resolvedDir);
  if (!st.isDirectory()) {
    throw new Error('Target path is not a directory');
  }

  const safePaths = Array.isArray(filePaths) ? filePaths.filter((p) => typeof p === 'string' && p.trim()) : [];
  if (!safePaths.length) {
    return { total: 0, exported: 0, failed: 0, destDir: resolvedDir, errors: [] };
  }

  let exported = 0;
  let failed = 0;
  const errors = [];
  const total = safePaths.length;

  for (let i = 0; i < safePaths.length; i++) {
    if (abortSignal?.aborted) {
      throw new Error('Export cancelled by user');
    }

    const src = path.resolve(safePaths[i]);
    const filename = path.basename(src);

    onProgress({
      current: i + 1,
      total,
      filename,
      phase: 'copying'
    });

    try {
      if (!fs.existsSync(src)) {
        throw new Error('Source file does not exist on disk');
      }

      const dest = uniqueDestPath(resolvedDir, filename);

      // Stream copy to prevent loading entire file into memory
      const readStream = fs.createReadStream(src);
      const writeStream = fs.createWriteStream(dest);

      const pipeOpts = abortSignal ? { signal: abortSignal } : {};
      await pipeline(readStream, writeStream, pipeOpts);
      exported++;
    } catch (err) {
      if (abortSignal?.aborted) throw err;
      failed++;
      errors.push({ path: src, error: err.message });
      logger.warn('export', `Failed to export ${filename}: ${err.message}`);
    }
  }

  onProgress({
    current: total,
    total,
    filename: '',
    phase: 'done'
  });

  return {
    total,
    exported,
    failed,
    destDir: resolvedDir,
    errors
  };
}

/**
 * Formats a list of library items into a structured JSON export.
 */
export function formatMetadataAsJson(items) {
  const payload = {
    generator: 'MantiCollect - A Mantitup Product',
    application: 'MantiCollect',
    brand: 'Mantitup',
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    totalItems: items.length,
    items: items.map((item) => ({
      name: item.name,
      title: item.title,
      category: item.kind,
      provider: item.provider,
      sourceUrl: item.sourceUrl || null,
      sizeBytes: item.size || null,
      downloadDate: item.downloadDate ? new Date(item.downloadDate).toISOString() : null,
      collections: Array.isArray(item.collections) ? item.collections.map((c) => c.name) : [],
      filePath: item.path,
      technicalMetadata: {
        durationSeconds: item.metadata?.duration ?? null,
        width: item.metadata?.width ?? null,
        height: item.metadata?.height ?? null,
        resolution: item.metadata?.resolution ?? null,
        videoCodec: item.metadata?.videoCodec ?? null,
        audioCodec: item.metadata?.audioCodec ?? null,
        bitrate: item.metadata?.bitrate ?? null,
        formatName: item.metadata?.formatName ?? null
      },
      metadata: {
        duration: item.metadata?.duration ?? null,
        width: item.metadata?.width ?? null,
        height: item.metadata?.height ?? null,
        resolution: item.metadata?.resolution ?? null,
        videoCodec: item.metadata?.videoCodec ?? null,
        audioCodec: item.metadata?.audioCodec ?? null,
        bitrate: item.metadata?.bitrate ?? null,
        formatName: item.metadata?.formatName ?? null
      }
    }))
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * RFC 4180 CSV cell escaper.
 */
function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats a list of library items into RFC 4180 CSV with UTF-8 BOM.
 */
export function formatMetadataAsCsv(items) {
  const headers = [
    'Name',
    'Title',
    'Category',
    'Provider',
    'Size (Bytes)',
    'Duration (Seconds)',
    'Resolution',
    'Video Codec',
    'Audio Codec',
    'Source URL',
    'Download Date',
    'Collections',
    'File Path'
  ];

  const rows = [headers.map(escapeCsvCell).join(',')];

  for (const item of items) {
    const colNames = Array.isArray(item.collections) ? item.collections.map((c) => c.name).join('; ') : '';
    const dateStr = item.downloadDate ? new Date(item.downloadDate).toISOString() : '';

    const cols = [
      item.name,
      item.title,
      item.kind,
      item.provider,
      item.size ?? '',
      item.metadata?.duration ?? '',
      item.metadata?.resolution ?? '',
      item.metadata?.videoCodec ?? '',
      item.metadata?.audioCodec ?? '',
      item.sourceUrl ?? '',
      dateStr,
      colNames,
      item.path
    ];

    rows.push(cols.map(escapeCsvCell).join(','));
  }

  // Prepend UTF-8 BOM so Excel opens special characters correctly
  return '\uFEFF' + rows.join('\r\n');
}

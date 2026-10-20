import fs from 'node:fs';
import path from 'node:path';
import { fetchWithSafeRedirects, extensionKind, sanitizeFilename, uniquePath } from '../security.js';
import { planSegments, segmentFilePath, inspectSegments, cleanupSegmentFiles, DEFAULT_SEGMENTS, MIN_SEGMENT_SIZE } from './segmentPlanner.js';

const MAX_WORKER_RETRIES = 3;

/**
 * Probes the target URL with a safe Range probe (bytes=0-0) to verify:
 * 1. Whether the server actually supports HTTP 206 Partial Content.
 * 2. The exact total resource size from Content-Range.
 * 3. Validator headers (ETag, Last-Modified) and Content-Type.
 *
 * @returns {Promise<{
 *   eligible: boolean,
 *   total?: number,
 *   contentType?: string,
 *   etag?: string|null,
 *   lastModified?: string|null,
 *   reason?: string
 * }>}
 */
export async function probeSegmentEligibility(url, { allowLocal = false, signal, minSegmentSize = MIN_SEGMENT_SIZE } = {}) {
  try {
    const res = await fetchWithSafeRedirects(url, {
      headers: { Range: 'bytes=0-0' },
      allowLocal,
      signal
    });

    const contentType = res.headers.get('content-type') || '';
    const etag = res.headers.get('etag') || null;
    const lastModified = res.headers.get('last-modified') || null;

    // Server must respond with HTTP 206 Partial Content
    if (res.status === 200) {
      if (res.body) await res.body.cancel().catch(() => {});
      return { eligible: false, reason: 'Server returned HTTP 200 (Range header ignored)' };
    }

    if (res.status !== 206) {
      if (res.body) await res.body.cancel().catch(() => {});
      return { eligible: false, reason: `Server returned HTTP ${res.status} on Range probe` };
    }

    const cr = res.headers.get('content-range');
    if (res.body) await res.body.cancel().catch(() => {});

    if (!cr) {
      return { eligible: false, reason: 'Server returned HTTP 206 without Content-Range header' };
    }

    // Expected format: bytes 0-0/total
    const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(cr);
    if (!match || match[3] === '*') {
      return { eligible: false, reason: 'Server returned indeterminate total size in Content-Range' };
    }

    const start = Number(match[1]);
    const total = Number(match[3]);

    if (start !== 0 || !Number.isInteger(total) || total <= 0) {
      return { eligible: false, reason: 'Inconsistent Content-Range start or total' };
    }

    if (total < minSegmentSize * 2) {
      return { eligible: false, total, reason: 'Resource size is below multi-segment threshold' };
    }

    return {
      eligible: true,
      total,
      contentType,
      etag,
      lastModified
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return { eligible: false, reason: `Probe failed: ${err.message}` };
  }
}

/**
 * Downloads a single segment range into its assigned segment file.
 * Automatically resumes from existing bytes on disk if any.
 */
async function downloadSegmentWorker({
  url,
  segment,
  segPath,
  allowLocal,
  signal,
  pauseSignal,
  etag,
  lastModified,
  onChunk
}) {
  let attempts = 0;

  while (attempts <= MAX_WORKER_RETRIES) {
    if (signal?.aborted) {
      const err = new Error('Download cancelled');
      err.name = 'AbortError';
      throw err;
    }
    if (pauseSignal?.aborted) return;

    // Check existing disk progress
    let downloaded = 0;
    if (fs.existsSync(segPath)) {
      try {
        downloaded = fs.statSync(segPath).size;
        if (downloaded > segment.total) {
          fs.writeFileSync(segPath, Buffer.alloc(0));
          downloaded = 0;
        }
      } catch {
        downloaded = 0;
      }
    }

    if (downloaded >= segment.total) {
      return; // Already completed
    }

    const reqStart = segment.start + downloaded;
    const reqEnd = segment.end;
    const reqHeaders = {
      Range: `bytes=${reqStart}-${reqEnd}`
    };

    const isWeakEtag = typeof etag === 'string' && /^W\//i.test(etag.trim());
    if (etag && !isWeakEtag) {
      reqHeaders['If-Range'] = etag.trim();
    } else if (lastModified) {
      reqHeaders['If-Range'] = lastModified.trim();
    }

    let out = null;
    let reader = null;
    let streamErr = null;

    try {
      const res = await fetchWithSafeRedirects(url, {
        headers: reqHeaders,
        allowLocal,
        signal
      });

      if (res.status === 429) {
        if (res.body) await res.body.cancel().catch(() => {});
        const retryAfter = Number(res.headers.get('retry-after')) || 1;
        const waitMs = Math.min(10000, Math.max(500, retryAfter * 1000));
        await new Promise((r) => setTimeout(r, waitMs));
        attempts++;
        continue;
      }

      if (res.status !== 206) {
        if (res.body) await res.body.cancel().catch(() => {});
        throw new Error(`Worker for segment ${segment.index} expected HTTP 206, got HTTP ${res.status}`);
      }

      // Validate Content-Range
      const cr = res.headers.get('content-range');
      const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(cr || '');
      if (!match) {
        if (res.body) await res.body.cancel().catch(() => {});
        throw new Error(`Worker for segment ${segment.index} received invalid Content-Range: ${cr}`);
      }

      const respStart = Number(match[1]);
      if (respStart !== reqStart) {
        if (res.body) await res.body.cancel().catch(() => {});
        throw new Error(`Worker for segment ${segment.index} offset mismatch: expected ${reqStart}, got ${respStart}`);
      }

      // Check validator consistency
      const respEtag = res.headers.get('etag');
      if (etag && respEtag && !/^W\//i.test(etag) && !/^W\//i.test(respEtag) && etag.trim() !== respEtag.trim()) {
        if (res.body) await res.body.cancel().catch(() => {});
        const valErr = new Error('Remote resource ETag changed during download');
        valErr.code = 'ETAG_CHANGED';
        throw valErr;
      }

      if (!res.body) {
        return;
      }

      out = fs.createWriteStream(segPath, { flags: downloaded > 0 ? 'a' : 'w' });
      out.on('error', (err) => {
        streamErr = err;
      });

      reader = res.body.getReader();

      const onPauseAbort = () => {
        try { reader?.cancel().catch(() => {}); } catch {}
      };
      const onCancelAbort = () => {
        try { reader?.cancel().catch(() => {}); } catch {}
      };

      if (pauseSignal) pauseSignal.addEventListener('abort', onPauseAbort, { once: true });
      if (signal) signal.addEventListener('abort', onCancelAbort, { once: true });

      try {
        for (;;) {
          if (signal?.aborted) {
            const err = new Error('Download cancelled');
            err.name = 'AbortError';
            throw err;
          }
          if (pauseSignal?.aborted) break;
          if (streamErr) throw streamErr;

          const { done, value } = await reader.read();
          if (done) break;
          if (signal?.aborted) {
            const err = new Error('Download cancelled');
            err.name = 'AbortError';
            throw err;
          }
          if (pauseSignal?.aborted) break;
          if (streamErr) throw streamErr;

          const chunkLen = value.byteLength;
          if (!out.write(Buffer.from(value))) {
            await new Promise((r) => out.once('drain', r));
          }

          downloaded += chunkLen;
          onChunk?.(chunkLen);
        }
      } finally {
        if (pauseSignal) pauseSignal.removeEventListener('abort', onPauseAbort);
        if (signal) signal.removeEventListener('abort', onCancelAbort);
      }

      if (streamErr) throw streamErr;

      await new Promise((resolve, reject) => {
        out.once('finish', resolve);
        out.once('error', reject);
        out.end();
      });

      if (pauseSignal?.aborted || signal?.aborted) return;

      // Check segment completeness
      const finalSegSize = fs.existsSync(segPath) ? fs.statSync(segPath).size : 0;
      if (finalSegSize >= segment.total) {
        return; // Success
      }

      // If under-delivered without pause, retry remaining bytes
      attempts++;
    } catch (err) {
      if (out) {
        try {
          await new Promise((resolve) => {
            if (out.destroyed || out.closed) return resolve();
            out.once('close', resolve);
            out.destroy();
          });
        } catch {}
      }
      if (reader) {
        try {
          await reader.cancel();
        } catch {}
      }

      if (signal?.aborted || pauseSignal?.aborted) return;
      if (err?.code === 'ETAG_CHANGED') throw err;

      attempts++;
      if (attempts > MAX_WORKER_RETRIES) {
        throw new Error(`Worker for segment ${segment.index} failed after ${MAX_WORKER_RETRIES} retries: ${err.message}`);
      }

      const backoff = Math.min(2000, 200 * Math.pow(2, attempts) + Math.floor(Math.random() * 100));
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

/**
 * Sequentially merges completed segment files into the final .part file with streaming backpressure.
 */
async function assembleSegmentFiles(tmpPath, finalPath, plan, expectedTotal) {
  // Step 1: Verify all segment files exist and have exact byte sizes
  for (const seg of plan) {
    const sPath = segmentFilePath(tmpPath, seg.index);
    if (!fs.existsSync(sPath)) {
      throw new Error(`Assembly failed: segment ${seg.index} is missing on disk`);
    }
    const stat = fs.statSync(sPath);
    if (stat.size !== seg.total) {
      throw new Error(`Assembly failed: segment ${seg.index} size ${stat.size} does not match expected ${seg.total}`);
    }
  }

  // Step 2: Stream merge segments into tmpPath
  const out = fs.createWriteStream(tmpPath, { flags: 'w' });
  let assembledBytes = 0;

  for (const seg of plan) {
    const sPath = segmentFilePath(tmpPath, seg.index);
    await new Promise((resolve, reject) => {
      const inStream = fs.createReadStream(sPath, { highWaterMark: 64 * 1024 });
      inStream.on('data', (chunk) => {
        assembledBytes += chunk.length;
        if (!out.write(chunk)) {
          inStream.pause();
          out.once('drain', () => inStream.resume());
        }
      });
      inStream.on('end', resolve);
      inStream.on('error', reject);
    });
  }

  await new Promise((resolve, reject) => {
    out.once('finish', resolve);
    out.once('error', reject);
    out.end();
  });

  // Step 3: Validate assembled file size
  if (expectedTotal > 0 && assembledBytes !== expectedTotal) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw new Error(`Assembly integrity failed: assembled ${assembledBytes} bytes, expected ${expectedTotal}`);
  }

  // Step 4: Clean up segment files now that tmpPath is fully verified
  cleanupSegmentFiles(tmpPath, plan.length);

  // Step 5: Atomically move tmpPath to finalPath
  fs.renameSync(tmpPath, finalPath);
}

/**
 * Main coordinator for segmented multi-connection downloads.
 * Returns { path, bytes, contentType, isSegmented: true } or { fallbackToSingle: true, reason }.
 */
export async function segmentedDownload(url, destDir, {
  onProgress,
  onMetadata,
  allowLocal = false,
  maxBytes = 0,
  signal,
  pauseSignal,
  isResume = false,
  partialPath = null,
  etag = null,
  lastModified = null,
  connections = DEFAULT_SEGMENTS,
  overwrite = 'avoid',
  filename = null,
  plan: existingPlan = null,
  minSegmentSize = MIN_SEGMENT_SIZE
} = {}) {
  if (signal?.aborted) {
    const err = new Error('Download cancelled');
    err.name = 'AbortError';
    throw err;
  }
  if (pauseSignal?.aborted) {
    return { paused: true, path: partialPath, bytes: 0, resumable: true, isSegmented: true };
  }

  // Step 1: Probe eligibility if not already established with a valid plan
  let total = 0;
  let currentEtag = etag;
  let currentLastModified = lastModified;
  let contentType = 'application/octet-stream';

  if (!isResume || !existingPlan) {
    const probe = await probeSegmentEligibility(url, { allowLocal, signal, minSegmentSize });
    if (!probe.eligible) {
      return { fallbackToSingle: true, reason: probe.reason || 'Server ineligible for segmentation' };
    }
    total = probe.total;
    contentType = probe.contentType || contentType;
    currentEtag = probe.etag || currentEtag;
    currentLastModified = probe.lastModified || currentLastModified;
  } else {
    // When resuming, retrieve total from plan
    total = existingPlan.reduce((acc, s) => acc + s.total, 0);
  }

  if (maxBytes > 0 && total > maxBytes * 1024 * 1024) {
    throw new Error(`File size ${(total / 1024 / 1024).toFixed(1)} MB exceeds the configured limit`);
  }

  // Step 2: Establish file paths
  const detected = extensionKind(url);
  let finalPath = null;
  let tmpPath = null;

  if (partialPath) {
    tmpPath = partialPath;
    const baseName = path.basename(tmpPath).replace(/^\./, '').replace(/\.part$/, '');
    finalPath = path.join(destDir, baseName);
  } else {
    let name = filename;
    if (!name) {
      try {
        const u = new URL(url);
        name = u.pathname.split('/').filter(Boolean).pop();
      } catch {}
    }
    name = sanitizeFilename(name || 'download');
    finalPath = overwrite === 'overwrite' ? path.join(destDir, name) : uniquePath(destDir, name);
    tmpPath = path.join(destDir, `.${path.basename(finalPath)}.part`);
  }

  // Step 3: Plan segments
  const plan = existingPlan || planSegments(total, connections, minSegmentSize);
  if (!plan || plan.length <= 1) {
    return { fallbackToSingle: true, reason: 'Segmentation planner returned single segment' };
  }

  onMetadata?.({
    etag: currentEtag,
    lastModified: currentLastModified,
    resumable: true,
    total,
    partialPath: tmpPath,
    isSegmented: true,
    segmentsCount: plan.length,
    plan
  });

  // Step 4: Check existing disk state
  const inspected = inspectSegments(tmpPath, plan);
  let verifiedDownloaded = inspected.reduce((acc, s) => acc + s.downloaded, 0);
  let lastTick = Date.now();
  let lastBytes = verifiedDownloaded;
  let aggregateSpeed = 0;

  // Active workers count tracker
  let activeWorkers = 0;

  const onChunk = (chunkLen) => {
    verifiedDownloaded += chunkLen;
    const now = Date.now();
    if (now - lastTick >= 400) {
      aggregateSpeed = ((verifiedDownloaded - lastBytes) / (now - lastTick)) * 1000;
      lastTick = now;
      lastBytes = verifiedDownloaded;
    }

    if (!signal?.aborted && !pauseSignal?.aborted) {
      const segsDone = inspectSegments(tmpPath, plan).filter((s) => s.done).length;
      onProgress?.({
        received: verifiedDownloaded,
        total,
        speed: aggregateSpeed,
        pct: total > 0 ? verifiedDownloaded / total : 0,
        activeConnections: activeWorkers,
        segmentsDone: segsDone,
        segmentsCount: plan.length,
        kind: detected ? detected.kind : 'file',
        isSegmented: true
      });
    }
  };

  // Step 5: Launch concurrent workers for incomplete segments
  const incompleteSegments = inspected.filter((s) => !s.done);
  activeWorkers = incompleteSegments.length;

  const workerPromises = incompleteSegments.map((seg) => {
    return downloadSegmentWorker({
      url,
      segment: seg,
      segPath: seg.path,
      allowLocal,
      signal,
      pauseSignal,
      etag: currentEtag,
      lastModified: currentLastModified,
      onChunk
    }).finally(() => {
      activeWorkers = Math.max(0, activeWorkers - 1);
    });
  });

  try {
    await Promise.all(workerPromises);
  } catch (err) {
    if (signal?.aborted || /abort|cancel/i.test(err?.message)) {
      cleanupSegmentFiles(tmpPath, plan.length);
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
      const cancelErr = new Error('Download cancelled');
      cancelErr.name = 'AbortError';
      throw cancelErr;
    }
    throw err;
  }

  // Handle Pause
  if (pauseSignal?.aborted) {
    const afterPause = inspectSegments(tmpPath, plan);
    const finalBytes = afterPause.reduce((acc, s) => acc + s.downloaded, 0);
    return {
      paused: true,
      path: tmpPath,
      bytes: finalBytes,
      etag: currentEtag,
      lastModified: currentLastModified,
      resumable: true,
      isSegmented: true,
      plan
    };
  }

  // Handle Cancel
  if (signal?.aborted) {
    cleanupSegmentFiles(tmpPath, plan.length);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    const cancelErr = new Error('Download cancelled');
    cancelErr.name = 'AbortError';
    throw cancelErr;
  }

  // Step 6: Assemble completed segments into final file
  await assembleSegmentFiles(tmpPath, finalPath, plan, total);

  onProgress?.({
    received: total,
    total,
    speed: 0,
    pct: 1,
    done: true,
    activeConnections: 0,
    segmentsDone: plan.length,
    segmentsCount: plan.length,
    kind: detected ? detected.kind : 'file',
    isSegmented: true
  });

  return {
    path: finalPath,
    bytes: total,
    contentType,
    isSegmented: true
  };
}

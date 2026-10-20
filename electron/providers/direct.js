import fs from 'node:fs';
import path from 'node:path';
import { extensionKind, sanitizeFilename, uniquePath, fetchWithSafeRedirects } from '../security.js';

const EXT_MIME = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp',
  pdf: 'application/pdf', zip: 'application/zip'
};

function guessName(url, contentType) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last && last.includes('.')) return decodeURIComponent(last);
  } catch {}
  const ext = contentType ? contentType.split(';')[0] : '';
  const match = Object.entries(EXT_MIME).find(([, m]) => m === ext);
  return match ? `download.${match[0]}` : 'download';
}

/**
 * Direct-file provider: URLs that point at a media file itself (by
 * extension). Downloads stream to a temp file and are moved into place;
 * every redirect hop is re-validated against private-network rules.
 */
export const DIRECT = {
  id: 'direct',
  name: 'Direct file',
  host: 'any host, file URL',
  isDirect: true,

  canHandleUrl(url) {
    return extensionKind(url) !== null;
  },

  getCapabilities() {
    return {
      id: this.id,
      name: this.name,
      host: this.host,
      capabilities: {
        metadata: 'supported',
        video: 'supported',
        audio: 'supported',
        images: 'supported',
        collections: 'unsupported',
        account_export: 'unsupported'
      },
      requires: ['node built-in fetch'],
      auth: { needs: 'none — file must be publicly reachable' },
      notes: ['Works with any direct link whose extension maps to a known media type.', 'Redirects are re-validated; loops to private networks are blocked.'],
      testStatus: 'tested'
    };
  },

  async getMetadata(url, ctx = {}) {
    let res;
    try {
      res = await fetchWithSafeRedirects(url, { allowLocal: !!ctx.allowLocal, signal: AbortSignal.timeout(15000) });
      res.body && (await res.body.cancel());
    } catch (err) {
      throw new Error(`HEAD check failed: ${err.message}`);
    }
    const contentType = res.headers.get('content-type') || '';
    const contentLength = Number(res.headers.get('content-length')) || 0;
    const detected = extensionKind(url);
    return {
      type: 'item',
      provider: this.id,
      kind: detected ? detected.kind : contentType.split('/')[0] || 'file',
      title: guessName(url, contentType),
      contentType,
      contentLength,
      webpageUrl: url
    };
  },

  download: directDownload
};

/**
 * Stream a direct file into destDir with progress. Returns {path, bytes, contentType}.
 */
export async function directDownload(url, destDir, {
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
  preservePartialOnError = false,
  overwrite = 'avoid',
  filename
} = {}) {
  if (signal?.aborted) {
    const err = new Error('Download cancelled');
    err.name = 'AbortError';
    throw err;
  }
  if (pauseSignal?.aborted) {
    return { paused: true, path: partialPath, bytes: 0, resumable: true };
  }

  // Determine existing partial file offset if resuming
  let offset = 0;
  let tmpPath = null;
  let finalPath = null;

  if (partialPath && fs.existsSync(partialPath)) {
    try {
      offset = fs.statSync(partialPath).size;
      tmpPath = partialPath;
      const baseName = path.basename(tmpPath).replace(/^\./, '').replace(/\.part$/, '');
      finalPath = path.join(destDir, baseName);
    } catch {
      offset = 0;
      tmpPath = null;
    }
  }

  // Prepare initial request headers
  const reqHeaders = {};
  if (isResume && offset > 0) {
    reqHeaders['Range'] = `bytes=${offset}-`;
    // RFC 9110 Section 13.1.2: Origin servers MUST NOT evaluate an If-Range header
    // with a weak entity tag (prefixed by W/). Use Last-Modified if ETag is weak.
    const isWeakEtag = typeof etag === 'string' && /^W\//i.test(etag.trim());
    if (etag && !isWeakEtag) {
      reqHeaders['If-Range'] = etag.trim();
    } else if (lastModified) {
      reqHeaders['If-Range'] = lastModified.trim();
    }
  }

  let res = await fetchWithSafeRedirects(url, { headers: reqHeaders, allowLocal, signal });

  // Handle Range Not Satisfiable (416) or mismatched Content-Range: restart from 0
  function parseContentRange(cr) {
    if (!cr) return null;
    const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(cr);
    if (!m) return null;
    return { start: Number(m[1]), end: Number(m[2]), total: m[3] !== '*' ? Number(m[3]) : null };
  }

  const cr = parseContentRange(res.headers.get('content-range'));
  const resEtag = res.headers.get('etag');
  const etagMismatch = !!(etag && resEtag && !/^W\//i.test(etag) && !/^W\//i.test(resEtag) && etag.trim() !== resEtag.trim());
  const resLastModified = res.headers.get('last-modified');
  const modMismatch = !!(lastModified && resLastModified && lastModified.trim() !== resLastModified.trim());

  // If server returned 416, or returned 206 with wrong offset or changed validator: cancel and restart from 0 cleanly
  if (offset > 0 && (res.status === 416 || etagMismatch || modMismatch || (res.status === 206 && (!cr || cr.start !== offset)))) {
    if (res.body) await res.body.cancel().catch(() => {});
    if (tmpPath && fs.existsSync(tmpPath)) {
      try { fs.writeFileSync(tmpPath, Buffer.alloc(0)); } catch {}
    }
    offset = 0;
    res = await fetchWithSafeRedirects(url, { allowLocal, signal });
  }

  if (res.status !== 200 && res.status !== 206) {
    if (res.body) res.body.cancel().catch(() => {});
    const msg = {
      401: 'Authentication required (HTTP 401)',
      403: 'Access forbidden by server (HTTP 403)',
      404: 'File not found on server (HTTP 404)',
      410: 'Resource no longer available (HTTP 410)',
      416: 'Range not satisfiable (HTTP 416)',
      429: 'Too many requests / rate limited (HTTP 429)',
      500: 'Internal server error (HTTP 500)',
      502: 'Bad gateway (HTTP 502)',
      503: 'Service unavailable (HTTP 503)',
      504: 'Gateway timeout (HTTP 504)'
    }[res.status] || `Server returned HTTP ${res.status}`;
    throw new Error(msg);
  }

  const contentType = res.headers.get('content-type') || '';
  const currentEtag = res.headers.get('etag') || etag || null;
  const currentLastModified = res.headers.get('last-modified') || lastModified || null;
  const acceptRanges = res.headers.get('accept-ranges') || '';
  const isResumable = res.status === 206 || /bytes/i.test(acceptRanges) || !!currentEtag;

  // Determine total bytes
  let total = null;
  if (res.status === 206 && cr && cr.total != null) {
    total = cr.total;
  } else if (res.headers.get('content-length')) {
    const cl = Number(res.headers.get('content-length'));
    total = res.status === 206 ? offset + cl : cl;
  }

  if (maxBytes > 0 && total && total > maxBytes * 1024 * 1024) {
    res.body && res.body.cancel().catch(() => {});
    throw new Error(`File size ${(total / 1024 / 1024).toFixed(1)} MB exceeds the configured limit`);
  }

  const detected = extensionKind(url);
  if (!finalPath) {
    let name = filename || guessName(url, contentType);
    name = sanitizeFilename(name);
    finalPath = overwrite === 'overwrite' ? path.join(destDir, name) : uniquePath(destDir, name);
    tmpPath = path.join(destDir, `.${path.basename(finalPath)}.part`);
  }

  onMetadata?.({
    etag: currentEtag,
    lastModified: currentLastModified,
    resumable: isResumable,
    total,
    partialPath: tmpPath
  });

  // Empty response without body
  if (!res.body) {
    fs.writeFileSync(finalPath, Buffer.alloc(0));
    onProgress?.({ received: 0, total: total || 0, speed: 0, pct: 1, done: true, kind: detected ? detected.kind : 'file' });
    return { path: finalPath, bytes: 0, contentType };
  }

  // Choose file open mode:
  // ONLY append ('a') if server returned HTTP 206 with a matching Content-Range start!
  // If server returned HTTP 200, it sent the complete representation, so truncate ('w')!
  const isAppending = res.status === 206 && cr && cr.start === offset && offset > 0;
  let received = isAppending ? offset : 0;
  let lastTick = Date.now();
  let lastBytes = received;
  let speed = 0;
  let out = null;
  let reader = null;
  let streamErr = null;

  const cleanupTmp = async (unlink = true) => {
    try { reader?.cancel().catch(() => {}); } catch {}
    if (out) {
      await new Promise((resolve) => {
        if (out.destroyed || out.closed) return resolve();
        out.once('close', resolve);
        out.destroy();
      });
    }
    if (unlink) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        await new Promise((r) => setTimeout(r, 40));
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {}
      }
    }
  };

  const onAbort = () => {
    cleanupTmp().catch(() => {});
  };

  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    out = fs.createWriteStream(tmpPath, { flags: isAppending ? 'a' : 'w' });
    out.on('error', (err) => {
      streamErr = err;
    });

    reader = res.body.getReader();
    for (;;) {
      if (signal?.aborted) {
        throw new Error('Download cancelled');
      }
      if (pauseSignal?.aborted) {
        break;
      }
      if (streamErr) throw streamErr;
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) {
        throw new Error('Download cancelled');
      }
      if (pauseSignal?.aborted) {
        break;
      }
      if (streamErr) throw streamErr;

      received += value.byteLength;
      if (maxBytes > 0 && received > maxBytes * 1024 * 1024) {
        throw new Error('File size exceeds the configured limit');
      }
      const now = Date.now();
      if (now - lastTick >= 500) {
        speed = ((received - lastBytes) / (now - lastTick)) * 1000;
        lastTick = now;
        lastBytes = received;
      }
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      if (!signal?.aborted && !pauseSignal?.aborted) {
        onProgress?.({
          received,
          total: total > 0 ? total : null,
          speed,
          pct: total > 0 ? received / total : 0,
          kind: detected ? detected.kind : 'file'
        });
      }
    }
    if (streamErr) throw streamErr;
    await new Promise((resolve, reject) => {
      out.once('finish', resolve);
      out.once('error', reject);
      out.end();
    });

    // Verify completeness: if total size was known, received must match total
    if (!pauseSignal?.aborted && !signal?.aborted && total > 0 && received < total) {
      throw new Error(`Incomplete download: received ${received} of ${total} bytes from server`);
    }
  } catch (err) {
    if (!pauseSignal?.aborted) {
      await cleanupTmp(!preservePartialOnError);
    }
    if (signal?.aborted || /abort|cancel/i.test(err?.message)) {
      const cancelErr = new Error('Download cancelled');
      cancelErr.name = 'AbortError';
      throw cancelErr;
    }
    if (
      /terminated|socket|econnreset|broken pipe|premature close/i.test(err?.message) ||
      /socket|econnreset|terminated/i.test(err?.cause?.message)
    ) {
      const netErr = new Error('Connection interrupted: remote server closed the connection unexpectedly');
      netErr.cause = err;
      throw netErr;
    }
    throw err;
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }

  if (signal?.aborted) {
    onAbort();
    const cancelErr = new Error('Download cancelled');
    cancelErr.name = 'AbortError';
    throw cancelErr;
  }

  // If paused, keep .part file on disk and return paused status with authoritative size
  if (pauseSignal?.aborted) {
    if (reader) {
      try { await reader.cancel(); } catch {}
    }
    const actualBytes = fs.existsSync(tmpPath) ? fs.statSync(tmpPath).size : received;
    return {
      paused: true,
      path: tmpPath,
      bytes: actualBytes,
      contentType,
      etag: currentEtag,
      lastModified: currentLastModified,
      resumable: isResumable
    };
  }

  // Final sanity check before atomic rename: file must exist and match total if known
  if (fs.existsSync(tmpPath)) {
    const finalSize = fs.statSync(tmpPath).size;
    if (total > 0 && finalSize !== total) {
      throw new Error(`Integrity check failed: file size ${finalSize} does not match expected size ${total}`);
    }
  }

  // Atomically move the completed temporary file to the final destination
  fs.renameSync(tmpPath, finalPath);
  onProgress?.({ received, total: total || received, speed: 0, pct: 1, done: true, kind: detected ? detected.kind : 'file' });
  return { path: finalPath, bytes: received, contentType };
}

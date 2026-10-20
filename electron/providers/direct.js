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
  allowLocal = false,
  maxBytes = 0,
  signal,
  overwrite = 'avoid',
  filename
} = {}) {
  if (signal?.aborted) {
    const err = new Error('Download cancelled');
    err.name = 'AbortError';
    throw err;
  }

  const res = await fetchWithSafeRedirects(url, { allowLocal, signal });
  if (res.status !== 200) {
    if (res.body) res.body.cancel().catch(() => {});
    throw new Error(`Server returned HTTP ${res.status}`);
  }
  const contentType = res.headers.get('content-type') || '';
  const total = Number(res.headers.get('content-length')) || 0;
  if (maxBytes > 0 && total > maxBytes * 1024 * 1024) {
    res.body.cancel().catch(() => {});
    throw new Error(`File size ${(total / 1024 / 1024).toFixed(1)} MB exceeds the configured limit`);
  }

  const detected = extensionKind(url);
  let name = filename || guessName(url, contentType);
  name = sanitizeFilename(name);
  const finalPath = overwrite === 'overwrite' ? path.join(destDir, name) : uniquePath(destDir, name);
  const tmpPath = path.join(destDir, `.${path.basename(finalPath)}.part`);

  let received = 0;
  let lastTick = Date.now();
  let lastBytes = 0;
  let speed = 0;
  let out = null;
  let reader = null;

  const onAbort = () => {
    try { reader?.cancel().catch(() => {}); } catch {}
    try { out?.destroy(); } catch {}
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  };

  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    out = fs.createWriteStream(tmpPath);
    reader = res.body.getReader();
    for (;;) {
      if (signal?.aborted) {
        throw new Error('Download cancelled');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) {
        throw new Error('Download cancelled');
      }
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
      if (!signal?.aborted) {
        onProgress?.({
          received,
          total: total > 0 ? total : null,
          speed,
          pct: total > 0 ? received / total : 0,
          kind: detected ? detected.kind : 'file'
        });
      }
    }
    await new Promise((r, j) => out.end(() => r(), j));
  } catch (err) {
    onAbort();
    if (signal?.aborted || /abort|cancel/i.test(err?.message)) {
      const cancelErr = new Error('Download cancelled');
      cancelErr.name = 'AbortError';
      throw cancelErr;
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

  fs.renameSync(tmpPath, finalPath);
  onProgress?.({ received, total: total || received, speed: 0, pct: 1, done: true, kind: detected ? detected.kind : 'file' });
  return { path: finalPath, bytes: received, contentType };
}

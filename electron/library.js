import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { assertPathWithin, sanitizeFilename } from './security.js';

const EXT_KIND = {
  image: new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'tiff', 'heic']),
  video: new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi', 'flv', 'ts']),
  audio: new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'oga', 'm4b']),
  archive: new Set(['zip', '7z', 'rar'])
};

function kindOf(name) {
  const ext = path.extname(name).toLowerCase().replace('.', '');
  for (const [kind, set] of Object.entries(EXT_KIND)) if (set.has(ext)) return kind;
  return 'other';
}

/**
 * Scan the download directory (recursively, max depth 4) and return
 * real filesystem entries. Never fabricates records.
 */
export function scanLibrary(baseDir) {
  const files = [];
  function walk(dir, depth) {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) {
          if (!e.name.startsWith('.')) walk(p, depth + 1);
        } else if (e.isFile()) {
          if (e.name.startsWith('.') && e.name.endsWith('.part')) continue;
          const st = fs.statSync(p);
          files.push({
            path: p,
            name: e.name,
            size: st.size,
            mtime: st.mtimeMs,
            kind: kindOf(e.name)
          });
        }
      } catch {}
    }
  }
  walk(baseDir, 0);
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

/**
 * Read a small image file and return a data: URI for thumbnail display
 * in the renderer (the page cannot read file:// image bytes directly).
 */
export function readThumbnail(filePath, baseDir) {
  const p = assertPathWithin(baseDir, filePath);
  const st = fs.statSync(p);
  if (st.size > 3 * 1024 * 1024) return null;
  const ext = path.extname(p).toLowerCase().replace('.', '');
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' }[ext];
  if (!mime) return null;
  const buf = fs.readFileSync(p);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function sharedRoot(a, b) {
  const aa = path.resolve(a).split(path.sep).filter(Boolean);
  const bb = path.resolve(b).split(path.sep).filter(Boolean);
  const n = Math.min(aa.length, bb.length);
  let i = 0;
  while (i < n && aa[i].toLowerCase() === bb[i].toLowerCase()) i++;
  if (i === 0) return null;
  const joined = path.join(...aa.slice(0, i));
  // avoid drive letters like "C:" on Windows
  if (process.platform === 'win32' && /^[A-Za-z]:$/.test(joined)) return null;
  return joined;
}

function commonRoot(paths, baseDir) {
  let root = baseDir;
  for (const p of paths) {
    const next = sharedRoot(root, path.dirname(p));
    if (!next) return baseDir;
    root = next;
  }
  const resolved = path.resolve(baseDir);
  if (root === resolved || root.startsWith(resolved)) return root;
  return baseDir;
}

/**
 * ZIP a set of files (all confined to baseDir) into destPath.
 * onProgress({phase, count, total, size}).
 */
export function zipFiles({ files, destPath, baseDir, onProgress }) {
  return new Promise((resolve, reject) => {
    const safe = files.map((f) => assertPathWithin(baseDir, f));
    const root = commonRoot(safe, baseDir);
    const out = fs.createWriteStream(destPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    let count = 0;

    const finish = (err) => {
      if (err) {
        try {
          fs.unlinkSync(destPath);
        } catch {}
        reject(err);
      }
    };

    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') finish(err);
    });
    archive.on('error', finish);
    out.on('close', () => {
      onProgress?.({ phase: 'done', count: safe.length, total: safe.length, size: fs.statSync(destPath).size });
      resolve({ path: destPath, bytes: fs.statSync(destPath).size, count: safe.length });
    });

    archive.pipe(out);
    for (const f of safe) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      archive.file(f, { name: sanitizeFilename(rel) });
      count++;
      onProgress?.({ phase: 'writing', count, total: safe.length });
    }
    archive.finalize().catch(finish);
  });
}

/** Delete files confined to baseDir. Returns the list of removed paths. */
export function deleteFiles(paths, baseDir) {
  const removed = [];
  for (const p of paths) {
    const safe = assertPathWithin(baseDir, p);
    const st = fs.statSync(safe);
    if (!st.isFile()) throw new Error(`Refusing to delete non-file path: ${p}`);
    fs.rmSync(safe);
    removed.push(safe);
  }
  return removed;
}

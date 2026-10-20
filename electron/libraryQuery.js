import fs from 'node:fs';
import path from 'node:path';
import { scanLibrary } from './library.js';
import { getDb } from './db.js';
import { loadSettings } from './settings.js';

const EXT_CATEGORIES = {
  video: new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi', 'flv', 'ts', 'wmv', '3gp', 'mpg', 'mpeg']),
  audio: new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'oga', 'm4b', 'wma', 'aiff']),
  image: new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'tiff', 'heic', 'ico']),
  document: new Set(['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'epub', 'md', 'json', 'csv', 'xml', 'html']),
  archive: new Set(['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz'])
};

export function classifyFileCategory(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  for (const [cat, set] of Object.entries(EXT_CATEGORIES)) {
    if (set.has(ext)) return cat;
  }
  return 'other';
}

/**
 * Unified Library Query Engine.
 *
 * Joins physical disk scanning with SQLite completed jobs, technical media metadata,
 * and user collections without loading entire files into memory.
 */
export function queryLibrary({
  baseDir,
  getDbInstance = getDb,
  getSettings = loadSettings,
  search = '',
  category = 'all',
  collectionId = null,
  platform = 'all',
  sort = 'date',
  order = 'desc',
  limit = 50,
  offset = 0
} = {}) {
  const s = getSettings();
  const dir = baseDir || s.downloadDir;
  const db = getDbInstance();

  // 1. Scan filesystem
  const physicalFiles = scanLibrary(dir);
  const physicalMap = new Map();
  for (const f of physicalFiles) {
    physicalMap.set(path.resolve(f.path), f);
  }

  // 2. Query completed jobs
  const jobRows = db
    .prepare(
      `SELECT id, url, provider, kind, title, result_path, collection_id, created_at, finished_at, extra
       FROM jobs
       WHERE status = 'completed' AND result_path IS NOT NULL`
    )
    .all();

  const jobsByPath = new Map();
  for (const j of jobRows) {
    const p = path.resolve(j.result_path);
    jobsByPath.set(p, j);
  }

  // 3. Query all collection assignments
  const colRows = db
    .prepare(
      `SELECT ci.item_path, c.id, c.name, c.color
       FROM collection_items ci
       JOIN collections c ON ci.collection_id = c.id`
    )
    .all();

  const collectionsByPath = new Map();
  for (const cr of colRows) {
    const p = path.resolve(cr.item_path);
    const list = collectionsByPath.get(p) || [];
    list.push({ id: cr.id, name: cr.name, color: cr.color });
    collectionsByPath.set(p, list);
  }

  // 4. Query cached media metadata
  const metaRows = db.prepare('SELECT * FROM media_metadata').all();
  const metaByPath = new Map();
  for (const m of metaRows) {
    metaByPath.set(path.resolve(m.file_path), m);
  }

  // 5. Assemble unified library list
  const unified = [];
  const seenPaths = new Set();

  // Add physical files
  for (const f of physicalFiles) {
    const absPath = path.resolve(f.path);
    seenPaths.add(absPath);
    const job = jobsByPath.get(absPath);
    const meta = metaByPath.get(absPath);
    const cols = collectionsByPath.get(absPath) || [];

    const fileCategory = classifyFileCategory(f.name);

    unified.push({
      id: job?.id || absPath,
      jobId: job?.id || null,
      path: absPath,
      name: f.name,
      title: job?.title || f.name,
      size: f.size,
      mtime: f.mtime,
      kind: fileCategory,
      provider: job?.provider || 'local',
      sourceUrl: job?.url || null,
      downloadDate: job?.finished_at || f.mtime,
      collections: cols,
      metadata: {
        duration: meta?.duration || null,
        width: meta?.width || null,
        height: meta?.height || null,
        resolution: meta?.width && meta?.height ? `${meta.width}x${meta.height}` : null,
        videoCodec: meta?.video_codec || null,
        audioCodec: meta?.audio_codec || null,
        bitrate: meta?.bitrate || null,
        formatName: meta?.format_name || null,
        channels: meta?.channels || null
      },
      existsOnDisk: true
    });
  }

  // Check for missing completed jobs (in DB but file was moved/deleted on disk)
  for (const j of jobRows) {
    const absPath = path.resolve(j.result_path);
    if (!seenPaths.has(absPath)) {
      const cols = collectionsByPath.get(absPath) || [];
      const meta = metaByPath.get(absPath);
      const filename = path.basename(absPath);
      const fileCategory = classifyFileCategory(filename);

      unified.push({
        id: j.id,
        jobId: j.id,
        path: absPath,
        name: filename,
        title: j.title || filename,
        size: null,
        mtime: j.finished_at || j.created_at,
        kind: fileCategory,
        provider: j.provider || 'unknown',
        sourceUrl: j.url,
        downloadDate: j.finished_at || j.created_at,
        collections: cols,
        metadata: {
          duration: meta?.duration || null,
          width: meta?.width || null,
          height: meta?.height || null,
          resolution: meta?.width && meta?.height ? `${meta.width}x${meta.height}` : null,
          videoCodec: meta?.video_codec || null,
          audioCodec: meta?.audio_codec || null,
          bitrate: meta?.bitrate || null,
          formatName: meta?.format_name || null,
          channels: meta?.channels || null
        },
        existsOnDisk: false
      });
    }
  }

  // 6. Calculate category and platform counts before filters
  const categoryCounts = { all: unified.length, video: 0, audio: 0, image: 0, document: 0, archive: 0, other: 0 };
  const platformCounts = new Map();

  for (const item of unified) {
    if (categoryCounts[item.kind] !== undefined) categoryCounts[item.kind]++;
    else categoryCounts.other++;

    const prov = item.provider || 'local';
    platformCounts.set(prov, (platformCounts.get(prov) || 0) + 1);
  }

  // 7. Filter items
  let filtered = unified;

  if (category && category !== 'all') {
    filtered = filtered.filter((i) => i.kind === category);
  }

  if (platform && platform !== 'all') {
    filtered = filtered.filter((i) => i.provider === platform);
  }

  if (collectionId) {
    filtered = filtered.filter((i) => i.collections.some((c) => c.id === collectionId));
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter((i) => {
      const matchTitle = (i.title || '').toLowerCase().includes(q);
      const matchName = (i.name || '').toLowerCase().includes(q);
      const matchPath = (i.path || '').toLowerCase().includes(q);
      const matchProvider = (i.provider || '').toLowerCase().includes(q);
      const matchCol = i.collections.some((c) => c.name.toLowerCase().includes(q));
      return matchTitle || matchName || matchPath || matchProvider || matchCol;
    });
  }

  // 8. Sort
  filtered.sort((a, b) => {
    let cmp = 0;
    if (sort === 'date') {
      cmp = (b.downloadDate || 0) - (a.downloadDate || 0);
    } else if (sort === 'size') {
      cmp = (b.size || 0) - (a.size || 0);
    } else if (sort === 'duration') {
      cmp = (b.metadata?.duration || 0) - (a.metadata?.duration || 0);
    } else if (sort === 'name') {
      cmp = (a.title || a.name).localeCompare(b.title || b.name);
    }

    return order === 'asc' ? -cmp : cmp;
  });

  // 9. Paginate
  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    items: paginated,
    total,
    counts: categoryCounts,
    categoryCounts,
    platformCounts: Object.fromEntries(platformCounts),
    offset,
    limit,
    pagination: {
      total,
      offset,
      limit,
      hasMore: offset + limit < total
    },
    baseDir: dir
  };
}

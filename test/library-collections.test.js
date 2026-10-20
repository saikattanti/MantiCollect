import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../electron/db.js';
import {
  createCollection,
  listCollections,
  getCollection,
  renameCollection,
  deleteCollection,
  addItemsToCollection,
  removeItemsFromCollection,
  getCollectionItemPaths
} from '../electron/collections.js';
import { classifyFileCategory, queryLibrary } from '../electron/libraryQuery.js';
import { createMetadataService } from '../electron/metadata.js';

test('collections database migrations are backward-compatible', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-col-mig-'));
  const dbFile = path.join(tmpDir, 'test.db');
  const db = new Database(dbFile);

  migrate(db);

  // Verify all new Phase 7 tables exist
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);

  assert.ok(tables.includes('collections'), 'collections table must exist');
  assert.ok(tables.includes('collection_items'), 'collection_items table must exist');
  assert.ok(tables.includes('media_metadata'), 'media_metadata table must exist');
  assert.ok(tables.includes('conversions'), 'conversions table must exist');

  // Verify indexes exist
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((r) => r.name);

  assert.ok(indexes.includes('idx_collection_items_col'), 'idx_collection_items_col must exist');
  assert.ok(indexes.includes('idx_collection_items_path'), 'idx_collection_items_path must exist');

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('collections CRUD operations and many-to-many relationship', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-col-crud-'));
  const dbFile = path.join(tmpDir, 'test.db');
  const db = new Database(dbFile);
  migrate(db);

  // 1. Create collection
  const col1 = createCollection('Tutorials', 'Coding videos', '#00e5ff', db);
  assert.ok(col1.id, 'collection id generated');
  assert.equal(col1.name, 'Tutorials');
  assert.equal(col1.description, 'Coding videos');
  assert.equal(col1.color, '#00e5ff');

  const col2 = createCollection('Favorites', 'Top picks', '#ef4444', db);

  // 2. List collections
  const list = listCollections(db);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'Favorites'); // ordered by created_at desc

  // 3. Rename collection
  const renamed = renameCollection(col1.id, 'Programming Tutorials', db);
  assert.equal(renamed.name, 'Programming Tutorials');
  assert.equal(getCollection(col1.id, db).name, 'Programming Tutorials');

  // 4. Add items (many-to-many)
  const itemA = 'D:/Media/video1.mp4';
  const itemB = 'D:/Media/video2.mp4';
  const itemC = 'D:/Media/song.mp3';

  const addRes1 = addItemsToCollection(col1.id, [itemA, itemB], db);
  assert.equal(addRes1.added, 2);

  // Add itemA to col2 as well (verifies many-to-many)
  const addRes2 = addItemsToCollection(col2.id, [itemA, itemC], db);
  assert.equal(addRes2.added, 2);

  // Check counts
  const paths1 = getCollectionItemPaths(col1.id, db);
  assert.deepEqual(paths1.sort(), [path.resolve(itemA), path.resolve(itemB)].sort());

  const updatedCols = listCollections(db);
  const updatedCol1 = updatedCols.find((c) => c.id === col1.id);
  assert.equal(updatedCol1.item_count, 2);

  // 5. Remove an item
  removeItemsFromCollection(col1.id, [itemA], db);
  assert.equal(getCollectionItemPaths(col1.id, db).length, 1);

  // ItemA should still belong to col2!
  assert.equal(getCollectionItemPaths(col2.id, db).length, 2);

  // 6. Delete collection (removes association, leaves other collections intact)
  deleteCollection(col1.id, db);
  assert.equal(getCollection(col1.id, db), null);
  assert.equal(getCollectionItemPaths(col1.id, db).length, 0);

  // col2 still has its items
  assert.equal(getCollectionItemPaths(col2.id, db).length, 2);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('transaction safety: adding items rolls back if an error occurs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-tx-'));
  const dbFile = path.join(tmpDir, 'test.db');
  const db = new Database(dbFile);
  migrate(db);

  const col = createCollection('TestCol', '', '#00e5ff', db);

  // Adding items with non-array input throws
  assert.throws(() => {
    addItemsToCollection(col.id, 'not-an-array', db);
  });

  // Zero items added
  assert.equal(getCollectionItemPaths(col.id, db).length, 0);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('classifyFileCategory accurately classifies by file extension', () => {
  assert.equal(classifyFileCategory('movie.mp4'), 'video');
  assert.equal(classifyFileCategory('clip.WEBM'), 'video');
  assert.equal(classifyFileCategory('track.mp3'), 'audio');
  assert.equal(classifyFileCategory('voice.m4a'), 'audio');
  assert.equal(classifyFileCategory('photo.jpeg'), 'image');
  assert.equal(classifyFileCategory('graphic.png'), 'image');
  assert.equal(classifyFileCategory('manual.pdf'), 'document');
  assert.equal(classifyFileCategory('notes.txt'), 'document');
  assert.equal(classifyFileCategory('bundle.zip'), 'archive');
  assert.equal(classifyFileCategory('data.7z'), 'archive');
  assert.equal(classifyFileCategory('binary.exe'), 'other');
  assert.equal(classifyFileCategory('noextension'), 'other');
});

test('queryLibrary handles physical files, missing files, Unicode names, and search filtering', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-lib-query-'));
  const dbDir = path.join(tmpDir, 'db');
  const downloadsDir = path.join(tmpDir, 'downloads');
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(downloadsDir, { recursive: true });

  const dbFile = path.join(dbDir, 'test.db');
  const db = new Database(dbFile);
  migrate(db);

  // Create real files in downloadsDir
  const file1 = path.join(downloadsDir, 'tutorial_javascript.mp4');
  const file2 = path.join(downloadsDir, 'podcast_react.mp3');
  const file3 = path.join(downloadsDir, '日本語テスト_video.mp4'); // Unicode filename
  fs.writeFileSync(file1, 'fake video');
  fs.writeFileSync(file2, 'fake audio');
  fs.writeFileSync(file3, 'fake unicode video');

  // Insert a completed job record whose file was deleted (missing file)
  const missingPath = path.join(downloadsDir, 'deleted_file.mkv');
  db.prepare(
    `INSERT INTO jobs (id, url, provider, kind, title, status, result_path, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?)`
  ).run('job-del', 'https://example.com/del', 'direct', 'video', 'Deleted Media', missingPath, 1000, 2000);

  // Create collection and assign file1
  const col = createCollection('Dev', 'Coding', '#00e5ff', db);
  addItemsToCollection(col.id, [file1], db);

  // 1. Query all
  const resAll = queryLibrary({
    baseDir: downloadsDir,
    getDbInstance: () => db,
    getSettings: () => ({ downloadDir: downloadsDir })
  });

  assert.equal(resAll.items.length, 4, 'should include 3 physical files + 1 missing DB job');
  assert.equal(resAll.counts.all, 4);
  assert.equal(resAll.counts.video, 3);
  assert.equal(resAll.counts.audio, 1);

  // Verify missing file is explicitly identified
  const missingItem = resAll.items.find((i) => i.id === 'job-del');
  assert.ok(missingItem, 'missing job item must exist');
  assert.equal(missingItem.existsOnDisk, false, 'must flag existsOnDisk as false');

  // Verify unicode filename handling
  const unicodeItem = resAll.items.find((i) => i.name.includes('日本語テスト'));
  assert.ok(unicodeItem, 'unicode file must be found');
  assert.equal(unicodeItem.existsOnDisk, true);

  // 2. Search query
  const resSearch = queryLibrary({
    baseDir: downloadsDir,
    getDbInstance: () => db,
    getSettings: () => ({ downloadDir: downloadsDir }),
    search: 'podcast'
  });
  assert.equal(resSearch.items.length, 1);
  assert.equal(resSearch.items[0].name, 'podcast_react.mp3');

  // 3. Category filter
  const resAudio = queryLibrary({
    baseDir: downloadsDir,
    getDbInstance: () => db,
    getSettings: () => ({ downloadDir: downloadsDir }),
    category: 'audio'
  });
  assert.equal(resAudio.items.length, 1);
  assert.equal(resAudio.items[0].kind, 'audio');

  // 4. Collection filter
  const resCol = queryLibrary({
    baseDir: downloadsDir,
    getDbInstance: () => db,
    getSettings: () => ({ downloadDir: downloadsDir }),
    collectionId: col.id
  });
  assert.equal(resCol.items.length, 1);
  assert.equal(resCol.items[0].name, 'tutorial_javascript.mp4');

  // 5. Pagination
  const resPaged = queryLibrary({
    baseDir: downloadsDir,
    getDbInstance: () => db,
    getSettings: () => ({ downloadDir: downloadsDir }),
    limit: 2,
    offset: 0
  });
  assert.equal(resPaged.items.length, 2);
  assert.equal(resPaged.pagination.hasMore, true);
  assert.equal(resPaged.pagination.total, 4);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('media metadata service caching: does not re-probe unchanged files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-meta-test-'));
  const dbFile = path.join(tmpDir, 'test.db');
  const db = new Database(dbFile);
  migrate(db);

  const testFile = path.join(tmpDir, 'test_media.mp4');
  fs.writeFileSync(testFile, 'sample content');
  const st = fs.statSync(testFile);

  const metaService = createMetadataService({
    getDbInstance: () => db,
    getSettings: () => ({ downloadDir: tmpDir })
  });

  // Prime cache manually in SQLite
  db.prepare(
    `INSERT INTO media_metadata (
       file_path, file_size, file_mtime, duration, width, height,
       video_codec, audio_codec, format_name, probed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    path.resolve(testFile),
    st.size,
    st.mtimeMs,
    42.5,
    1920,
    1080,
    'h264',
    'aac',
    'mov,mp4,m4a,3gp,3g2,mj2',
    Date.now()
  );

  // Query via service - should retrieve from cache without running ffprobe
  const cached = await metaService.probeFile(testFile);
  assert.equal(cached.duration, 42.5);
  assert.equal(cached.width, 1920);
  assert.equal(cached.height, 1080);
  assert.equal(cached.video_codec, 'h264');
  assert.equal(cached.audio_codec, 'aac');

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

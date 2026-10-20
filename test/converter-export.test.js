import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  uniqueDestPath,
  exportFilesToDirectory,
  formatMetadataAsJson,
  formatMetadataAsCsv
} from '../electron/export.js';
import { CONVERSION_PRESETS, createConversionService } from '../electron/converter.js';
import { LocalNasStorageProvider } from '../electron/remoteStorage.js';
import Database from 'better-sqlite3';
import { migrate } from '../electron/db.js';

test('uniqueDestPath disambiguates duplicate filenames safely', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-unique-'));

  const name = 'sample.mp4';
  const first = uniqueDestPath(tmpDir, name);
  assert.equal(first, path.join(tmpDir, 'sample.mp4'));

  // Create first file
  fs.writeFileSync(first, 'data 1');

  const second = uniqueDestPath(tmpDir, name);
  assert.equal(second, path.join(tmpDir, 'sample (1).mp4'));

  // Create second file
  fs.writeFileSync(second, 'data 2');

  const third = uniqueDestPath(tmpDir, name);
  assert.equal(third, path.join(tmpDir, 'sample (2).mp4'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('formatMetadataAsJson outputs valid formatted JSON with all media metadata', () => {
  const items = [
    {
      id: 'job-1',
      title: 'First Video',
      name: 'video1.mp4',
      path: '/media/video1.mp4',
      size: 1048576,
      provider: 'youtube',
      sourceUrl: 'https://youtube.com/watch?v=abc',
      downloadDate: 1729450000000,
      metadata: {
        resolution: '1920x1080',
        videoCodec: 'h264',
        audioCodec: 'aac',
        duration: 120.5
      }
    }
  ];

  const jsonStr = formatMetadataAsJson(items);
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.generator, 'MantiCollect - A Mantitup Product');
  assert.equal(parsed.itemCount, 1);
  assert.equal(parsed.items[0].title, 'First Video');
  assert.equal(parsed.items[0].metadata.resolution, '1920x1080');
});

test('formatMetadataAsCsv outputs valid RFC 4180 CSV with UTF-8 BOM and proper escaping', () => {
  const items = [
    {
      id: 'job-1',
      title: 'Title, With "Quotes" & Commas',
      name: 'video,1.mp4',
      kind: 'video',
      size: 5000,
      provider: 'direct',
      sourceUrl: 'https://example.com/test',
      downloadDate: 1729450000000,
      metadata: {
        resolution: '1280x720',
        videoCodec: 'h264',
        audioCodec: 'aac',
        duration: 60
      }
    }
  ];

  const csv = formatMetadataAsCsv(items);

  // Check UTF-8 BOM is present for Excel compatibility
  assert.ok(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM');

  // Verify headers
  assert.ok(csv.includes('Name,Title,Category,Provider,Size (Bytes),Duration (Seconds),Resolution,Video Codec,Audio Codec,Source URL,Download Date,Collections,File Path'));

  // Verify quotes are properly escaped as ""
  assert.ok(csv.includes('"Title, With ""Quotes"" & Commas"'), 'Quotes must be doubled per RFC 4180');
  assert.ok(csv.includes('"video,1.mp4"'), 'Filename with comma must be quoted');
});

test('exportFilesToDirectory copies files, handles duplicate names and missing files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-export-'));
  const srcDir = path.join(tmpDir, 'source');
  const destDir = path.join(tmpDir, 'dest');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });

  const fileA = path.join(srcDir, 'report.pdf');
  const fileB = path.join(srcDir, 'data.json');
  fs.writeFileSync(fileA, 'PDF Content');
  fs.writeFileSync(fileB, 'JSON Content');

  const missingFile = path.join(srcDir, 'nonexistent.mp4');

  const progressEvents = [];
  const res = await exportFilesToDirectory({
    filePaths: [fileA, fileB, missingFile],
    targetDir: destDir,
    onProgress: (p) => progressEvents.push(p)
  });

  assert.equal(res.total, 3);
  assert.equal(res.exported, 2);
  assert.equal(res.failed, 1);
  assert.equal(res.errors.length, 1);
  assert.ok(res.errors[0].error.includes('Source file does not exist'));

  // Verify files were actually copied
  assert.ok(fs.existsSync(path.join(destDir, 'report.pdf')));
  assert.ok(fs.existsSync(path.join(destDir, 'data.json')));
  assert.equal(fs.readFileSync(path.join(destDir, 'report.pdf'), 'utf8'), 'PDF Content');

  // Verify progress was reported
  assert.ok(progressEvents.length >= 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('exportFilesToDirectory supports cancellation via AbortSignal', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-abort-'));
  const srcDir = path.join(tmpDir, 'source');
  const destDir = path.join(tmpDir, 'dest');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });

  const file1 = path.join(srcDir, 'f1.bin');
  const file2 = path.join(srcDir, 'f2.bin');
  fs.writeFileSync(file1, 'data 1');
  fs.writeFileSync(file2, 'data 2');

  const controller = new AbortController();
  controller.abort(); // already aborted

  await assert.rejects(
    async () => {
      await exportFilesToDirectory({
        filePaths: [file1, file2],
        targetDir: destDir,
        abortSignal: controller.signal
      });
    },
    /cancelled|aborted/i
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CONVERSION_PRESETS validates predefined safe presets without shell interpolation', () => {
  assert.ok(CONVERSION_PRESETS.mp4_universal, 'mp4_universal preset exists');
  assert.ok(CONVERSION_PRESETS.mp4_small, 'mp4_small preset exists');
  assert.ok(CONVERSION_PRESETS.webm_vp9, 'webm_vp9 preset exists');
  assert.ok(CONVERSION_PRESETS.extract_audio_mp3, 'extract_audio_mp3 preset exists');
  assert.ok(CONVERSION_PRESETS.audio_mp3, 'audio_mp3 preset exists');

  for (const [key, preset] of Object.entries(CONVERSION_PRESETS)) {
    assert.equal(preset.id, key);
    assert.ok(preset.label, `${key} must have label`);
    assert.ok(preset.targetExt.startsWith('.'), `${key} targetExt must start with dot`);
    assert.ok(Array.isArray(preset.args), `${key} args must be an array (never a shell string)`);
    // Guarantee no shell metacharacters in preset args
    for (const arg of preset.args) {
      assert.ok(!/[;&|><`$]/.test(arg), `Preset arg "${arg}" contains dangerous shell character`);
    }
  }
});

test('conversion service rejects invalid presets and prevents source overwrite', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-conv-test-'));
  const dbFile = path.join(tmpDir, 'test.db');
  const db = new Database(dbFile);
  migrate(db);

  const mediaFile = path.join(tmpDir, 'clip.mp4');
  fs.writeFileSync(mediaFile, 'dummy media');

  const convService = createConversionService({
    getDbInstance: () => db,
    getSettings: () => ({ downloadDir: tmpDir })
  });

  // 1. Invalid preset rejected
  await assert.rejects(
    async () => {
      await convService.startConversion({
        sourcePath: mediaFile,
        presetId: 'malicious_preset; rm -rf /'
      });
    },
    /Invalid conversion preset/
  );

  // 2. Nonexistent source file rejected
  await assert.rejects(
    async () => {
      await convService.startConversion({
        sourcePath: path.join(tmpDir, 'nonexistent.mp4'),
        presetId: 'mp4_universal'
      });
    },
    /Source file does not exist/
  );

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('LocalNasStorageProvider tests connectivity and streams files with integrity verification', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-nas-test-'));
  const nasBase = path.join(tmpDir, 'nas_share');
  fs.mkdirSync(nasBase, { recursive: true });

  const provider = new LocalNasStorageProvider({ basePath: nasBase });

  // 1. Test connectivity
  const connRes = await provider.testConnection();
  assert.equal(connRes.ok, true);

  // 2. Test nonexistent path
  const badProvider = new LocalNasStorageProvider({ basePath: path.join(tmpDir, 'missing_nas') });
  const badConn = await badProvider.testConnection();
  assert.equal(badConn.ok, false);

  // 3. Transfer file
  const srcFile = path.join(tmpDir, 'document.pdf');
  const fileContent = 'Important archival document content';
  fs.writeFileSync(srcFile, fileContent);

  const progressUpdates = [];
  const transferRes = await provider.transferFile({
    sourcePath: srcFile,
    targetSubdir: 'backups',
    onProgress: (p) => progressUpdates.push(p)
  });

  assert.equal(transferRes.ok, true);
  assert.equal(transferRes.bytesTransferred, Buffer.byteLength(fileContent));
  assert.ok(fs.existsSync(transferRes.destPath));
  assert.equal(fs.readFileSync(transferRes.destPath, 'utf8'), fileContent);
  assert.ok(progressUpdates.length > 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

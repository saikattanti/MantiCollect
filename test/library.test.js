import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipFiles, scanLibrary, deleteFiles } from '../electron/library.js';

const THIS_FILE = fileURLToPath(import.meta.url);

test('zipFiles archives selected files with relative names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvzip-'));
  const sub = path.join(dir, 'album');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(dir, 'root.mp3'), 'audio');
  fs.writeFileSync(path.join(sub, 'a.jpg'), 'img1');
  fs.writeFileSync(path.join(sub, 'b.jpg'), 'img2');
  const zipPath = path.join(dir, 'out.zip');

  const result = await zipFiles({
    files: [path.join(dir, 'root.mp3'), path.join(sub, 'a.jpg'), path.join(sub, 'b.jpg')],
    destPath: zipPath,
    baseDir: dir
  });

  assert.ok(result.count === 3);
  assert.ok(result.bytes > 0);
  const buf = fs.readFileSync(zipPath);
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK', 'zip magic bytes');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('zipFiles refuses paths outside baseDir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvzip2-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mvzip3-'));
  const f = path.join(outside, 'secret.txt');
  fs.writeFileSync(f, 'x');
  await assert.rejects(
    () => zipFiles({ files: [f], destPath: path.join(dir, 'o.zip'), baseDir: dir }),
    /escapes/
  );
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test('scanLibrary finds files recursively with real stats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvscan-'));
  fs.mkdirSync(path.join(dir, 'deep', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.mp4'), '12345');
  fs.writeFileSync(path.join(dir, 'deep', 'b.png'), '123');
  fs.writeFileSync(path.join(dir, '.c.part'), 'temp');
  const files = scanLibrary(dir);
  assert.equal(files.length, 2);
  const a = files.find((f) => f.name === 'a.mp4');
  assert.equal(a.size, 5);
  assert.equal(a.kind, 'video');
  assert.equal(files.find((f) => f.name === 'b.png').kind, 'image');
  assert.ok(!files.some((f) => f.name === '.c.part'), 'temp files excluded');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('deleteFiles removes only files inside baseDir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvdel-'));
  const f1 = path.join(dir, 'one.txt');
  const f2 = path.join(dir, 'two.txt');
  fs.writeFileSync(f1, '1');
  fs.writeFileSync(f2, '2');
  const removed = deleteFiles([f1, f2], dir);
  assert.equal(removed.length, 2);
  assert.equal(fs.existsSync(f1), false);
  assert.throws(() => deleteFiles([THIS_FILE], dir), /escapes/);
  fs.rmSync(dir, { recursive: true, force: true });
});

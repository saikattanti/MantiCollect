import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYtDlpLine, parseSize, friendlyError, findResultFile, buildFormatOptions } from '../electron/providers/ytdlp.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('parseSize converts units', () => {
  assert.equal(parseSize('1.5', 'MiB'), 1572864);
  assert.equal(parseSize('2', 'GB'), 2000000000);
  assert.equal(parseSize('10', 'KB'), 10000);
});

test('parseYtDlpLine parses progress with speed', () => {
  const ev = parseYtDlpLine('[download]  42.3% of ~1.23MiB at 3.21MiB/s ETA 00:05');
  assert.equal(ev.type, 'progress');
  assert.equal(ev.pct, 42.3);
  assert.ok(Math.abs(ev.totalBytes - 1288490.16) < 2000);
  assert.ok(ev.speedBps > 3000000);
});

test('parseYtDlpLine parses progress without speed', () => {
  const ev = parseYtDlpLine('[download]  10.0% of 5.00MiB ETA 00:12');
  assert.equal(ev.type, 'progress');
  assert.equal(ev.pct, 10);
  assert.equal(ev.speedBps, null);
});

test('parseYtDlpLine parses destination, processing, error', () => {
  assert.equal(parseYtDlpLine('[download] Destination: /tmp/video [abc].mp4').path, '/tmp/video [abc].mp4');
  assert.equal(parseYtDlpLine('[Merger] Merging formats into "/tmp/video.mp4"').type, 'processing');
  assert.equal(parseYtDlpLine('[ExtractAudio] Converting audio to mp3').type, 'processing');
  assert.equal(parseYtDlpLine('[ERROR] Unable to download webpage: HTTP 404').type, 'error');
  assert.equal(parseYtDlpLine('random noise'), null);
});

test('friendlyError maps common failures', () => {
  assert.match(friendlyError('[ERROR] Unsupported URL: https://x.com'), /not recognized|no extractor/i);
  assert.match(friendlyError('[ERROR] This video is private. Sign in to confirm your age.'), /age-restricted|cookies/i);
  assert.match(friendlyError('error: you need to install ffmpeg'), /FFmpeg/i);
  assert.match(friendlyError('[download] 403 Forbidden'), /403/i);
  assert.match(friendlyError('[ERROR] something totally novel happened'), /yt-dlp failed|novel/i);
});

test('findResultFile prefers id match, falls back to recent file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-'));
  const id = 'dQw4w9WgXcQ';
  fs.writeFileSync(path.join(dir, `Some Title [${id}].mp4`), 'x'.repeat(100));
  fs.writeFileSync(path.join(dir, 'other.mp4'), 'y'.repeat(50));
  assert.equal(findResultFile(dir, id, Date.now() - 60000), path.join(dir, `Some Title [${id}].mp4`));
  fs.rmSync(path.join(dir, `Some Title [${id}].mp4`));
  const recent = findResultFile(dir, 'missing-id', Date.now() - 60000);
  assert.equal(recent, path.join(dir, 'other.mp4'));
  assert.equal(findResultFile(dir, 'missing-id', Date.now() + 3600000), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildFormatOptions builds real options from yt-dlp-style data', () => {
  const data = {
    id: 'abc',
    ext: 'mp4',
    formats: [
      { format_id: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080, tbr: 5000 },
      { format_id: '136', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 720, tbr: 1500 },
      { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', tbr: 128 },
      { format_id: '22', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a.40.2', height: 720, tbr: 1000 }
    ]
  };
  const { options } = buildFormatOptions(data);
  const ids = options.map((o) => o.id);
  assert.ok(ids.includes('combined-best'), 'combined best present');
  assert.ok(ids.includes('h1080'), '1080p option present');
  assert.ok(ids.includes('h720'), '720p option present');
  assert.ok(ids.includes('audio-native'), 'original audio option present');
  assert.ok(ids.includes('audio-mp3'), 'mp3 conversion option present');
  const opt1080 = options.find((o) => o.id === 'h1080');
  assert.equal(opt1080.format, 'bv*[height<=1080]+ba/b[height<=1080]');
});

test('buildFormatOptions handles image-only sources', () => {
  const data = { id: 'x', ext: 'jpg', formats: [] };
  const { options } = buildFormatOptions(data);
  assert.ok(options.some((o) => o.id === 'original'));
});

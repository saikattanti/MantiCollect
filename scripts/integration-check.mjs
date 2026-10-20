/**
 * Real integration check (requires internet access):
 *
 *   node scripts/integration-check.mjs             probe only
 *   node scripts/integration-check.mjs --download  probe + one small real download
 *   node scripts/integration-check.mjs <url>       use a different URL
 *
 * Default target: "Me at the zoo" (https://www.youtube.com/watch?v=jNQXAC9IVRw),
 * the first-ever YouTube video — short and public. The download (when requested)
 * picks the smallest reported format and goes to a temp folder.
 *
 * This exercises the real code paths: binary resolution, provider registry,
 * yt-dlp subprocess, JSON parsing, format options, and (optionally) the
 * download loop with process-tree cancellation available.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { resolveProvider } from '../electron/providers/registry.js';
import { resolveYtDlp, ffmpegDirectory } from '../electron/bins.js';

const args = process.argv.slice(2);
const wantDownload = args.includes('--download');
const url = args.find((a) => !a.startsWith('-')) || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

const bin = await resolveYtDlp({});
if (!bin) {
  console.error('yt-dlp not found. Run: npm run setup-bins');
  process.exit(1);
}
console.log('yt-dlp binary:', bin);

const provider = resolveProvider(url);
console.log('provider:', provider.id, '—', provider.name);

const ctx = {
  ytdlpBin: bin,
  ffmpegDir: ffmpegDirectory({}),
  probeTimeoutMs: 60000,
  cookiesFile: null
};

console.log('Probing via real network…');
const t0 = Date.now();
let meta;
try {
  meta = await provider.getMetadata(url, ctx);
} catch (err) {
  console.error('PROBE FAILED:', err.message);
  process.exit(1);
}
console.log(`probe took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('type:', meta.type);

if (meta.type !== 'item') {
  console.error('expected a single item, got:', meta.type, meta.title, 'items:', meta.items?.length);
  process.exit(1);
}

console.log('title:', meta.title);
console.log('id:', meta.id);
console.log('duration:', meta.duration, 's');
console.log('uploader:', meta.uploader);
console.log('format options:', meta.options.length);
for (const o of meta.options.slice(0, 10)) console.log('  -', o.id, '|', o.label);

if (!wantDownload) {
  console.log('INTEGRATION PASS (probe)');
  process.exit(0);
}

const videoOpts = meta.options.filter((o) => o.kind === 'video');
const opt = videoOpts.length ? videoOpts[videoOpts.length - 1] : meta.options[0]; // smallest first in our ordering? pick lowest height
const chosen = [...videoOpts].sort((a, b) => Number(a.id.replace(/\D/g, '')) - Number(b.id.replace(/\D/g, '')))[0] || videoOpts[0] || opt;
const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-e2e-'));
console.log('downloading option:', chosen.id, '->', dest);

const handle = provider.startDownload(
  {
    url,
    destDir: dest,
    formatOption: chosen,
    expectedId: meta.id,
    onProgress: (ev) => {
      if (ev.type === 'progress' && ev.pct != null && Math.round(ev.pct) % 25 === 0 && Math.round(ev.pct) > 0) {
        console.log(`  progress ${Math.round(ev.pct)}%${ev.totalBytes ? ` of ${Math.round(ev.totalBytes / 1024)} KB` : ''}`);
      }
      if (ev.type === 'processing') console.log('  processing (merging/converting)…');
    }
  },
  ctx
);

try {
  const res = await handle.promise;
  const size = fs.statSync(res.path).size;
  if (!size) throw new Error('result file is empty');
  console.log('RESULT FILE:', res.path, `(${size} bytes)`);
  console.log('INTEGRATION PASS (probe + real download)');
  fs.rmSync(dest, { recursive: true, force: true });
  process.exit(0);
} catch (err) {
  console.error('DOWNLOAD FAILED:', err.message);
  fs.rmSync(dest, { recursive: true, force: true });
  process.exit(1);
}

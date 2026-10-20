/**
 * Download the official standalone yt-dlp executable into vendor/yt-dlp.
 * Usage: node scripts/setup-bins.mjs   (or: npm run setup-bins)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const win = process.platform === 'win32';
const name = win ? 'yt-dlp.exe' : 'yt-dlp';
const targetDir = path.join(root, 'vendor', 'yt-dlp');
const target = path.join(targetDir, name);

async function main() {
  console.log('MediaVault binary setup');
  console.log('────────────────────────');

  // yt-dlp
  if (fs.existsSync(target)) {
    console.log(`yt-dlp: already present at ${target}`);
  } else {
    console.log('yt-dlp: querying GitHub for latest release…');
    const rel = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { 'user-agent': 'mediavault-setup' }
    });
    if (!rel.ok) throw new Error(`GitHub API HTTP ${rel.status}`);
    const data = await rel.json();
    const entry = (data.assets || []).find((a) => a.name === name);
    if (!entry) throw new Error('yt-dlp executable not found in release assets');
    console.log(`yt-dlp: downloading ${entry.name} (${(entry.size / 1024 / 1024).toFixed(1)} MB)…`);
    const dl = await fetch(entry.browser_download_url, { headers: { 'user-agent': 'mediavault-setup' } });
    if (!dl.ok || !dl.body) throw new Error(`download failed HTTP ${dl.status}`);
    fs.mkdirSync(targetDir, { recursive: true });
    const tmp = `${target}.download`;
    const out = fs.createWriteStream(tmp);
    let received = 0;
    const reader = dl.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      out.write(Buffer.from(value));
      const pct = received % 524288 < value.byteLength ? Math.round((received / (entry.size || 1)) * 100) : null;
      if (pct != null) process.stdout.write(`\r  ${pct}% (${(received / 1024 / 1024).toFixed(1)} MB)`);
    }
    await new Promise((r) => out.end(() => r()));
    process.stdout.write('\n');
    fs.renameSync(tmp, target);
    if (!win) fs.chmodSync(target, 0o755);
    console.log('yt-dlp: installed');
  }

  // verify
  const { execFileSync } = await import('node:child_process');
  try {
    const v = execFileSync(target, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
    console.log(`yt-dlp: verified — ${v}`);
  } catch (err) {
    console.warn(`yt-dlp: installed but verification failed: ${err.message}`);
  }

  // ffmpeg/ffprobe come from npm packages (ffmpeg-static, ffprobe-static)
  const { createRequire } = await import('node:module');
  const req = createRequire(path.join(root, 'package.json'));
  try {
    const ffmpeg = req('ffmpeg-static');
    console.log(`ffmpeg: ${ffmpeg || 'NOT FOUND — reinstall dependencies'}`);
  } catch {
    console.warn('ffmpeg: ffmpeg-static package not resolvable — run npm install');
  }
  try {
    const ffprobe = req('ffprobe-static');
    console.log(`ffprobe: ${ffprobe?.path || 'NOT FOUND'}`);
  } catch {
    console.warn('ffprobe: ffprobe-static package not resolvable — run npm install');
  }

  console.log('────────────────────────');
  console.log('Done. Launch the app with: npm run dev');
}

main().catch((err) => {
  console.error(`setup failed: ${err.message}`);
  process.exit(1);
});

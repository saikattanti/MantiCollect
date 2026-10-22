import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const extDir = path.join(root, 'browser-extension');
const releaseDir = path.join(root, 'release');
const unpackedOut = path.join(releaseDir, 'browser-extension-unpacked');

async function main() {
  console.log('Packaging MantiCollect Browser Extension (Manifest V3)…');

  // 1. Validate manifest
  const manifestPath = path.join(extDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`✓ Manifest valid: ${manifest.name} v${manifest.version}`);

  // 2. Validate required assets
  const requiredFiles = [
    'manifest.json',
    'background.js',
    'popup.html',
    'popup.js',
    'popup.css',
    'icons/icon-16.png',
    'icons/icon-32.png',
    'icons/icon-48.png',
    'icons/icon-128.png'
  ];

  for (const f of requiredFiles) {
    const full = path.join(extDir, f);
    if (!fs.existsSync(full)) {
      throw new Error(`Missing required extension asset: ${f}`);
    }
  }
  console.log(`✓ All ${requiredFiles.length} required extension files verified`);

  // 3. Prepare clean unpacked distribution folder
  fs.mkdirSync(unpackedOut, { recursive: true });

  // Clean previous unpacked files
  for (const entry of fs.readdirSync(unpackedOut)) {
    fs.rmSync(path.join(unpackedOut, entry), { recursive: true, force: true });
  }

  // Copy files to unpacked directory
  for (const f of requiredFiles) {
    const src = path.join(extDir, f);
    const dst = path.join(unpackedOut, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  console.log(`✓ Unpacked distribution prepared at: ${unpackedOut}`);

  // 4. Create clean ZIP distribution package
  const zipName = `manticollect-browser-extension-v${manifest.version}.zip`;
  const zipPath = path.join(releaseDir, zipName);
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  const zipPromise = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);

  for (const f of requiredFiles) {
    archive.file(path.join(extDir, f), { name: f });
  }

  await archive.finalize();
  await zipPromise;

  const zipStat = fs.statSync(zipPath);
  console.log(`✓ Extension ZIP packaged successfully: ${zipPath} (${zipStat.size} bytes)`);
}

main().catch((err) => {
  console.error('Extension packaging failed:', err);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const sourceIcon = path.join(root, 'public', 'MantiCollect-fav-tr.png');
const assetsDir = path.join(root, 'electron', 'assets');

if (!fs.existsSync(sourceIcon)) {
  console.error(`Source icon not found at ${sourceIcon}`);
  process.exit(1);
}

fs.mkdirSync(assetsDir, { recursive: true });

async function createIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = count * dirEntrySize;
  let offset = headerSize + dirSize;

  const out = Buffer.alloc(offset + pngBuffers.reduce((sum, b) => sum + b.length, 0));

  // Write ICO header
  out.writeUInt16LE(0, 0); // Reserved
  out.writeUInt16LE(1, 2); // Type 1 = ICO
  out.writeUInt16LE(count, 4); // Count

  for (let i = 0; i < count; i++) {
    const size = sizes[i];
    const buf = pngBuffers[i];
    const entryOffset = headerSize + i * dirEntrySize;

    out.writeUInt8(size === 256 ? 0 : size, entryOffset + 0); // Width
    out.writeUInt8(size === 256 ? 0 : size, entryOffset + 1); // Height
    out.writeUInt8(0, entryOffset + 2); // Colors
    out.writeUInt8(0, entryOffset + 3); // Reserved
    out.writeUInt16LE(1, entryOffset + 4); // Color planes
    out.writeUInt16LE(32, entryOffset + 6); // Bits per pixel
    out.writeUInt32LE(buf.length, entryOffset + 8); // Image size
    out.writeUInt32LE(offset, entryOffset + 12); // Image offset

    buf.copy(out, offset);
    offset += buf.length;
  }

  return out;
}

async function main() {
  console.log('Generating MantiCollect brand asset derivatives from public/MantiCollect-fav-tr.png…');

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  for (const s of icoSizes) {
    const buf = await sharp(sourceIcon)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    pngBuffers.push(buf);
  }

  const icoBuf = await createIco(pngBuffers, icoSizes);
  const icoPath = path.join(assetsDir, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuf);
  console.log(`✓ Generated multi-res Windows ICO (${icoSizes.join(', ')}) -> ${icoPath} (${icoBuf.length} bytes)`);

  // High-res icon.png (256x256)
  const iconPng256 = await sharp(sourceIcon)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), iconPng256);
  console.log(`✓ Generated app icon.png (256x256)`);

  // Tray icons (16x16 and 32x32 @2x)
  const tray16 = await sharp(sourceIcon)
    .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), tray16);

  const tray32 = await sharp(sourceIcon)
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(assetsDir, 'tray-icon@2x.png'), tray32);
  console.log(`✓ Generated tray icons (16x16, 32x32)`);

  console.log('Branding derivative asset generation complete.');
}

main().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});

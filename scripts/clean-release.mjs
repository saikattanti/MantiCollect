import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releaseDir = path.join(__dirname, '..', 'release');

if (fs.existsSync(releaseDir)) {
  const targets = ['win-unpacked', 'win-unpacked.tmp', 'win-ia32-unpacked', 'builder-effective-config.yaml'];
  for (const target of targets) {
    const full = path.join(releaseDir, target);
    if (fs.existsSync(full)) {
      try {
        fs.rmSync(full, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        console.log(`Cleaned ${target}`);
      } catch (err) {
        console.warn(`Could not remove ${target}: ${err.message}`);
      }
    }
  }
}

/**
 * Smoke test: builds the renderer (if needed), launches Electron
 * with --smoke, and expects SMOKE_OK on stdout. Exit code 0 = app boots.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const distIndex = path.join(root, 'dist', 'index.html');
if (!fs.existsSync(distIndex)) {
  console.log('dist not found — building renderer…');
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) {
    console.error('Renderer build failed');
    process.exit(1);
  }
}

// resolve the real electron executable (no shell, no .cmd indirection)
const requireFromProject = createRequire(path.join(root, 'package.json'));
const electronExe = requireFromProject('electron');
if (!fs.existsSync(electronExe)) {
  console.error(`electron executable not found at ${electronExe}`);
  process.exit(1);
}

console.log('Launching Electron with --smoke…');
const child = spawn(electronExe, ['.', '--smoke'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));

const timer = setTimeout(() => {
  console.error('SMOKE TIMEOUT (30s)');
  try {
    child.kill();
  } catch {}
  process.exit(1);
}, 30000);

child.on('error', (e) => {
  clearTimeout(timer);
  console.error('SMOKE FAIL (spawn error):', e.message);
  process.exit(1);
});

child.on('close', (code) => {
  clearTimeout(timer);
  if (out.includes('SMOKE_OK') && code === 0) {
    console.log('SMOKE PASS — application window loaded');
    process.exit(0);
  } else {
    console.error('SMOKE FAIL');
    console.error('stdout:', out.slice(-2000));
    console.error('stderr:', err.slice(-2000));
    process.exit(1);
  }
});

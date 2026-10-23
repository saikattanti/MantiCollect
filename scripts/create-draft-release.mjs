#!/usr/bin/env node
/**
 * scripts/create-draft-release.mjs
 * Validates local distribution artifacts and optionally creates a draft GitHub Release using GitHub CLI.
 *
 * Usage:
 *   node scripts/create-draft-release.mjs --dry-run
 *   node scripts/create-draft-release.mjs --tag v0.1.0 --dry-run
 *   node scripts/create-draft-release.mjs --tag v0.1.0 --apply
 *
 * Safety:
 *   - Read-only by default (--dry-run).
 *   - Never publishes directly; only creates a DRAFT release.
 *   - Verifies package.json version against the tag.
 *   - Verifies required installer and extension ZIP exist before invoking gh.
 *   - Generates SHA256SUMS.txt if not already present.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkExistingRelease } from './check-existing-release.mjs';
import { verifyDraftRelease } from './verify-draft-release.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const releaseDir = path.join(root, 'release');

const args = process.argv.slice(2);
const isApply = args.includes('--apply');
const isDryRun = args.includes('--dry-run') || !isApply;

// Read version from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const defaultTag = `v${pkg.version}`;

let targetTag = defaultTag;
const tagIdx = args.indexOf('--tag');
if (tagIdx !== -1 && args[tagIdx + 1]) {
  targetTag = args[tagIdx + 1];
}

console.log(`Target Tag: ${targetTag} (package.json version: ${pkg.version})`);

if (targetTag !== `v${pkg.version}`) {
  console.warn(`[WARNING] Tag ${targetTag} does not match package.json version v${pkg.version}!`);
}

if (!fs.existsSync(releaseDir)) {
  console.error(`Release directory does not exist: ${releaseDir}`);
  console.error('Run `npm run dist` and `npm run package:extension` first.');
  process.exit(1);
}

// Find required artifacts
const files = fs.readdirSync(releaseDir);
const installer = files.find(f => f.startsWith('MantiCollect-Setup-') && f.endsWith('.exe'));
const extension = files.find(f => f.startsWith('manticollect-browser-extension-') && f.endsWith('.zip'));

console.log('\nArtifact Inspection:');
if (installer) {
  const stat = fs.statSync(path.join(releaseDir, installer));
  console.log(`  ✓ Installer: ${installer} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
} else {
  console.error('  ✗ Installer missing: MantiCollect-Setup-*.exe not found in release/');
}

if (extension) {
  const stat = fs.statSync(path.join(releaseDir, extension));
  console.log(`  ✓ Browser Extension: ${extension} (${(stat.size / 1024).toFixed(1)} KB)`);
} else {
  console.error('  ✗ Browser extension package missing in release/');
}

if (!installer || !extension) {
  console.error('\nBuild artifacts incomplete. Build artifacts with:');
  console.error('  npm run package:extension');
  console.error('  npm run dist\n');
  process.exit(1);
}

// Generate / verify checksums
console.log('\nGenerating SHA-256 Checksums:');
const artifactsToHash = [installer, extension];
const checksumLines = [];

for (const artifact of artifactsToHash) {
  const data = fs.readFileSync(path.join(releaseDir, artifact));
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  checksumLines.push(`${hash}  ${artifact}`);
  console.log(`  ${hash}  ${artifact}`);
}

const checksumFile = path.join(releaseDir, 'SHA256SUMS.txt');
fs.writeFileSync(checksumFile, checksumLines.join('\n') + '\n', 'utf8');
console.log(`  ✓ Written to: ${path.relative(root, checksumFile)}`);

const releaseNotes = `## MantiCollect ${targetTag} — A Mantitup Product

Local-first universal media downloader, format converter, and digital collector for Windows.

### Included Distributables
- **${installer}**: Windows NSIS desktop installer (per-user \`%LOCALAPPDATA%\\Programs\\MantiCollect\`).
- **${extension}**: Manifest V3 browser extension for Google Chrome and Microsoft Edge.
- **SHA256SUMS.txt**: SHA-256 integrity checksum manifest.

### Security & Integrity
- **Authenticode Status**: Unsigned development build (verify SHA-256 checksum)
- **Platform Compatibility**: Tested and verified on Windows 10/11 x64 (macOS and Linux are not officially validated).
- **Integrity Verification**: Compare downloaded files with \`SHA256SUMS.txt\` prior to installation.

*Note: This release is created as a draft for maintainer review. Publication requires explicit manual approval.*`;

if (isDryRun) {
  console.log('\n[DRY RUN MODE] The following `gh release create` command would be executed:');
  console.log(`  gh release create ${targetTag} \\`);
  console.log(`    release/${installer} \\`);
  console.log(`    release/${extension} \\`);
  console.log(`    release/SHA256SUMS.txt \\`);
  console.log(`    --repo saikattanti/MantiCollect \\`);
  console.log(`    --verify-tag \\`);
  console.log(`    --title "MantiCollect ${targetTag}" \\`);
  console.log(`    --draft`);
  console.log('\nTo create the draft release on GitHub:');
  console.log('  1. Authenticate with GitHub CLI: gh auth login');
  console.log(`  2. Run: node scripts/create-draft-release.mjs --tag ${targetTag} --apply\n`);
  process.exit(0);
}

// Apply mode
try {
  execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
} catch {
  console.error('GitHub CLI is not authenticated. Please run `gh auth login` first.');
  process.exit(1);
}

// Check if release already exists on GitHub
const checkResult = checkExistingRelease({ tag: targetTag, repo: 'saikattanti/MantiCollect' });
if (checkResult.status === 'EXISTS') {
  console.error(`\n[ERROR] A release for tag ${targetTag} already exists on GitHub. Aborting to avoid overwrite.`);
  process.exit(1);
} else if (checkResult.status !== 'NOT_FOUND') {
  console.error(`\n[ERROR] Failed to verify release status for ${targetTag}: ${checkResult.message}`);
  process.exit(2);
}
console.log(`  ✓ Verified: No existing release for ${targetTag} on GitHub.`);

console.log(`\n[APPLY MODE] Creating DRAFT release ${targetTag} on GitHub...`);
try {
  const ghArgs = [
    'release', 'create', targetTag,
    path.join(releaseDir, installer),
    path.join(releaseDir, extension),
    checksumFile,
    '--repo', 'saikattanti/MantiCollect',
    '--verify-tag',
    '--title', `MantiCollect ${targetTag}`,
    '--draft',
    '--notes', releaseNotes
  ];
  const out = execFileSync('gh', ghArgs, { encoding: 'utf8' });
  console.log(`gh release create completed: ${out.trim()}`);

  console.log('\n[VERIFICATION] Verifying created Draft Release on GitHub...');
  const verifyResult = verifyDraftRelease({
    tag: targetTag,
    repo: 'saikattanti/MantiCollect',
    expectedAssets: [installer, extension, 'SHA256SUMS.txt']
  });

  if (!verifyResult.valid) {
    console.error(`\n[ERROR] Draft release verification FAILED: ${verifyResult.message}`);
    process.exit(1);
  }

  console.log(`\n✓ SUCCESS: ${verifyResult.message}`);
  if (verifyResult.details?.url) {
    console.log(`Draft Release URL: ${verifyResult.details.url}`);
  }
} catch (err) {
  console.error(`FAILED to create draft release: ${err.message}`);
  process.exit(1);
}

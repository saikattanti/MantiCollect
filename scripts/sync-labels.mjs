#!/usr/bin/env node
/**
 * scripts/sync-labels.mjs
 * Syncs GitHub labels from .github/labels.yml using GitHub CLI (gh).
 *
 * Usage:
 *   node scripts/sync-labels.mjs --dry-run
 *   node scripts/sync-labels.mjs --apply
 *
 * Safety:
 *   - Read-only by default (--dry-run).
 *   - Requires explicit --apply flag to execute changes.
 *   - Does not store credentials or secrets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const labelsFile = path.join(root, '.github', 'labels.yml');

const isApply = process.argv.includes('--apply');
const isDryRun = process.argv.includes('--dry-run') || !isApply;

if (!fs.existsSync(labelsFile)) {
  console.error(`Labels file not found: ${labelsFile}`);
  process.exit(1);
}

// Simple YAML parser for list of name, color, description objects
function parseLabelsYaml(content) {
  const labels = [];
  const entries = content.split(/(?:^|\n)-\s+name:\s*/).filter(Boolean);

  for (const entry of entries) {
    const lines = entry.split('\n');
    let name = lines[0].trim().replace(/^["']|["']$/g, '');
    let color = '';
    let description = '';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('color:')) {
        color = line.replace('color:', '').trim().replace(/^["']|["']$/g, '');
      } else if (line.startsWith('description:')) {
        description = line.replace('description:', '').trim().replace(/^["']|["']$/g, '');
      }
    }

    if (name && color) {
      labels.push({ name, color, description });
    }
  }

  return labels;
}

const yamlContent = fs.readFileSync(labelsFile, 'utf8');
const labels = parseLabelsYaml(yamlContent);

console.log(`Parsed ${labels.length} labels from .github/labels.yml`);

if (isDryRun) {
  console.log('\n[DRY RUN MODE] The following labels would be synced via `gh label create`:');
  for (const label of labels) {
    console.log(`  • "${label.name}" (color: #${label.color}) - ${label.description}`);
  }
  console.log('\nTo apply these labels to the remote GitHub repository:');
  console.log('  1. Authenticate with GitHub CLI: gh auth login');
  console.log('  2. Run: node scripts/sync-labels.mjs --apply\n');
  process.exit(0);
}

// Check if gh is authenticated
try {
  execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
} catch {
  console.error('GitHub CLI is not authenticated. Please run `gh auth login` first.');
  process.exit(1);
}

console.log('\n[APPLY MODE] Provisioning labels to remote GitHub repository...');
let created = 0;
let failed = 0;

for (const label of labels) {
  try {
    process.stdout.write(`Syncing "${label.name}"... `);
    execFileSync('gh', [
      'label', 'create', label.name,
      '--color', label.color,
      '--description', label.description,
      '--force'
    ], { stdio: 'pipe' });
    console.log('OK');
    created++;
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    failed++;
  }
}

console.log(`\nSync complete: ${created} applied, ${failed} failed.`);

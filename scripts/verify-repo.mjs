#!/usr/bin/env node
/**
 * scripts/verify-repo.mjs
 * Comprehensive repository hygiene and validation script.
 * Validates markdown links, image references, YAML syntax, and hygiene.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

let totalChecks = 0;
let errors = 0;

function pass(msg) {
  totalChecks++;
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  totalChecks++;
  errors++;
  console.error(`  ✗ ${msg}`);
}

console.log('1. Checking YAML syntax in .github/ ...');
function validateYamlInDir(dir) {
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      validateYamlInDir(full);
    } else if (full.endsWith('.yml') || full.endsWith('.yaml')) {
      try {
        yaml.load(fs.readFileSync(full, 'utf8'));
        pass(`YAML parsed: ${path.relative(root, full)}`);
      } catch (err) {
        fail(`YAML syntax error in ${path.relative(root, full)}: ${err.message}`);
      }
    }
  }
}
validateYamlInDir(path.join(root, '.github'));

console.log('\n2. Checking README links and images ...');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

// Check markdown links [text](path)
const mdLinks = readme.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
for (const match of mdLinks) {
  const href = match[2];
  if (!href.startsWith('http') && !href.startsWith('#')) {
    const target = href.split('#')[0];
    if (target) {
      const full = path.join(root, target);
      if (fs.existsSync(full)) {
        pass(`Link target exists: ${target}`);
      } else {
        fail(`Broken link: ${target} in [${match[1]}]`);
      }
    }
  }
}

// Check <img> src attributes
const imgMatches = readme.matchAll(/src="([^"]+)"/g);
for (const match of imgMatches) {
  const src = match[1];
  if (!src.startsWith('http')) {
    const full = path.join(root, src);
    if (fs.existsSync(full)) {
      pass(`Image file exists: ${src}`);
    } else {
      fail(`Broken image reference: ${src}`);
    }
  } else {
    pass(`Remote image/badge URL: ${src.substring(0, 60)}...`);
  }
}

console.log('\n3. Checking Repository Hygiene & Sensitive Files ...');
const forbiddenPatterns = [
  '.env',
  '.env.local',
  'mediavault.db',
  'credentials.enc',
  'id_rsa',
  'id_ed25519'
];

for (const pattern of forbiddenPatterns) {
  const rootFile = path.join(root, pattern);
  if (fs.existsSync(rootFile)) {
    fail(`Accidental sensitive file found in repository root: ${pattern}`);
  } else {
    pass(`No root file for ${pattern}`);
  }
}

console.log('\n4. Checking Core Repository Files ...');
const requiredFiles = [
  'LICENSE',
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'SUPPORT.md',
  'CHANGELOG.md',
  '.gitattributes',
  '.editorconfig',
  '.gitignore',
  'package.json',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/labels.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/documentation_improvement.yml',
  'docs/screenshots/README.md'
];

for (const file of requiredFiles) {
  const full = path.join(root, file);
  if (fs.existsSync(full)) {
    pass(`Required file exists: ${file}`);
  } else {
    fail(`Missing required file: ${file}`);
  }
}

console.log(`\n========================================`);
console.log(`Validation complete: ${totalChecks - errors}/${totalChecks} checks passed.`);
if (errors > 0) {
  console.error(`FAILED: ${errors} errors detected.`);
  process.exit(1);
} else {
  console.log(`SUCCESS: All repository checks passed cleanly!`);
}

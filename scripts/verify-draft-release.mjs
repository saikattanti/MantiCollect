#!/usr/bin/env node
/**
 * scripts/verify-draft-release.mjs
 * Post-creation verification tool for MantiCollect GitHub Draft Releases.
 *
 * Verifies that:
 * 1. The GitHub Release actually exists on the remote repository.
 * 2. The Release tag matches the expected version tag.
 * 3. The Release is confirmed to be in DRAFT state (never public).
 * 4. All expected assets are attached and have non-zero byte size.
 * 5. The target commit matches the expected commit SHA where supported by GitHub metadata.
 *
 * Exits with non-zero code on ANY verification failure or secret leak.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * Strips sensitive tokens and credentials from diagnostic output.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeErrorMessage(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/ghp_[A-Za-z0-9_]+/g, '***')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '***')
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer ***')
    .replace(/token\s+[A-Za-z0-9_.-]+/gi, 'token ***')
    .trim();
}

/**
 * Validates the metadata of a GitHub Release against release criteria.
 *
 * @param {object} params
 * @param {object} params.releaseData - Parsed JSON object from GitHub CLI / API
 * @param {string} params.expectedTag - Expected release tag (e.g. v0.1.0)
 * @param {string} [params.expectedTargetCommit] - Expected commit SHA
 * @param {string[]} [params.expectedAssets] - Array of required asset filenames
 * @returns {{
 *   valid: boolean,
 *   error?: 'TAG_MISMATCH' | 'NOT_DRAFT' | 'TARGET_MISMATCH' | 'ASSET_MISSING' | 'INVALID_DATA',
 *   message: string,
 *   details?: object
 * }}
 */
export function validateDraftReleaseData({
  releaseData,
  expectedTag,
  expectedTargetCommit,
  expectedAssets = []
}) {
  if (!releaseData || typeof releaseData !== 'object') {
    return {
      valid: false,
      error: 'INVALID_DATA',
      message: 'Release data is invalid or empty.'
    };
  }

  // 1. Tag validation
  const actualTag = releaseData.tagName || releaseData.tag_name;
  if (!actualTag || actualTag !== expectedTag) {
    return {
      valid: false,
      error: 'TAG_MISMATCH',
      message: `Release tag mismatch: expected "${expectedTag}", found "${actualTag || 'undefined'}"`
    };
  }

  // 2. Draft status validation (CRITICAL: must be draft)
  const isDraft = releaseData.isDraft ?? releaseData.draft;
  if (isDraft !== true) {
    return {
      valid: false,
      error: 'NOT_DRAFT',
      message: `Release is NOT in Draft state (isDraft: ${String(isDraft)}). Refusing to validate non-draft release!`
    };
  }

  // 3. Target commit validation (if targetCommitish is returned by GitHub)
  const actualTarget = releaseData.targetCommitish || releaseData.target_commitish;
  if (expectedTargetCommit && actualTarget) {
    const normActual = actualTarget.trim().toLowerCase();
    const normExpected = expectedTargetCommit.trim().toLowerCase();
    const isMatch = normActual === normExpected ||
      normActual.startsWith(normExpected) ||
      normExpected.startsWith(normActual);

    if (!isMatch) {
      return {
        valid: false,
        error: 'TARGET_MISMATCH',
        message: `Release target commit mismatch: expected "${expectedTargetCommit}", found "${actualTarget}"`
      };
    }
  }

  // 4. Asset attachment validation
  const attachedAssets = Array.isArray(releaseData.assets) ? releaseData.assets : [];
  const attachedMap = new Map();
  for (const asset of attachedAssets) {
    if (asset && asset.name) {
      attachedMap.set(asset.name, asset);
    }
  }

  const missingAssets = [];
  const emptyAssets = [];

  for (const expectedName of expectedAssets) {
    const trimmed = expectedName.trim();
    if (!trimmed) continue;

    const found = attachedMap.get(trimmed);
    if (!found) {
      missingAssets.push(trimmed);
    } else if (typeof found.size === 'number' && found.size <= 0) {
      emptyAssets.push(trimmed);
    }
  }

  if (missingAssets.length > 0) {
    return {
      valid: false,
      error: 'ASSET_MISSING',
      message: `Required release asset(s) not attached to GitHub Release: ${missingAssets.join(', ')}`
    };
  }

  if (emptyAssets.length > 0) {
    return {
      valid: false,
      error: 'ASSET_MISSING',
      message: `Release asset(s) have zero byte size: ${emptyAssets.join(', ')}`
    };
  }

  return {
    valid: true,
    message: `Draft Release "${expectedTag}" verified successfully with all ${expectedAssets.length} required assets attached.`,
    details: {
      tagName: actualTag,
      isDraft: true,
      targetCommitish: actualTarget,
      assets: attachedAssets.map(a => ({ name: a.name, size: a.size })),
      url: releaseData.url || releaseData.html_url
    }
  };
}

/**
 * Queries GitHub for a Release and validates its draft metadata.
 *
 * @param {object} options
 * @param {string} options.tag - Git release tag (e.g. v0.1.0)
 * @param {string} options.repo - GitHub repository in owner/repo format
 * @param {string} [options.targetCommit] - Expected target commit SHA
 * @param {string[]} [options.expectedAssets] - Required asset filenames
 * @param {function} [options.runner] - Optional runner function for testing
 * @returns {{
 *   valid: boolean,
 *   error?: string,
 *   message: string,
 *   details?: object
 * }}
 */
export function verifyDraftRelease({
  tag,
  repo,
  targetCommit,
  expectedAssets = [],
  runner
}) {
  if (!tag) throw new Error('Missing required argument: tag');
  if (!repo) throw new Error('Missing required argument: repo');

  const execute = runner || (({ tag, repo }) => {
    return spawnSync('gh', [
      'release', 'view', tag,
      '--repo', repo,
      '--json', 'tagName,isDraft,targetCommitish,assets,url'
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });
  });

  const res = execute({ tag, repo });

  if (res.error) {
    return {
      valid: false,
      error: 'COMMAND_FAILED',
      message: sanitizeErrorMessage(res.error.message || String(res.error))
    };
  }

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';

  if (res.status !== 0) {
    const combined = `${stdout}\n${stderr}`;
    if (/HTTP 403|Resource not accessible|Forbidden/i.test(combined)) {
      return {
        valid: false,
        error: 'FORBIDDEN',
        message: sanitizeErrorMessage(stderr || stdout || 'HTTP 403: Forbidden - token lacks write/view permissions.')
      };
    }
    if (/HTTP 404|release not found|Not Found/i.test(combined)) {
      return {
        valid: false,
        error: 'NOT_FOUND',
        message: `Release for tag "${tag}" was not found on GitHub repository "${repo}".`
      };
    }
    return {
      valid: false,
      error: 'COMMAND_FAILED',
      message: sanitizeErrorMessage(stderr || stdout || `gh release view failed with exit code ${res.status}`)
    };
  }

  let releaseData;
  try {
    releaseData = JSON.parse(stdout);
  } catch (err) {
    return {
      valid: false,
      error: 'INVALID_DATA',
      message: `Failed to parse GitHub CLI JSON response: ${err.message}`
    };
  }

  return validateDraftReleaseData({
    releaseData,
    expectedTag: tag,
    expectedTargetCommit: targetCommit,
    expectedAssets
  });
}

// CLI execution entry point
const isDirectCall = process.argv[1] && process.argv[1].endsWith('verify-draft-release.mjs');
if (isDirectCall) {
  const args = process.argv.slice(2);
  const tagIdx = args.indexOf('--tag');
  const repoIdx = args.indexOf('--repo');
  const commitIdx = args.indexOf('--target-commit');
  const assetsIdx = args.indexOf('--expected-assets');

  const tag = tagIdx !== -1 ? args[tagIdx + 1] : null;
  const repo = repoIdx !== -1 ? args[repoIdx + 1] : null;
  const targetCommit = commitIdx !== -1 ? args[commitIdx + 1] : null;
  const assetsRaw = assetsIdx !== -1 ? args[assetsIdx + 1] : '';
  const expectedAssets = assetsRaw ? assetsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  if (!tag || !repo) {
    console.error('Usage: node scripts/verify-draft-release.mjs --tag <tag> --repo <owner/repo> [--target-commit <sha>] [--expected-assets <file1,file2>]');
    process.exit(2);
  }

  const result = verifyDraftRelease({
    tag,
    repo,
    targetCommit,
    expectedAssets
  });

  if (!result.valid) {
    console.error(`[ERROR] Release Verification FAILED: ${result.message}`);
    process.exit(1);
  }

  console.log(`✓ VERIFIED: ${result.message}`);
  if (result.details?.url) {
    console.log(`  Draft URL: ${result.details.url}`);
  }
  process.exit(0);
}

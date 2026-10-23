import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateDraftReleaseData,
  verifyDraftRelease,
  sanitizeErrorMessage
} from '../scripts/verify-draft-release.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, '..', 'scripts', 'verify-draft-release.mjs');

describe('Draft Release Post-Creation Verification Tests', () => {
  const validReleaseData = {
    tagName: 'v0.1.0',
    isDraft: true,
    targetCommitish: 'b87e76fd92cb13dcff74235b4e54cc0c3e65923a',
    url: 'https://github.com/saikattanti/MantiCollect/releases/tag/v0.1.0',
    assets: [
      { name: 'MantiCollect-Setup-0.1.0.exe', size: 261962560 },
      { name: 'manticollect-browser-extension-v1.0.0.zip', size: 42789 },
      { name: 'SHA256SUMS.txt', size: 196 }
    ]
  };

  test('validates successfully when draft is true, tag matches, target matches, and all assets attached', () => {
    const result = validateDraftReleaseData({
      releaseData: validReleaseData,
      expectedTag: 'v0.1.0',
      expectedTargetCommit: 'b87e76fd92cb13dcff74235b4e54cc0c3e65923a',
      expectedAssets: [
        'MantiCollect-Setup-0.1.0.exe',
        'manticollect-browser-extension-v1.0.0.zip',
        'SHA256SUMS.txt'
      ]
    });

    assert.equal(result.valid, true);
    assert.match(result.message, /verified successfully/i);
    assert.equal(result.details?.tagName, 'v0.1.0');
    assert.equal(result.details?.isDraft, true);
  });

  test('fails verification when release tag does not match expected tag', () => {
    const result = validateDraftReleaseData({
      releaseData: { ...validReleaseData, tagName: 'v0.2.0' },
      expectedTag: 'v0.1.0',
      expectedAssets: []
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'TAG_MISMATCH');
    assert.match(result.message, /tag mismatch/i);
  });

  test('fails verification when release is NOT in Draft state (isDraft: false)', () => {
    const result = validateDraftReleaseData({
      releaseData: { ...validReleaseData, isDraft: false },
      expectedTag: 'v0.1.0',
      expectedAssets: []
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'NOT_DRAFT');
    assert.match(result.message, /NOT in Draft state/i);
  });

  test('fails verification when expected target commit does not match', () => {
    const result = validateDraftReleaseData({
      releaseData: { ...validReleaseData, targetCommitish: 'deadbeef1234567890' },
      expectedTag: 'v0.1.0',
      expectedTargetCommit: 'b87e76fd92cb13dcff74235b4e54cc0c3e65923a',
      expectedAssets: []
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'TARGET_MISMATCH');
    assert.match(result.message, /target commit mismatch/i);
  });

  test('fails verification when an expected asset is missing from attached assets', () => {
    const result = validateDraftReleaseData({
      releaseData: {
        ...validReleaseData,
        assets: [
          { name: 'MantiCollect-Setup-0.1.0.exe', size: 261962560 },
          { name: 'SHA256SUMS.txt', size: 196 }
        ]
      },
      expectedTag: 'v0.1.0',
      expectedAssets: [
        'MantiCollect-Setup-0.1.0.exe',
        'manticollect-browser-extension-v1.0.0.zip',
        'SHA256SUMS.txt'
      ]
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'ASSET_MISSING');
    assert.match(result.message, /manticollect-browser-extension-v1\.0\.0\.zip/);
  });

  test('fails verification when an attached asset has 0 byte size', () => {
    const result = validateDraftReleaseData({
      releaseData: {
        ...validReleaseData,
        assets: [
          { name: 'MantiCollect-Setup-0.1.0.exe', size: 0 },
          { name: 'manticollect-browser-extension-v1.0.0.zip', size: 42789 },
          { name: 'SHA256SUMS.txt', size: 196 }
        ]
      },
      expectedTag: 'v0.1.0',
      expectedAssets: ['MantiCollect-Setup-0.1.0.exe']
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'ASSET_MISSING');
    assert.match(result.message, /zero byte size/i);
  });

  test('verifyDraftRelease handles HTTP 403 Forbidden without swallowing error', () => {
    const mockRunner = () => ({
      status: 1,
      stdout: '',
      stderr: 'HTTP 403: Resource not accessible by integration (https://api.github.com/repos/saikattanti/MantiCollect/releases)'
    });

    const result = verifyDraftRelease({
      tag: 'v0.1.0',
      repo: 'saikattanti/MantiCollect',
      runner: mockRunner
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'FORBIDDEN');
    assert.match(result.message, /403/);
  });

  test('verifyDraftRelease handles release not found after creation', () => {
    const mockRunner = () => ({
      status: 1,
      stdout: '',
      stderr: 'release not found'
    });

    const result = verifyDraftRelease({
      tag: 'v0.1.0',
      repo: 'saikattanti/MantiCollect',
      runner: mockRunner
    });

    assert.equal(result.valid, false);
    assert.equal(result.error, 'NOT_FOUND');
    assert.match(result.message, /not found/i);
  });

  test('sanitizes personal access tokens and Bearer headers in errors', () => {
    const dirty = 'Error 403 with token ghp_SECRET_123456 and Authorization: Bearer github_pat_SUPER_SECRET';
    const clean = sanitizeErrorMessage(dirty);

    assert.doesNotMatch(clean, /ghp_SECRET_123456/);
    assert.doesNotMatch(clean, /github_pat_SUPER_SECRET/);
    assert.match(clean, /\*\*\*/);
  });

  test('CLI interface exits 2 on missing required arguments', () => {
    const proc = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
    assert.equal(proc.status, 2);
    assert.match(proc.stderr, /Usage:/);
  });
});

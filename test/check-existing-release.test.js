import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateReleaseCheckResult,
  checkExistingRelease,
  sanitizeErrorMessage
} from '../scripts/check-existing-release.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, '..', 'scripts', 'check-existing-release.mjs');

describe('Release Existence and Duplicate Detection Unit Tests', () => {
  test('returns EXISTS when GitHub API responds with HTTP 200 and release JSON', () => {
    const mockOutput = JSON.stringify({
      id: 123456,
      tag_name: 'v0.1.0',
      name: 'MantiCollect v0.1.0',
      html_url: 'https://github.com/saikattanti/MantiCollect/releases/tag/v0.1.0',
      draft: true
    });

    const result = evaluateReleaseCheckResult({
      status: 0,
      stdout: mockOutput,
      stderr: ''
    });

    assert.equal(result.status, 'EXISTS');
    assert.equal(result.release?.id, 123456);
    assert.equal(result.release?.tagName, 'v0.1.0');
    assert.equal(result.release?.htmlUrl, 'https://github.com/saikattanti/MantiCollect/releases/tag/v0.1.0');
  });

  test('returns EXISTS when non-JSON success output is returned', () => {
    const result = evaluateReleaseCheckResult({
      status: 0,
      stdout: 'MantiCollect v0.1.0\nDraft release',
      stderr: ''
    });

    assert.equal(result.status, 'EXISTS');
    assert.equal(result.release?.name, 'MantiCollect v0.1.0');
  });

  test('returns NOT_FOUND when GitHub API responds with JSON 404', () => {
    const mockStdout = JSON.stringify({
      message: 'Not Found',
      documentation_url: 'https://docs.github.com/rest/releases/releases#get-a-release-by-tag-name',
      status: '404'
    });
    const mockStderr = 'gh: Not Found (HTTP 404)\n';

    const result = evaluateReleaseCheckResult({
      status: 1,
      stdout: mockStdout,
      stderr: mockStderr
    });

    assert.equal(result.status, 'NOT_FOUND');
  });

  test('returns NOT_FOUND when GitHub CLI returns "release not found"', () => {
    const result = evaluateReleaseCheckResult({
      status: 1,
      stdout: '',
      stderr: 'release not found\n'
    });

    assert.equal(result.status, 'NOT_FOUND');
  });

  test('returns AUTH_ERROR on HTTP 401 Bad credentials', () => {
    const result = evaluateReleaseCheckResult({
      status: 1,
      stdout: '{"message":"Bad credentials"}',
      stderr: 'gh: Bad credentials (HTTP 401)\n'
    });

    assert.equal(result.status, 'AUTH_ERROR');
    assert.match(result.message, /Bad credentials|401/);
  });

  test('returns AUTH_ERROR on HTTP 403 Resource not accessible', () => {
    const result = evaluateReleaseCheckResult({
      status: 1,
      stdout: '{"message":"Resource not accessible by integration"}',
      stderr: 'gh: Resource not accessible by integration (HTTP 403)\n'
    });

    assert.equal(result.status, 'AUTH_ERROR');
    assert.match(result.message, /Resource not accessible|403/);
  });

  test('returns NETWORK_ERROR on connection failure or 500 server error', () => {
    const result = evaluateReleaseCheckResult({
      status: 1,
      stdout: '',
      stderr: 'dial tcp: lookup api.github.com: no such host (connection refused)'
    });

    assert.equal(result.status, 'NETWORK_ERROR');
    assert.match(result.message, /connection refused|lookup/);
  });

  test('returns UNEXPECTED_ERROR on unexpected failure', () => {
    const result = evaluateReleaseCheckResult({
      status: 127,
      stdout: '',
      stderr: 'gh: command not found'
    });

    assert.equal(result.status, 'UNEXPECTED_ERROR');
    assert.match(result.message, /command not found/);
  });

  test('sanitizes personal access tokens and Bearer credentials from messages', () => {
    const leakyText = 'Error connecting with token ghp_ABC123secretToken_XYZ and Bearer ghp_99999999999';
    const sanitized = sanitizeErrorMessage(leakyText);

    assert.doesNotMatch(sanitized, /ghp_ABC123secretToken_XYZ/);
    assert.doesNotMatch(sanitized, /ghp_99999999999/);
    assert.match(sanitized, /\*\*\*/);
  });

  test('checkExistingRelease uses custom runner deterministically', () => {
    let capturedArgs = null;
    const mockRunner = (args) => {
      capturedArgs = args;
      return {
        status: 1,
        stdout: JSON.stringify({ message: 'Not Found', status: '404' }),
        stderr: 'gh: Not Found (HTTP 404)'
      };
    };

    const res = checkExistingRelease({
      tag: 'v0.1.0',
      repo: 'saikattanti/MantiCollect',
      runner: mockRunner
    });

    assert.deepEqual(capturedArgs, { tag: 'v0.1.0', repo: 'saikattanti/MantiCollect' });
    assert.equal(res.status, 'NOT_FOUND');
  });

  test('CLI interface exits 2 when arguments are missing', () => {
    const proc = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
    assert.equal(proc.status, 2);
    assert.match(proc.stderr, /Usage:/);
  });
});

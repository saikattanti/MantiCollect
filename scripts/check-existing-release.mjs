#!/usr/bin/env node
/**
 * scripts/check-existing-release.mjs
 * Robust duplicate release detector for MantiCollect CI/CD and release tooling.
 *
 * Verifies whether a GitHub Release already exists for a target tag.
 * Distinguishes true 404 (release does not exist) from auth errors, permission
 * errors, rate limits, and network failures without leaking secrets.
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
 * Evaluates the result of a GitHub CLI / API query for release existence.
 *
 * @param {object} params
 * @param {number|null} params.status - Exit code of the command (0 = success)
 * @param {string} params.stdout - Standard output
 * @param {string} params.stderr - Standard error
 * @param {Error|null} [params.error] - Process execution error, if any
 * @returns {{
 *   status: 'EXISTS' | 'NOT_FOUND' | 'AUTH_ERROR' | 'NETWORK_ERROR' | 'UNEXPECTED_ERROR',
 *   release?: { id?: number, name?: string, htmlUrl?: string, tagName?: string, draft?: boolean },
 *   message?: string
 * }}
 */
export function evaluateReleaseCheckResult({ status, stdout = '', stderr = '', error = null }) {
  if (error) {
    return {
      status: 'UNEXPECTED_ERROR',
      message: sanitizeErrorMessage(error.message || String(error))
    };
  }

  // If command succeeded (HTTP 200), release already exists!
  if (status === 0) {
    try {
      const data = JSON.parse(stdout);
      return {
        status: 'EXISTS',
        release: {
          id: data.id,
          name: data.name,
          htmlUrl: data.html_url,
          tagName: data.tag_name,
          draft: Boolean(data.draft)
        }
      };
    } catch {
      // If stdout was not JSON (e.g. raw gh release view output), release still exists
      return {
        status: 'EXISTS',
        release: {
          name: stdout.trim().split('\n')[0] || 'Existing Release'
        }
      };
    }
  }

  // Non-zero status: determine whether this is an unambiguous 404 (Not Found)
  const combinedOutput = `${stdout}\n${stderr}`;

  // 1. Check for JSON 404 response
  let json404 = false;
  try {
    const data = JSON.parse(stdout);
    if (data.status === '404' || data.status === 404 || data.message === 'Not Found') {
      json404 = true;
    }
  } catch {
    // Not valid JSON in stdout, check stderr/text
  }

  // 2. Check for textual 404 indicators
  const isText404 = /HTTP 404|release not found|"Not Found"|status.*404/i.test(combinedOutput);

  if (json404 || isText404) {
    return { status: 'NOT_FOUND' };
  }

  // 3. Check for authentication or authorization errors (401 / 403)
  const isAuthError = /HTTP 401|HTTP 403|bad credentials|Resource not accessible|gh auth login|Unauthorized|Forbidden/i.test(combinedOutput);
  if (isAuthError) {
    return {
      status: 'AUTH_ERROR',
      message: sanitizeErrorMessage(stderr || stdout || 'GitHub authentication or permission error')
    };
  }

  // 4. Check for network, DNS, or server errors (5xx, timeouts, connection refused)
  const isNetworkError = /HTTP 5[0-9]{2}|connection refused|dial tcp|lookup|timeout|EAI_AGAIN|ECONNRESET|network/i.test(combinedOutput);
  if (isNetworkError) {
    return {
      status: 'NETWORK_ERROR',
      message: sanitizeErrorMessage(stderr || stdout || 'Network or GitHub server error')
    };
  }

  // 5. Any other unexpected failure
  return {
    status: 'UNEXPECTED_ERROR',
    message: sanitizeErrorMessage(stderr || stdout || `Process failed with exit code ${status}`)
  };
}

/**
 * Checks if a release exists on GitHub for the given tag and repo.
 *
 * @param {object} options
 * @param {string} options.tag - Git release tag (e.g. v0.1.0)
 * @param {string} options.repo - GitHub repository in owner/repo format
 * @param {function} [options.runner] - Optional runner function for testing
 * @returns {{
 *   status: 'EXISTS' | 'NOT_FOUND' | 'AUTH_ERROR' | 'NETWORK_ERROR' | 'UNEXPECTED_ERROR',
 *   release?: object,
 *   message?: string
 * }}
 */
export function checkExistingRelease({ tag, repo, runner }) {
  if (!tag) throw new Error('Missing required argument: tag');
  if (!repo) throw new Error('Missing required argument: repo');

  const execute = runner || (({ tag, repo }) => {
    return spawnSync('gh', ['api', `repos/${repo}/releases/tags/${tag}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });
  });

  const res = execute({ tag, repo });
  return evaluateReleaseCheckResult({
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error || null
  });
}

// CLI execution entry point
const isDirectCall = process.argv[1] && process.argv[1].endsWith('check-existing-release.mjs');
if (isDirectCall) {
  const args = process.argv.slice(2);
  const tagIdx = args.indexOf('--tag');
  const repoIdx = args.indexOf('--repo');

  const tag = tagIdx !== -1 ? args[tagIdx + 1] : null;
  const repo = repoIdx !== -1 ? args[repoIdx + 1] : null;

  if (!tag || !repo) {
    console.error('Usage: node scripts/check-existing-release.mjs --tag <tag> --repo <owner/repo>');
    process.exit(2);
  }

  const result = checkExistingRelease({ tag, repo });

  switch (result.status) {
    case 'NOT_FOUND':
      console.log(`✓ Verified: No existing release for tag "${tag}" on ${repo}. Safe to proceed.`);
      process.exit(0);
      break;

    case 'EXISTS': {
      const url = result.release?.htmlUrl ? ` (${result.release.htmlUrl})` : '';
      console.error(`[ERROR] A release for tag "${tag}" already exists on GitHub${url}! Aborting to prevent duplicate release.`);
      process.exit(1);
      break;
    }

    case 'AUTH_ERROR':
      console.error(`[ERROR] GitHub authentication/permission error checking release for "${tag}": ${result.message}`);
      process.exit(2);
      break;

    case 'NETWORK_ERROR':
      console.error(`[ERROR] Network or server error querying GitHub for tag "${tag}": ${result.message}`);
      process.exit(2);
      break;

    case 'UNEXPECTED_ERROR':
    default:
      console.error(`[ERROR] Unexpected error verifying release for tag "${tag}": ${result.message}`);
      process.exit(2);
      break;
  }
}

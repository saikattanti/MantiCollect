import { assertPublicUrl, normalizeUrlInput } from '../security.js';
import { resolveProvider } from '../providers/registry.js';
import { logger } from '../logger.js';

export const MAX_URL_LENGTH = 4096;
export const MAX_METADATA_LENGTH = 500;

/**
 * Validates and sanitizes a URL and metadata submitted from an external/browser boundary.
 *
 * Requirements:
 * - Reject empty or non-string inputs.
 * - Enforce maximum URL length (4096 chars).
 * - Restrict scheme strictly to http: and https:.
 * - Reject embedded credentials (http://user:pass@host/).
 * - Enforce SSRF protection via assertPublicUrl.
 * - Verify a valid download provider is available.
 * - Reject filesystem path injection or parameter tampering.
 */
export async function validateBrowserSubmission(payload, { allowLocal = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid request payload');
  }

  const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
  if (!rawUrl) {
    throw new Error('URL is required');
  }

  if (rawUrl.length > MAX_URL_LENGTH) {
    throw new Error(`URL exceeds maximum length of ${MAX_URL_LENGTH} characters`);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Malformed URL');
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'http:' && scheme !== 'https:') {
    throw new Error(`Unsupported URL scheme "${scheme}". Only HTTP and HTTPS are permitted.`);
  }

  // Reject embedded credentials
  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed for security reasons.');
  }

  const normalized = normalizeUrlInput(rawUrl);
  await assertPublicUrl(normalized, { allowLocal });

  const provider = resolveProvider(normalized);
  if (!provider) {
    throw new Error('No supported download provider found for this URL.');
  }

  // Validate optional metadata cleanly without allowing arbitrary filesystem path overrides
  const title =
    typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim().slice(0, 300)
      : null;

  const format =
    typeof payload.format === 'string' && payload.format.trim()
      ? payload.format.trim().slice(0, 100)
      : null;

  const requestId =
    typeof payload.requestId === 'string' && payload.requestId.trim()
      ? payload.requestId.trim().slice(0, 120)
      : null;

  return {
    url: normalized,
    provider: provider.id,
    providerName: provider.name,
    isDirect: !!provider.isDirect,
    title,
    format,
    requestId
  };
}

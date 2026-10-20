/**
 * Content-Security-Policy strings (single source of truth).
 *
 * Shared by:
 *  - app/layout.jsx  (rendered as a <meta> tag into the static export HTML)
 *  - electron/main.js (injected via webRequest where the protocol supports it)
 *
 * Notes:
 *  - script-src must include 'unsafe-inline': Next.js static exports embed
 *    two inline bootstrap scripts whose content changes per build (nonces and
 *    hashes are not viable for a static export). All external scripts are
 *    still restricted to our own origin.
 *  - The production app is served from the privileged mvault:// scheme, so
 *    'self' is a real origin. Dev uses the Next dev server (HMR needs ws:).
 */

export const PROD_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'";

export const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'";

export const CSP = process.env.NODE_ENV === 'development' ? DEV_CSP : PROD_CSP;

import { DIRECT, directDownload } from './direct.js';
import { makeYtDlpProvider, makeGenericProvider } from './ytdlp.js';
import { PLATFORMS } from './platforms.js';

let cache = null;

/** All registered providers. Direct files win over host patterns. */
export function allProviders() {
  if (!cache) {
    cache = [DIRECT, ...PLATFORMS.map(makeYtDlpProvider), makeGenericProvider()];
  }
  return cache;
}

/** Resolve a URL to the provider that will handle it. */
export function resolveProvider(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const direct = DIRECT.canHandleUrl(url);
  if (direct) return DIRECT;
  for (const p of allProviders()) {
    if (p.isGeneric) continue;
    if (p.canHandleUrl(url)) return p;
  }
  const generic = allProviders().find((p) => p.isGeneric);
  return generic || null;
}

/** Capability matrix for the Supported Platforms page. */
export function capabilityMatrix() {
  return allProviders().map((p) => p.getCapabilities());
}

export { directDownload };

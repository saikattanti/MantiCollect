import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';

/** Media extension groups used by the direct-file provider. */
export const MEDIA_EXTENSIONS = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'tiff', 'tif', 'heic', 'heif'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi', 'flv', 'ts', 'mpg', 'mpeg', '3gp'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'oga', 'm4b', 'wma', 'aiff', 'aif', 'mid', 'midi'],
  archive: ['zip', '7z', 'rar'],
  document: ['pdf', 'txt', 'md', 'csv', 'json', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']
};

export function extensionKind(url) {
  try {
    const u = new URL(url);
    const ext = path.extname(u.pathname).toLowerCase().replace('.', '');
    for (const [kind, exts] of Object.entries(MEDIA_EXTENSIONS)) {
      if (exts.includes(ext)) return { kind, extension: ext };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sanitize a string for use as a file name on Windows (and POSIX).
 * Strips control chars and the reserved set <>:"/\|?*, trims trailing
 * dots, blocks device names (CON, NUL, COM1...), and caps length.
 */
export function sanitizeFilename(name, { maxLength = 150, fallback = 'untitled' } = {}) {
  let n = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '');
  if (!n) n = fallback;
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  if (reserved.test(n) || reserved.test(n.split('.')[0])) n = `_${n}`;
  if (Buffer.byteLength(n, 'utf8') > maxLength) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 ? n.slice(dot) : '';
    let base = dot > 0 ? n.slice(0, dot) : n;
    while (Buffer.byteLength(base + ext, 'utf8') > maxLength && base.length > 1) base = base.slice(0, -1);
    n = base + ext;
  }
  return n;
}

/** Return a path that does not exist yet, appending " (n)" when needed. */
export function uniquePath(dir, filename) {
  const p = path.join(dir, filename);
  const part = path.join(dir, `.${filename}.part`);
  if (!fs.existsSync(p) && !fs.existsSync(part)) return p;
  const ext = path.extname(filename);
  const base = (filename.length > ext.length ? filename.slice(0, filename.length - ext.length) : 'untitled') || 'untitled';
  for (let i = 1; i < 10000; i++) {
    const candidateName = `${base} (${i})${ext}`;
    const candidate = path.join(dir, candidateName);
    const candidatePart = path.join(dir, `.${candidateName}.part`);
    if (!fs.existsSync(candidate) && !fs.existsSync(candidatePart)) return candidate;
  }
  throw new Error('Could not find a unique file name');
}

/** Throw unless target resolves to inside base (or equals it). */
export function assertPathWithin(base, target) {
  const b = path.resolve(base);
  const t = path.resolve(target);
  if (t !== b && !t.startsWith(b + path.sep)) {
    throw new Error('Path escapes the allowed directory');
  }
  return t;
}

/* ---------------- private network detection ---------------- */

function ipToParts(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => {
    if (!/^\d{1,3}$/.test(p)) return NaN;
    return Number(p);
  });
  if (nums.some((n) => Number.isNaN(n) || n > 255)) return null;
  return nums;
}

function inCidr(ip, cidr) {
  const [net, bits] = cidr.split('/');
  const a = ipToParts(ip);
  const b = ipToParts(net);
  if (!a || !b) return false;
  const n = Number(bits);
  const wordBits = Math.floor(n / 8);
  const rem = n % 8;
  for (let i = 0; i < wordBits; i++) {
    if (a[i] !== b[i]) return false;
  }
  if (rem > 0) {
    const mask = (0xff << (8 - rem)) & 0xff;
    if ((a[wordBits] & mask) !== (b[wordBits] & mask)) return false;
  }
  return true;
}

const PRIVATE_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/10',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4'
];

function expandIpv6(ip) {
  // Minimal IPv6 expansion: returns array of 8 ints or null.
  let addr = ip.split('%')[0].toLowerCase();
  if (addr === '::') addr = '::0';
  let head = addr;
  const tail = addr.includes('::') ? addr.slice(addr.indexOf('::') + 2) : null;
  if (tail !== null) head = addr.slice(0, addr.indexOf(':'));
  const groups = [];
  const pushFrom = (s) => {
    for (const part of s.split(':')) {
      if (part === '') continue;
      if (!/^[0-9a-f]{1,4}$/.test(part)) return false;
      groups.push(parseInt(part, 16));
    }
    return true;
  };
  if (!pushFrom(head)) return null;
  if (tail !== null) {
    if (!pushFrom(tail)) return null;
  } else if (addr.endsWith(':')) {
    // trailing single group like "::1" handled by tail logic; ignore
  }
  if (groups.length > 8) return null;
  if (tail !== null) {
    const missing = 8 - groups.length;
    if (missing < 1) return null;
    const headGroups = groups.slice(0, head === '' ? 0 : groups.length - (tail.split(':').filter(Boolean).length));
    const out = [...headGroups];
    out.push(...Array(missing).fill(0));
    const tailCount = tail.split(':').filter(Boolean).length;
    out.push(...groups.slice(groups.length - tailCount));
    if (out.length !== 8) return null;
    return out;
  }
  if (groups.length !== 8) return null;
  return groups;
}

function ipv6ToV4Mapped(groups) {
  // ::ffff:a.b.c.d or ::ffff:hhhh:hhhh
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`;
  }
  return null;
}

export function ipIsPrivate(ip) {
  if (!ip) return true;
  ip = String(ip).trim().toLowerCase();
  if (ip.includes(':')) {
    const groups = expandIpv6(ip);
    if (!groups) return true; // unparsable -> treat as private (fail closed)
    if (groups.every((g) => g === 0)) return true; // unspecified ::
    if (groups.every((g, i) => (i === 7 ? g === 1 : g === 0))) return true; // ::1 loopback
    const first = groups[0];
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if (first === 0xff) return true; // multicast
    const mapped = ipv6ToV4Mapped(groups);
    if (mapped) return ipIsPrivate(mapped);
    return false;
  }
  if (ip === 'localhost') return true;
  const parts = ipToParts(ip);
  if (!parts) {
    // not a plain dotted quad; if it contains only digits/dots it was a bad IP -> fail closed
    if (/^[\d.]+$/.test(ip)) return true;
    return false; // hostname handled elsewhere
  }
  return PRIVATE_V4.some((c) => inCidr(ip, c));
}

/** Normalize user input: add https:// when no scheme is present. */
export function normalizeUrlInput(input) {
  let s = String(input ?? '').trim();
  if (!s) return s;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

/**
 * Validate a URL for server-side fetching. Rejects non-http(s) schemes,
 * IP literals in private/reserved ranges, and local-only host names.
 * When allowLocal is false, resolves DNS and rejects hosts that resolve
 * to private addresses (DNS-rebinding style protection).
 */
export async function assertPublicUrl(rawUrl, { allowLocal = false } = {}) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are supported');
  }
  const host = u.hostname;
  if (!host) throw new Error('URL has no host');
  // Developer opt-in: allow loopback / LAN / private hosts (local test servers).
  if (allowLocal) return u;
  if (ipIsPrivate(host)) {
    throw new Error('Access to private or loopback addresses is not allowed');
  }
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) {
    throw new Error('Access to local machine names is not allowed');
  }
  if (!allowLocal) {
    let addrs;
    try {
      addrs = await dns.lookup(host, { all: true, verbatim: true });
    } catch (err) {
      if (err && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN')) {
        throw new Error(`Could not resolve host: ${host}`);
      }
      throw new Error(`DNS lookup failed for ${host}`);
    }
    for (const a of addrs) {
      if (ipIsPrivate(a.address)) {
        throw new Error('Host resolves to a private network address');
      }
    }
  }
  return u;
}

/**
 * Fetch with manual redirect handling; every redirect target is
 * re-validated against the private-network rules.
 */
export async function fetchWithSafeRedirects(url, { allowLocal = false, maxRedirects = 10, signal, headers } = {}) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(current, { allowLocal });
    const res = await fetch(current, { redirect: 'manual', signal, headers });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirect response without Location header');
      current = new URL(loc, current).toString();
      if (res.body) res.body.cancel().catch(() => {});
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

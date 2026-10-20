import fs from 'node:fs';
import path from 'node:path';
import { runYtDlp } from '../bins.js';

/* ---------------- pure parsing helpers (unit-tested) ---------------- */

export function parseSize(num, unit) {
  const mult = {
    B: 1, KB: 1e3, KiB: 1024, MB: 1e6, MiB: 1024 ** 2, GB: 1e9, GiB: 1024 ** 3, TB: 1e12, TiB: 1024 ** 4
  }[unit];
  if (!mult) return 0;
  return Math.round(Number(num) * mult);
}

/**
 * Parse one line of yt-dlp --newline output into a structured event,
 * or null for lines that carry no information we track.
 */
export function parseYtDlpLine(line) {
  const l = line.trim();
  if (l.startsWith('[download] Destination:')) return { type: 'destination', path: l.slice('[download] Destination:'.length).trim() };
  let m;
  if ((m = l.match(/^\[download\]\s+(\d+(?:\.\d+)?)% of ~?([\d.]+)([KMGT]i?B) at ([\d.]+)([KMGT]i?B)\/s ETA (\S+)/))) {
    return {
      type: 'progress',
      pct: Number(m[1]),
      totalBytes: parseSize(m[2], m[3]),
      speedBps: parseSize(m[4], m[5]),
      eta: m[6]
    };
  }
  if ((m = l.match(/^\[download\]\s+(\d+(?:\.\d+)?)% of ~?([\d.]+)([KMGT]i?B) ETA (\S+)/))) {
    return { type: 'progress', pct: Number(m[1]), totalBytes: parseSize(m[2], m[3]), speedBps: null, eta: m[4] };
  }
  if (/^\[download\]\s+100%/.test(l)) return { type: 'progress', pct: 100, totalBytes: 0, speedBps: 0, eta: '00:00' };
  if (l.startsWith('[Merger]') || l.startsWith('[ffmpeg]')) return { type: 'processing' };
  if (l.startsWith('[ExtractAudio]')) return { type: 'processing' };
  if (l.startsWith('[info]')) return { type: 'info', text: l };
  if (l.startsWith('[ERROR]')) return { type: 'error', text: l };
  return null;
}

const ERROR_HINTS = [
  [/unsupported url/i, 'This URL is not recognized by yt-dlp — the site has no extractor (or the link is not a media page).'],
  [/sign in to confirm your age/i, 'This content is age-restricted. Add a cookies.txt from an authorized account in Settings to access it.'],
  [/private video|login (?:is )?required/i, 'This content requires an authorized login. Add a cookies.txt in Settings if you own this content.'],
  [/403|forbidden/i, 'The server refused the request (HTTP 403). This may need cookies or the content may be restricted.'],
  [/404|not found/i, 'The resource was not found on the server (HTTP 404).'],
  [/429|too many requests/i, 'The server is rate-limiting requests. Wait a while and retry.'],
  [/unable to download javascript|could not extract/i, 'The site layout changed or the extractor could not parse the page. Updating yt-dlp may fix this.'],
  [/you need to install ffmpeg|ffmpeg not found|merge/i, 'FFmpeg is required for this operation but was not found. Install it (Settings → Binaries) and retry.'],
  [/requested format is not available/i, 'The selected format is not available. Pick another format from the list.'],
  [/unable to extract initial data|failed to parse/i, 'Could not parse the page. The site may have changed or blocked the request.'],
  [/timed? ?out|timeout/i, 'The request timed out. Check your connection and retry.'],
  [/certificate/i, 'TLS certificate verification failed. MediaVault does not disable certificate checks.'],
  [/cookies/i, 'Authentication cookies are needed for this content. Add a cookies.txt file in Settings.'],
  [/net::|failed to establish|network/i, 'Network error while contacting the server.']
];

export function friendlyError(stderr, stdout = '') {
  const text = `${stderr}\n${stdout}`;
  const lastErrors = [...text.matchAll(/\[ERROR\][^\n]*/g)].map((m) => m[0]);
  for (const [re, hint] of ERROR_HINTS) {
    if (re.test(text)) {
      const detail = lastErrors.length ? ` ${lastErrors[lastErrors.length - 1].replace('[ERROR]', '').trim()}` : '';
      return `${hint}${detail}`;
    }
  }
  const detail = lastErrors.length ? lastErrors[lastErrors.length - 1].replace('[ERROR]', '').trim() : text.trim().split(/\r?\n/).pop();
  return `yt-dlp failed: ${String(detail).slice(0, 400) || 'unknown error'}`;
}

/**
 * After a successful download, find the final file. We prefer a file whose
 * name contains the expected media id (our output template embeds [id]);
 * fallback: the most recent non-temporary file in destDir since the start.
 */
export function findResultFile(destDir, expectedId, sinceMs) {
  let entries = [];
  try {
    entries = fs.readdirSync(destDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => {
      const p = path.join(destDir, e.name);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        return null;
      }
      return { p, name: e.name, mtime: st.mtimeMs, size: st.size };
    })
    .filter(Boolean)
    .filter((f) => !/\.(part|ytdl|tmp)$/i.test(f.name) && !f.name.startsWith('.'));

  if (expectedId) {
    const hit = files.filter((f) => f.name.toLowerCase().includes(expectedId.toLowerCase()));
    if (hit.length) return hit.sort((a, b) => b.size - a.size)[0].p;
  }
  const recent = files.filter((f) => f.mtime >= sinceMs && f.size > 0);
  if (recent.length) return recent.sort((a, b) => b.mtime - a.mtime)[0].p;
  return null;
}

/* ---------------- format handling ---------------- */

function formatInfo(f) {
  return {
    formatId: f.format_id,
    ext: f.ext,
    height: f.height || 0,
    width: f.width || 0,
    fps: f.fps || 0,
    vcodec: f.vcodec && f.vcodec !== 'none' ? f.vcodec : null,
    acodec: f.acodec && f.acodec !== 'none' ? f.acodec : null,
    filesize: f.filesize || f.filesize_approx || 0,
    tbr: f.tbr || 0,
    dynamic_range: f.dynamic_range || null
  };
}

/**
 * Build the selectable format list from real yt-dlp metadata only.
 * Video options are bestvideo+bestaudio pairs per height; combined
 * single-file formats are offered when present. Audio options never
 * claim better quality than the source (conversion is labeled).
 */
export function buildFormatOptions(data) {
  const formats = (data.formats || []).filter(Boolean);
  const video = formats.filter((f) => f.vcodec && f.vcodec !== 'none');
  const audio = formats.filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none');
  const combined = formats.filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none');

  const options = [];
  const byHeight = new Map();
  for (const f of video) {
    const h = f.height || 0;
    if (!byHeight.has(h) || (f.tbr || 0) > (byHeight.get(h).tbr || 0)) byHeight.set(h, f);
  }
  const bestAudio = audio.slice().sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0] || null;

  if (combined.length) {
    const best = combined.slice().sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0))[0];
    options.push({
      id: 'combined-best',
      label: `Best combined file — ${best.height ? `${best.height}p ` : ''}${best.ext} (${(best.tbr / 1000).toFixed(1)} Mbps)`,
      format: 'b',
      kind: 'video'
    });
  }
  for (const h of [...byHeight.keys()].sort((a, b) => b - a)) {
    const v = byHeight.get(h);
    options.push({
      id: `h${h}`,
      label: h ? `${h}p — ${v.ext} video${bestAudio ? ` + ${bestAudio.ext} audio` : ''} (${((v.tbr || 0) / 1000).toFixed(1)} Mbps)` : `Video only — ${v.ext}`,
      format: h ? `bv*[height<=${h}]+ba/b[height<=${h}]` : 'bv*+ba/b',
      kind: 'video'
    });
  }
  if (options.length === 0 && combined.length === 0) {
    // image extractors and audio-only sources
    if (data.ext) {
      options.push({ id: 'original', label: `Original — ${data.ext.toUpperCase()}`, format: '', kind: data.ext ? 'file' : 'video' });
    }
  }
  if (audio.length) {
    const best = bestAudio;
    options.push({
      id: 'audio-native',
      label: `Audio — original ${best.ext} (${(best.tbr / 1000).toFixed(1)} kbps, no re-encode)`,
      format: 'ba/b',
      kind: 'audio',
      audioExtract: null
    });
    for (const target of ['mp3', 'm4a', 'aac', 'wav', 'flac', 'opus', 'ogg']) {
      options.push({
        id: `audio-${target}`,
        label: `Audio — ${target.toUpperCase()} (converted from ${best.ext} ${Math.round(best.tbr || 0)} kbps)`,
        format: 'ba/b',
        kind: 'audio',
        audioExtract: target
      });
    }
  }
  if (options.length === 0) options.push({ id: 'best', label: 'Best available', format: 'bv*+ba/b', kind: 'video' });
  return { options, videoFormats: video.slice(0, 50).map(formatInfo), audioFormats: audio.slice(0, 25).map(formatInfo) };
}

function toItem(data) {
  const { options, videoFormats, audioFormats } = buildFormatOptions(data);
  return {
    type: 'item',
    provider: null, // filled by provider
    id: data.id,
    title: data.title || data.id || 'Untitled',
    duration: data.duration || 0,
    uploader: data.uploader || data.artist || data.channel || data.creator || null,
    thumbnail: data.thumbnail || null,
    description: data.description ? String(data.description).slice(0, 500) : null,
    uploadDate: data.upload_date || null,
    webpageUrl: data.webpage_url || data.url || null,
    ext: data.ext || null,
    contentLength: data.filesize || data.filesize_approx || 0,
    options,
    videoFormats,
    audioFormats
  };
}

/* ---------------- provider factory ---------------- */

function lastJson(stdout) {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  if (!lines.length) return null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {}
  }
  return null;
}

export function makeYtDlpProvider(spec) {
  return {
    id: spec.id,
    name: spec.name,
    host: spec.host,
    isYtDlp: true,

    canHandleUrl(url) {
      try {
        return spec.patterns.some((re) => re.test(url));
      } catch {
        return false;
      }
    },

    getCapabilities() {
      return {
        id: this.id,
        name: this.name,
        host: this.host,
        capabilities: spec.capabilities,
        requires: ['yt-dlp', 'ffmpeg (for merging/conversion)'],
        auth: spec.auth,
        notes: spec.notes || [],
        testStatus: spec.testStatus || 'untested'
      };
    },

    /**
     * Probe a URL. Returns either an item (with real formats) or a
     * collection (flat item list). Throws with a friendly message.
     */
    async getMetadata(url, ctx = {}) {
      const args = ['--no-warnings', '--flat-playlist', '--dump-json'];
      if (ctx.cookiesFile) args.push('--cookies', ctx.cookiesFile);
      args.push(url);
      const r = await runYtDlp(ctx.ytdlpBin, args, { timeoutMs: ctx.probeTimeoutMs || 30000 }).promise;
      if (r.code !== 0 || !r.stdout.trim()) {
        throw new Error(friendlyError(r.stderr, r.stdout));
      }
      const flat = lastJson(r.stdout);
      if (!flat) throw new Error('yt-dlp returned no metadata');
      const entries = Array.isArray(flat.entries) ? flat.entries.filter(Boolean) : [];
      if (flat._type === 'playlist' || entries.length > 1) {
        return {
          type: 'collection',
          provider: this.id,
          id: flat.id || null,
          title: flat.title || 'Untitled collection',
          count: flat.playlist_count || entries.length || null,
          webpageUrl: flat.webpage_url || url,
          thumbnail: flat.thumbnail || null,
          items: entries.map((e) => ({
            id: e.id,
            title: e.title || e.id || 'Untitled',
            duration: e.duration || 0,
            url: e.url && !/^https?:/.test(e.url) ? null : e.url,
            webpage_url: e.webpage_url || null,
            thumbnail: e.thumbnail || null
          }))
        };
      }
      // Single item: if the response already carries real formats (the video
      // extractor ran and --flat-playlist had no effect), use it directly.
      if (Array.isArray(flat.formats) && flat.formats.length > 0) {
        const item = toItem(flat);
        item.provider = this.id;
        return item;
      }
      // Otherwise fetch full metadata with formats.
      const fullArgs = ['--no-warnings', '--no-playlist', '--dump-json'];
      if (ctx.cookiesFile) fullArgs.push('--cookies', ctx.cookiesFile);
      fullArgs.push(url);
      const r2 = await runYtDlp(ctx.ytdlpBin, fullArgs, { timeoutMs: ctx.probeTimeoutMs || 30000 }).promise;
      if (r2.code !== 0 || !r2.stdout.trim()) throw new Error(friendlyError(r2.stderr, r2.stdout));
      const data = lastJson(r2.stdout);
      if (!data) throw new Error('yt-dlp returned no metadata');
      const item = toItem(data);
      item.provider = this.id;
      return item;
    },

    /**
     * Start a download. Returns {promise, cancel}.
     * opts: {url, destDir, formatOption, playlistItems, expectedId}
     */
    startDownload(opts, ctx = {}) {
      const { url, destDir, formatOption, playlistItems, expectedId } = opts;
      const args = ['--no-warnings', '--newline', '--no-simulate', '--retries', '3', '--fragment-retries', '3'];
      if (playlistItems && playlistItems.length) {
        args.push('--playlist-items', playlistItems.join(','));
      } else {
        args.push('--no-playlist');
      }
      if (formatOption && formatOption.format) args.push('-f', formatOption.format);
      if (formatOption && formatOption.audioExtract) {
        args.push('-x', '--audio-format', formatOption.audioExtract);
      }
      args.push('-o', path.join(destDir, '%(title).150B [%(id)s].%(ext)s'));
      if (ctx.ffmpegDir) args.push('--ffmpeg-location', ctx.ffmpegDir);
      if (ctx.cookiesFile) args.push('--cookies', ctx.cookiesFile);
      args.push(url);

      const startedAt = Date.now();
      let destination = null;
      let lastError = null;
      const handle = runYtDlp(ctx.ytdlpBin, args, {
        onLine: (line) => {
          const ev = parseYtDlpLine(line);
          if (!ev) return;
          if (ev.type === 'destination') destination = ev.path;
          if (ev.type === 'error') lastError = ev.text;
          opts.onProgress?.(ev);
        }
      });

      const promise = handle.promise.then((r) => {
        if (r.code !== 0) {
          if (r.error) throw new Error(r.error);
          const err = new Error(friendlyError(r.stderr, r.stdout));
          if (lastError) err.ytDlpLine = lastError;
          throw err;
        }
        const fp = findResultFile(destDir, expectedId, startedAt) || destination;
        if (!fp || !fs.existsSync(fp)) {
          throw new Error('Download finished but the resulting file could not be located');
        }
        opts.onProgress?.({ type: 'done' });
        return { path: fp };
      });

      return { promise, cancel: () => handle.cancel() };
    }
  };
}

/**
 * Fallback provider: any http(s) URL not matched by a specific platform
 * is tried against yt-dlp's full extractor list. Actual support depends
 * on the site; the probe result is the source of truth.
 */
export function makeGenericProvider() {
  return {
    id: 'generic',
    name: 'Generic (yt-dlp)',
    host: 'any site with a yt-dlp extractor',
    isGeneric: true,

    canHandleUrl(url) {
      try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    },

    getCapabilities() {
      return {
        id: this.id,
        name: this.name,
        host: this.host,
        capabilities: {
          metadata: 'supported',
          video: 'supported',
          audio: 'supported',
          images: 'supported',
          collections: 'supported',
          account_export: 'unsupported'
        },
        requires: ['yt-dlp'],
        auth: { needs: 'depends on the site', details: 'Sites with gated content may require cookies.txt.' },
        notes: [
          'Support is decided at probe time: yt-dlp reports whether the site has a working extractor.',
          'If the probe fails, the site is not supported (it is not hidden — the error says so).'
        ],
        testStatus: 'untested'
      };
    },

    getMetadata(url, ctx = {}) {
      const p = {
        getMetadata: (u, c) => {
          const args = ['--no-warnings', '--flat-playlist', '--dump-json'];
          if (c.cookiesFile) args.push('--cookies', c.cookiesFile);
          args.push(u);
          return runYtDlp(c.ytdlpBin, args, { timeoutMs: c.probeTimeoutMs || 30000 }).promise.then((r) => {
            if (r.code !== 0) {
              const msg = friendlyError(r.stderr, r.stdout);
              const err = new Error(msg);
              err.unsupported = /not recognized|no extractor|unsupported url/i.test(r.stderr + r.stdout);
              throw err;
            }
            return r;
          });
        }
      };
      const ytdlp = makeYtDlpProvider({ id: 'generic-inner', name: 'Generic', host: '*', patterns: [/^https?:\/\//i], capabilities: {} });
      return ytdlp.getMetadata(url, ctx).then((res) => {
        res.provider = this.id;
        return res;
      });
    },

    startDownload(opts, ctx = {}) {
      const ytdlp = makeYtDlpProvider({ id: 'generic-inner', name: 'Generic', host: '*', patterns: [/^https?:\/\//i], capabilities: {} });
      return ytdlp.startDownload(opts, ctx);
    }
  };
}

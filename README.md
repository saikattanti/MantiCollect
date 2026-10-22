# MantiCollect — A Mantitup Product

**Local-first universal media downloader and digital collector for Windows.**

Paste a URL. MantiCollect identifies the platform, shows the formats the source *actually* reports, and downloads through a persistent local queue. No cloud, no mandatory accounts, no telemetry.

---

## Features

- **Universal URL input** — direct media files (JPG, MP4, MP3, …) and any platform URL
- **16 registered platform providers** + generic yt-dlp fallback (probe decides what a site actually supports)
- **Real format lists** — resolutions, codecs, bitrates, and sizes come straight from the source; nothing is fabricated
- **Persistent download queue** — SQLite-backed, configurable concurrency, survives restarts, interrupted jobs auto-resume
- **Batch downloads** — multi-URL paste, .txt import, validation, dedupe, per-item progress, CSV report
- **Collections & playlists** — item listing, individual selection, select-all, one failure never kills the rest
- **Local library** — live scan of your download folder, grid/list views, search, ZIP export, safe delete
- **FFmpeg post-processing** — audio extraction/conversion (clearly labeled as re-encode), stream merging
- **Honest capability matrix** — in-app Supported Platforms page generated from the live provider registry
- **Secure by default** — SSRF protection, path confinement, no shell interpolation, TLS never disabled

## Requirements

- Windows 10/11 (x64)
- For development: Node.js 20+ (built and tested on Node 24)
- Internet access (only for downloading media)

FFmpeg, FFprobe, and yt-dlp are provided for you:

| Binary  | Source                                        | License            |
| ------- | --------------------------------------------- | ------------------ |
| FFmpeg  | `ffmpeg-static` npm package (auto on install) | GPL                |
| FFprobe | `ffprobe-static` npm package (auto on install)| GPL/LGPL           |
| yt-dlp  | Official standalone exe (one-time download)   | MIT                |

## Quick start

```bat
:: 1. Install dependencies (downloads FFmpeg/FFprobe binaries too)
npm install

:: 2. Install yt-dlp into vendor\yt-dlp (or: Settings -> Binaries -> Install in the app)
npm run setup-bins

:: 3. Run in development mode (Next.js dev server + Electron with hot reload)
npm run dev
```

Other commands:

```bat
npm test                     :: run the automated test suite (39 tests)
npm run smoke                :: build if needed, boot the app, verify the window loads
npm start                    :: production-mode run (builds renderer, launches Electron)
npm run dist                 :: build the Windows NSIS installer into release\
node scripts\integration-check.mjs --download
                             :: real-network end-to-end check (probe + small download)
```

### Installed app

`npm run dist` produces `release\MantiCollect-Setup-<version>.exe` (NSIS, customizable per-user install). The packaged app auto-locates vendored yt-dlp from `resources\vendor\` or persistent user data, or you can install it in-app at any time (Settings → Binaries).

## Where your data lives

| Data            | Location                                    |
| --------------- | ------------------------------------------- |
| Settings        | `%APPDATA%\MantiCollect\settings.json`        |
| Queue/history   | `%APPDATA%\MantiCollect\mediavault.db` (SQLite, WAL) |
| Logs            | `%APPDATA%\MantiCollect\logs\`                |
| Downloaded media| `%USERPROFILE%\Downloads\MantiCollect\` (customizable in Settings; auto-detects legacy `MediaVault` folder) |

*Note: On first launch, MantiCollect automatically and non-destructively migrates any existing database and settings from legacy `%APPDATA%\MediaVault\` without modifying the original files.*

No telemetry. No network calls except to the sources you paste (and GitHub, only when you explicitly install/update yt-dlp).

## Architecture

```
electron/               main process (Node)
  main.js               app lifecycle, window, mvault:// protocol, security hardening
  preload.cjs           contextBridge surface — whitelisted channels only
  ipc.js                restricted IPC handlers, per-payload validation
  security.js           URL/SSRF guards, filename sanitize, path confinement
  db.js                 SQLite schema + migration
  settings.js           local settings store
  bins.js               ffmpeg/ffprobe/yt-dlp resolution, spawning, installer
  queue.js              persistent job queue (concurrency, resume, throttled UI)
  runner.js             job execution orchestration
  library.js            folder scan, thumbnails, ZIP export, safe delete
  providers/
    registry.js         URL -> provider resolution, capability matrix
    direct.js           direct media-file downloads (streaming, redirect re-validation)
    platforms.js        declarative platform specs + honest capabilities
    ytdlp.js            yt-dlp subprocess provider + generic fallback
app/                    Next.js App Router renderer (static export)
  layout.jsx            root layout (server) — global CSS, CSP metadata, ThemeProvider
  (desktop)/layout.jsx  desktop shell: title bar, sidebar, page transitions, toasts
  (desktop)/*           13 route pages (dashboard, universal, video, audio, image,
                        social, collections, batch, queue, history, library,
                        platforms, settings, about)
src/                    shared renderer code (components, lib: ipc bridge, theme,
                        tokens, format helpers)
scripts/                setup-bins, smoke, integration-check
test/                   node:test suite (39 tests, no mocks of core paths)
vendor/yt-dlp/          downloaded yt-dlp executable (gitignored)
```

**Provider-adapter design:** each provider implements only the operations it actually supports (`canHandleUrl`, `getCapabilities`, `getMetadata`, `startDownload`). Methods for unimplemented features return explicit unsupported results. The generic provider tries yt-dlp's full extractor list and reports what the probe actually finds — unsupported sites say so, they are not hidden.

**Renderer integration:** the renderer is **Next.js (App Router) with a static export** — no server component features are used (all data comes from the main process over IPC), so the build produces plain HTML/JS/CSS in `dist/`. Electron serves that export from a privileged custom scheme (`mvault://app/`), which gives asset URLs a real origin (a `file://` load would break Next's root-absolute `/_next` paths and leaves an opaque CSP origin) and keeps client-side route transitions working through the same handler.

## Platform support

The in-app **Supported Platforms** page is generated from the live provider registry. Status values:

- **Supported** — works for public content
- **Partial** — works in some cases (notes explain which)
- **Auth required** — only with an explicit, user-provided `cookies.txt` from your own account
- **Not supported**

Registered providers: YouTube, Instagram, Facebook, TikTok, X, Reddit, Vimeo, Dailymotion, Pinterest, SoundCloud, Twitch, Bandcamp, Flickr, Tumblr, Threads, LinkedIn, Direct file, Generic (yt-dlp).

**Honesty note:** the YouTube single-item path (probe + video download with FFmpeg merge) has been verified end-to-end against a real public video (2026-10-19). The other platform providers share the same verified yt-dlp code path, but each site's extractor can fail independently (e.g. X rate limits) — the registry marks each one `untested` until it has actually been exercised. `node scripts\integration-check.mjs <url>` exists to verify any platform on demand.

## Authorization & legal use

- Only download media you have the right to save: your own content, public media, or licensed content.
- MediaVault **never** silently reads browser cookies. If a feature genuinely requires an account (e.g. profile-wide collections on Instagram/X), you export a `cookies.txt` from your own logged-in browser session and point Settings at it. The file path is stored locally; cookie contents are never logged.
- No paywall or DRM bypass. No private-account access. No private messages.
- Respect platform terms and local law.

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Preload exposes a **whitelisted** invoke/event channel set; unknown channels are rejected
- Every IPC payload is validated in the main process before use
- Content-Security-Policy applied twice: a `<meta>` tag baked into the exported HTML (single source of truth in `src/lib/csp.js`) and a header injection where the protocol supports it. `script-src` includes `'unsafe-inline'` because Next.js static exports embed two inline bootstrap scripts whose content changes per build; all external scripts remain restricted to the app's own origin
- Navigation locked to the app; `window.open` denied (https links go to the system browser)
- All permission requests (camera, geo, notifications) denied
- **SSRF protection:** only http(s); private/loopback IP literals, local hostnames, and DNS results in private ranges are blocked (opt-out for local test servers via the developer setting)
- **Redirects are re-validated hop by hop** — a redirect to `10.x` is refused
- User URLs are passed to child processes as argv arrays — **never shell-interpolated**
- Downloads stream to temp files inside the download folder; partials are cleaned up
- All library/ZIP/delete operations are confined to the download folder (path-traversal checked)
- Filenames sanitized (Windows-illegal chars, device names, length caps); overwrites avoided by default
- TLS certificate verification is never disabled
- No public server binding; nothing listens on a port

## Testing

```bat
npm test                 :: 39 automated tests
npm run smoke            :: app boots, window loads (headless-friendly)
node scripts\integration-check.mjs --download   :: real network e2e
```

Coverage (external services mocked only where unavoidable — local HTTP servers are real):

- URL validation, SSRF/private-network blocking, redirect re-validation
- Filename sanitization, path traversal, unique-path logic
- Provider registry: platform URL mapping, direct-file precedence, generic fallback, capability matrix honesty (no provider may claim account export; auth-gated ops must say so)
- yt-dlp output parsing (progress lines, sizes, destination, errors), format-option building, result-file discovery
- Queue DB: schema, state transitions, interrupted-job recovery, WAL persistence across reopen
- Direct downloads: streaming + progress, redirects, size limits, temp cleanup
- Library: recursive scan with real stats, ZIP export (real PK bytes, relative names), path confinement on ZIP/delete
- IPC security: every preload channel has a main handler; every event channel is actually emitted

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "yt-dlp is not installed" | `npm run setup-bins` or Settings → Binaries → Install |
| "you need to install ffmpeg" | `npm install` again (ffmpeg-static postinstall); check Settings → Binaries |
| "Site layout changed / could not extract" | Update yt-dlp (Settings → Binaries → Install/update) and retry |
| "age-restricted / sign in" | Add `cookies.txt` from your authorized account in Settings → Authorization |
| "403 / forbidden" | Content may be region- or login-gated; cookies.txt from your account may help |
| "Access to private addresses not allowed" | By design (SSRF protection). For local test servers enable Settings → Network safety → allow local network |
| GPU disk-cache warnings in the console | Harmless Chromium cache warnings on some Windows setups |
| App won't start after Windows update | Run `npm run setup-bins` (re-verifies yt-dlp) and check `%APPDATA%\mediavault\logs\` |

## Known limitations (as of 0.1.0)

- **Pause/resume of an in-flight download is not implemented** — you can cancel and retry; interrupted jobs (e.g. app closed mid-download) return to the queue on next start and yt-dlp resumes partial files where the server allows.
- 15 of 16 platform providers are registered and share the verified yt-dlp path, but only YouTube has been individually exercised end-to-end; each is labeled `untested` in the registry until verified.
- SoundCloud streams are limited to the quality the server serves.
- X (Twitter) is frequently rate-limited by the site itself.
- The local library is a live filesystem scan (no separate index) — very large folders may scan slowly.
- Batch downloads use "best available" per item unless you probe individually.

## Third-party components

yt-dlp (MIT), FFmpeg/FFprobe (GPL builds via npm static packages), Electron, Next.js, React, Tailwind CSS, better-sqlite3, archiver, Lucide, Framer Motion, Radix UI, Sonner. FFmpeg's GPL applies to the bundled binaries — fine for personal local use; redistribution of the binaries carries GPL obligations.

## License

MIT (project code).

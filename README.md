<div align="center">
  <img src="public/MantiCollect-name-logo-tr.png" alt="MantiCollect Logo" width="360" />
  <p><strong>A Mantitup Product • Local-First Universal Media Downloader and Digital Collector</strong></p>
  <p>
    <a href="#features">Features</a> •
    <a href="#installation">Installation</a> •
    <a href="#browser-extension">Browser Extension</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#security--privacy">Security & Privacy</a> •
    <a href="#roadmap">Roadmap</a> •
    <a href="#license">License</a>
  </p>
</div>

---

## Overview

**MantiCollect** is an offline-first, privacy-focused desktop application for Windows that combines multi-connection accelerated downloading, multi-platform media extraction, media library organization, format conversion, and automated cloud backups into a unified desktop tool.

Paste a URL or initiate a transfer directly from your browser. MantiCollect validates the source, probes actual available streams, and executes transfers through an atomic, SQLite-backed download queue with pause/resume, segmented acceleration, and bandwidth throttling.

---

## Features

* **Universal URL Input**: Ingests direct media URLs (`.mp4`, `.mkv`, `.mp3`, `.flac`, `.zip`, `.iso`, etc.) and streaming platform links.
* **Multi-Connection Segmented Downloads**: Concurrent HTTP range downloads (`206 Partial Content`) with dynamic segment allocation, integrity verification, and automatic fallback for servers without range support.
* **Streaming Media Extraction (yt-dlp)**: Bundled standalone `yt-dlp` executable with live progress streaming, resolution selection, audio-only extraction, and subtitles.
* **16 Registered Platform Adapters**: Dedicated adapters for YouTube, Instagram, Facebook, TikTok, X (Twitter), Reddit, Vimeo, Dailymotion, Pinterest, SoundCloud, Twitch, Bandcamp, Flickr, Tumblr, Threads, and LinkedIn, plus generic fallback.
* **Local Media Library & Collections**: Live directory scanning, playlist/collection management, tag organization, batch selection, ZIP export, and safe file removal.
* **FFmpeg Conversion Pipeline**: Bundled `ffmpeg-static` and `ffprobe-static` for transcoding, stream merging, re-encoding, and audio extraction across MP4, MKV, MP3, AAC, FLAC, and WebM.
* **Cloud Storage & Automated Backups**:
  * Direct synchronization with **Amazon S3 / S3-Compatible** (AWS, Cloudflare R2, MinIO, Backblaze B2) using streaming and managed multipart uploads.
  * **WebDAV** chunked transfer support.
  * **SFTP / SSH** file transfer with strict host-key fingerprint verification (MITM protection).
  * Cron-based background backup scheduler executing automatically even while minimized to tray.
* **System Tray & Desktop Integration**: Minimize-to-tray, close-to-tray, native Windows notifications, and background queue monitoring.
* **Manifest V3 Browser Extension**: One-click download handoff from Google Chrome and Microsoft Edge via Chromium Native Messaging Host or authenticated loopback bridge.
* **Strict Privacy & Security**: Zero telemetry, zero analytics tracking, local SQLite persistence (`WAL` mode), AES-256-GCM credential encryption, and SSRF loopback protections.

---

## Installation

### Windows Installer (Recommended)
1. Download `MantiCollect-Setup-<version>.exe` from the [GitHub Releases](https://github.com/saikattanti/MantiCollect/releases) page.
2. Run the installer:
   * Installs per-user to `%LOCALAPPDATA%\Programs\MantiCollect\`.
   * Requires **no Administrator privileges** (no UAC prompt).
   * Creates Start Menu and Desktop shortcuts.
3. On first launch, MantiCollect automatically initializes or non-destructively migrates existing databases.

*For complete installation details and data preservation policies, see the [Distribution & Installation Guide](docs/DISTRIBUTION_AND_INSTALLATION.md).*

---

## Browser Extension

MantiCollect includes an optional Manifest V3 browser extension for Google Chrome and Microsoft Edge.

1. Locate the unpacked extension in `release/browser-extension-unpacked` or unpack `manticollect-browser-extension-v<version>.zip`.
2. In Chrome or Edge, navigate to `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode** and click **Load unpacked**.
4. Select the `browser-extension-unpacked` folder.
5. In the `native-host` folder, register the Native Messaging Host:
   ```powershell
   cd native-host
   .\register-host-windows.ps1 -ExtensionId <YOUR_EXTENSION_ID>
   ```

*Note: Browser download interception is strictly opt-in and disabled by default. If enabled, browser downloads are only transferred when MantiCollect acknowledges acceptance.*

---

## Quick Start (Developer Setup)

### Prerequisites
* Windows 10/11 x64
* Node.js `20.x` or `22.x` (LTS)
* npm `10.x` or higher

### Setup Commands
```bash
# 1. Clone repository
git clone https://github.com/saikattanti/MantiCollect.git
cd MantiCollect

# 2. Install dependencies (configures native modules and static binaries)
npm install

# 3. Download/verify yt-dlp vendor binary
npm run setup-bins

# 4. Run development environment (Next.js hot reload + Electron)
npm run dev
```

### Other Supported Commands
```bash
npm test                 # Run all 215+ automated unit and integration tests
npm run build            # Build Next.js static production export (dist/)
npm run smoke            # Headless Electron boot and window verification test
npm run package:extension# Validate and package Manifest V3 browser extension
npm run dist             # Build Windows NSIS production installer (release/)
```

---

## Where Your Data Lives

MantiCollect stores all user data locally on your system:

| Data Type | Storage Location | Notes |
| :--- | :--- | :--- |
| **Database & Queue** | `%APPDATA%\MantiCollect\mediavault.db` | SQLite with Write-Ahead Logging (`WAL`) |
| **Settings** | `%APPDATA%\MantiCollect\settings.json` | JSON configuration |
| **Credentials** | `%APPDATA%\MantiCollect\credentials.enc` | AES-256-GCM encrypted cloud secrets |
| **Logs** | `%APPDATA%\MantiCollect\logs\` | Local application event logs |
| **Downloaded Files** | `%USERPROFILE%\Downloads\MantiCollect\` | User-configurable download directory |

---

## Security & Privacy

* **Defense in Depth**: Electron `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` are enforced across all windows.
* **Preload Bridge**: Whitelist-only IPC surface via `contextBridge` (`electron/preload.cjs`). Raw Node built-ins are never exposed to renderer code.
* **Untrusted Input Sanitation**: URLs pass rigorous validation (`validateBrowserSubmission`), blocking `javascript:`, `data:`, `file:`, and credentials in URLs (`user:pass@host`).
* **SSRF Guard**: Loopback and RFC 1918 private network ranges are blocked by default (`assertPublicUrl`).
* **Safe Subprocesses**: `yt-dlp` and `ffmpeg` are spawned directly with discrete argument arrays; shell interpolation (`shell: true`) is strictly forbidden.
* **Encrypted Secrets**: Cloud storage passwords and keys are encrypted at rest with AES-256-GCM using machine-derived keys.
* **Local-First**: No tracking, analytics, or external telemetry of user URLs, downloads, or browsing history.

*To report security issues, refer to [SECURITY.md](SECURITY.md).*

---

## Supported Platforms & Known Limitations

The in-app **Supported Platforms** view reflects the live provider capabilities:
* **YouTube**: Video, audio extraction, format selection, playlists, and channel probes verified end-to-end.
* **Direct Downloads**: Multi-connection segmented downloads verified with full range support and pause/resume.
* **Social / Video Platforms**: Extractor support via yt-dlp. Platforms with aggressive rate limits (e.g. X/Twitter) or login requirements may require exported `cookies.txt` from your own account.
* **Operating System**: Windows 10/11 x64 is the primary tested and supported desktop platform. macOS and Linux builds are not yet officially validated.
* **Code Signing**: Release binaries generated from open-source builds are unsigned (`NotSigned`) until an official Authenticode certificate is provisioned by the maintainer.

---

## Roadmap

* [ ] Automated Authenticode code signing with trusted hardware security module (HSM) support.
* [ ] Accessibility audit: full keyboard tab navigation, ARIA landmarks, and high-contrast support.
* [ ] Chrome Web Store and Microsoft Edge Add-ons store submission.
* [ ] Multi-platform engine evaluation (macOS Apple Silicon & Linux AppImage).
* [ ] Cloud backup retry queue with automatic network reconnect resumption.

---

## Contributing

Contributions from the community are welcome! Please review our:
* [Contributing Guide](CONTRIBUTING.md)
* [Code of Conduct](CODE_OF_CONDUCT.md)
* [Architecture Documentation](docs/ARCHITECTURE.md)
* [Release Checklist](docs/RELEASE_CHECKLIST.md)

---

## License

MantiCollect is open-source software licensed under the **[MIT License](LICENSE)**.

### Third-Party Software Notices
* `yt-dlp`: The Unlicense / MIT
* `ffmpeg` / `ffprobe`: GPL / LGPL static binaries (included for local personal use via npm packages)
* `better-sqlite3`: MIT
* `Electron`, `Next.js`, `React`, `Tailwind CSS`: MIT

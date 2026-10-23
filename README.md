<div align="center">
  <img src="public/MantiCollect-name-logo-tr.png" alt="MantiCollect Logo" width="380" />
  <p><strong>A Mantitup Product • Collect Media. Your Way.</strong></p>
  <p><em>Local-first universal media downloader, format converter, and digital collector for Windows.</em></p>

  <p>
    <a href="https://github.com/saikattanti/MantiCollect/actions/workflows/ci.yml">
      <img src="https://github.com/saikattanti/MantiCollect/actions/workflows/ci.yml/badge.svg" alt="Continuous Integration" />
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" />
    </a>
    <a href="docs/DISTRIBUTION_AND_INSTALLATION.md">
      <img src="https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078d4.svg?logo=windows" alt="Platform: Windows" />
    </a>
    <a href="package.json">
      <img src="https://img.shields.io/badge/Node.js-%3E%3D20-green.svg?logo=node.js" alt="Node.js" />
    </a>
    <a href="package.json">
      <img src="https://img.shields.io/badge/Electron-44.x-47848F.svg?logo=electron" alt="Electron" />
    </a>
  </p>

  <p>
    <a href="#overview">Overview</a> •
    <a href="#core-features">Features</a> •
    <a href="#supported-platforms">Supported Platforms</a> •
    <a href="#installation">Installation</a> •
    <a href="#browser-extension">Browser Extension</a> •
    <a href="#developer-setup">Developer Setup</a> •
    <a href="#security--privacy">Security & Privacy</a> •
    <a href="#roadmap">Roadmap</a> •
    <a href="#contributing">Contributing</a> •
    <a href="#license">License</a>
  </p>
</div>

---

## Overview

**MantiCollect** is an offline-first, privacy-focused desktop application that unifies multi-connection accelerated downloading, multi-platform media extraction, media library organization, audio/video conversion, and automated cloud backup into a single desktop tool.

Paste a URL or initiate a transfer directly from your web browser. MantiCollect validates the source, probes available media streams, and executes transfers through an atomic, SQLite-backed download queue with pause/resume, segmented acceleration, and bandwidth throttling.

---

## Visual Preview & UI Specifications

MantiCollect features a refined dark-mode desktop interface built with Electron, Next.js App Router, React, and Tailwind CSS:

* **Universal Ingest**: Single input field accepting direct files and platform links with auto-detection.
* **Download Queue & Telemetry**: Real-time download speeds, segmented chunks visualizer, ETA calculation, and per-job controls.
* **Media Library & Collections**: Local media directory scanner, tags, collections, and batch export.
* **Format Converter**: Bundled FFmpeg audio and video transcoding presets.
* **Cloud Backups & Scheduler**: S3, WebDAV, and SFTP targets with background cron scheduling while minimized to tray.
* **Settings & Tray**: Desktop close-to-tray/minimize-to-tray preferences, theme switching, and concurrency limits.

*(Detailed screenshot specifications and capture guidelines for release maintainers are documented in [docs/screenshots/README.md](docs/screenshots/README.md)).*

---

## Core Features

* **Universal URL Ingest**: Ingests direct media URLs (`.mp4`, `.mkv`, `.mp3`, `.flac`, `.zip`, `.iso`, etc.) and streaming platform links.
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

## Supported Platforms & Verification Status

| Platform / OS | Status | Notes |
| :--- | :---: | :--- |
| **Windows 11 (x64)** | :white_check_mark: **Verified** | Primary development and CI platform. Full mica titlebar and notification support. |
| **Windows 10 (x64)** | :white_check_mark: **Verified** | Supported with native titlebar fallback and background tray execution. |
| **macOS (Apple Silicon / Intel)** | :x: *Not Verified* | Electron codebase is portable, but packaging and native hooks are currently Windows-only. |
| **Linux (x64 / ARM)** | :x: *Not Verified* | Linux desktop packages (AppImage/deb) are planned for future milestones. |

---

## Installation

### Windows Installer (Recommended)
1. Download `MantiCollect-Setup-<version>.exe` from the [GitHub Releases](https://github.com/saikattanti/MantiCollect/releases) page *(available once the first release tag is approved)*.
2. Run the installer:
   * Installs per-user to `%LOCALAPPDATA%\Programs\MantiCollect\`.
   * Requires **no Administrator privileges** (no UAC prompt required).
   * Automatically adds Start Menu and Desktop shortcuts.
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

## Developer Setup

### Prerequisites
* Windows 10/11 x64
* Node.js `20.x` or `22.x` (LTS)
* npm `10.x` or higher
* Git

### Setup Commands
```bash
# 1. Clone repository
git clone https://github.com/saikattanti/MantiCollect.git
cd MantiCollect

# 2. Install dependencies reproducibly
npm install

# 3. Download/verify yt-dlp vendor binary
npm run setup-bins

# 4. Run development environment (Next.js hot reload + Electron)
npm run dev
```

### Available Scripts

| Script | Purpose |
| :--- | :--- |
| `npm run dev` | Launch Next.js dev server on port 3000 and boot Electron with hot-reload |
| `npm test` | Execute complete automated test suite (216 passing tests) |
| `npm run build` | Build optimized Next.js static production export (`dist/`) |
| `npm run smoke` | Execute headless Electron startup and window verification smoke test |
| `npm run package:extension` | Validate and package Manifest V3 browser extension to `release/` |
| `npm run generate-icons` | Regenerate app and extension icons from `public/` brand assets |
| `npm run dist` | Build production Windows NSIS installer (`release/`) |

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
* **Local-First**: Zero tracking, zero telemetry, and zero remote analytics.

*To report security issues, refer to [SECURITY.md](SECURITY.md).*

---

## Roadmap

### Implemented :white_check_mark:
* Multi-connection segmented downloading with dynamic byte-range planning.
* yt-dlp media extraction with live progress streaming and 16 platform adapters.
* SQLite local persistence with WAL mode and atomic state transitions.
* Media library scanner, collections, tags, and batch ZIP export.
* FFmpeg audio/video transcoding presets and audio extraction.
* S3, WebDAV, and SFTP cloud storage providers with automated backup scheduling.
* Windows system tray lifecycle (minimize/close to tray) and native notifications.
* Manifest V3 browser extension with Native Messaging Host and loopback bridge.
* Windows NSIS installer and non-destructive legacy data migration.
* GitHub Actions continuous integration and release packaging automation.

### In Progress :construction:
* Open-source contributor infrastructure (issue templates, PR standards, and label taxonomy).
* Test suite cross-platform line-ending resilience (LF/CRLF normalization).

### Planned :clipboard:
* Authenticode code signing automation with trusted hardware security module (HSM) support.
* Comprehensive accessibility audit (keyboard tab navigation, ARIA landmarks, high contrast).
* Chrome Web Store and Microsoft Edge Add-ons store submission.
* Multi-platform engine evaluation (macOS Apple Silicon & Linux AppImage).

---

## Contributing

Contributions from the community are warmly welcome! Please review:
* [Contributing Guide](CONTRIBUTING.md) — Prerequisites, development commands, and pull request workflow.
* [Code of Conduct](CODE_OF_CONDUCT.md) — Contributor Covenant community pledge.
* [Architecture Guide](docs/ARCHITECTURE.md) — Technical subsystems and security boundaries.
* [Release Checklist](docs/RELEASE_CHECKLIST.md) — Pre-release validation procedures.
* [Issue Backlog](docs/ISSUE_BACKLOG.md) — Curated open-source task backlog.

To report a bug or suggest a feature:
* Open an issue using our [GitHub Issue Templates](https://github.com/saikattanti/MantiCollect/issues/new/choose).
* Ask questions or share ideas on [GitHub Discussions](https://github.com/saikattanti/MantiCollect/discussions).

---

## License

MantiCollect is open-source software licensed under the **[MIT License](LICENSE)**.

### Third-Party Software & Acknowledgements
* `yt-dlp`: The Unlicense / MIT
* `ffmpeg` / `ffprobe`: GPL / LGPL static binaries (included for local personal use)
* `better-sqlite3`: MIT
* `Electron`, `Next.js`, `React`, `Tailwind CSS`: MIT
* Brand design and product direction by **Mantitup**.

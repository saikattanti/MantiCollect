# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- Authenticode code signing automation.
- Accessibility improvements (focus rings, ARIA landmarks, keyboard navigation).
- Live remote cloud storage integration test suite.
- Chrome Web Store and Microsoft Edge Add-ons store submission.

---

## [0.1.0] - 2026-10-23

### Added
- **Segmented Download Engine**: Multi-connection concurrent HTTP range downloads with dynamic byte-range planning and automatic fallback to single-connection streams.
- **yt-dlp Video & Audio Integration**: Bundled yt-dlp binary with progress streaming, format parsing, and cancellation handling.
- **SQLite Local Persistence**: `better-sqlite3` database with Write-Ahead Logging (`WAL`) for atomic job records, collections, and settings.
- **Media Library & Collections**: Local media scanner, tag organization, playlist/collection management, and batch operations.
- **FFmpeg Conversion Pipeline**: Bundled `ffmpeg-static` and `ffprobe-static` binaries for audio extraction and multi-format conversion.
- **Remote Cloud Storage & Backup**: S3-compatible cloud storage (AWS, Cloudflare R2, MinIO, B2) with multipart upload, WebDAV, and SFTP with host-key verification.
- **Automated Cloud Backup Scheduling**: Background cron-based scheduler capable of executing while minimized to system tray.
- **Windows System Tray & Native Notifications**: Background lifecycle support with minimize-to-tray, close-to-tray, and interactive tray menus.
- **Manifest V3 Browser Extension**: Chromium extension for Chrome and Edge supporting toolbar submission, context menu integration, and consent-driven download interception.
- **Native Messaging Host**: Chromium stdio IPC protocol host for secure, portless communication with automatic Electron fallback (`ELECTRON_RUN_AS_NODE=1`).
- **Authenticated Loopback Bridge**: Hardened `127.0.0.1` HTTP server with Host header DNS rebinding protection, cryptographic Bearer token auth, and rate limiting.
- **NSIS Production Installer**: Per-user Windows installer (`%LOCALAPPDATA%\Programs\MantiCollect`), Start Menu and desktop shortcuts.
- **Data Migration & Safety**: Non-destructive atomic migration of legacy databases, WAL files, settings, and credentials with temporary-file guarantees.
- **Open Source Infrastructure**: GitHub Actions CI workflow, release automation with SHA-256 checksums, issue templates, PR template, security policy, and contributing guide.

### Security
- Untrusted URL input validation with SSRF protection against RFC 1918 and loopback IP ranges.
- AES-256-GCM encryption at rest for remote cloud storage credentials.
- Chromium Native Messaging Host origin restriction (wildcards eliminated).
- Electron context isolation (`contextIsolation: true`, `nodeIntegration: false`) with strict whitelist preload bridge.

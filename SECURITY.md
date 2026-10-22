# Security Policy

MantiCollect (A Mantitup Product) takes the security and privacy of our users and their data seriously. This document outlines our supported versions, reporting procedures, and security architecture.

---

## 1. Supported Versions

Security updates and critical patches are released for the following versions:

| Version | Supported | Status |
| :--- | :--- | :--- |
| `0.1.x` | :white_check_mark: Yes | Current Active Release Line |
| `< 0.1.0` | :x: No | Deprecated / Internal development |

---

## 2. Reporting a Vulnerability

**Please do NOT report security vulnerabilities via public GitHub issues, pull requests, or public discussions.**

### Preferred Reporting Channel: GitHub Private Vulnerability Reporting
MantiCollect uses GitHub's built-in **Private Vulnerability Reporting** feature to allow security researchers and users to securely disclose vulnerabilities:

1. Navigate to the [MantiCollect Security Advisories page](https://github.com/saikattanti/MantiCollect/security/advisories).
2. Click **Report a vulnerability**.
3. Provide:
   - A clear description of the vulnerability.
   - Affected version(s) and environment (e.g. Windows 11 x64, browser extension version).
   - Step-by-step instructions to reproduce the issue (proof-of-concept script or payload).
   - Potential impact and suggested remediation if known.

*(Note for Repository Maintainers: If Private Vulnerability Reporting is not yet toggled on, enable it via **Repository Settings → Code security and analysis → Private vulnerability reporting → Enable**).*

If the private advisory interface is unavailable, you may contact the repository owner privately via their GitHub profile ([@saikattanti](https://github.com/saikattanti)).

---

## 3. Vulnerability Handling Process

1. **Acknowledgment**: The maintainer will acknowledge receipt of your report once reviewed.
2. **Investigation**: The issue will be reproduced and assessed in an isolated test environment.
3. **Patch Development**: A fix will be developed in a private security fork or branch.
4. **Validation**: Automated regression tests will verify the patch before release.
5. **Coordinated Disclosure**: A new release will be published alongside a GitHub Security Advisory crediting the reporter (if desired).

---

## 4. Security Architecture & Trust Model

MantiCollect follows defense-in-depth principles:

* **Local-First Privacy**: Download history, media metadata, credentials, and settings remain on the local machine. No browsing data, downloads, or credentials are sent to remote analytics servers.
* **Untrusted Input Boundary**: All URLs received from user input, browser extension, or clipboard pass through strict validation (`validateBrowserSubmission`), rejecting unsupported schemes (`file:`, `javascript:`, `data:`, `blob:`), oversized URLs, and embedded credentials.
* **SSRF Protection**: Requests to private RFC 1918 / loopback ranges are blocked by default (`assertPublicUrl`).
* **Loopback Bridge Hardening**:
  * Listens exclusively on `127.0.0.1` (never `0.0.0.0`).
  * Enforces Host header whitelist (`127.0.0.1` / `localhost`) to prevent DNS rebinding.
  * Requires a 256-bit cryptographic Bearer token on every request.
  * Enforces a 64 KB maximum payload limit and 60 req/min rate limiting.
* **Credential Storage**: Storage connection credentials (S3 secret keys, SFTP passwords, WebDAV tokens) are encrypted at rest using AES-256-GCM (`electron/credentials.js`).
* **Process Execution Safety**: External binaries (`yt-dlp`, `ffmpeg`, `ffprobe`) are spawned directly with discrete argument arrays; shell interpolation (`shell: true`) is strictly forbidden.
* **Browser Extension Isolation**: Extension operates with minimal permissions (`activeTab`, `storage`, `contextMenus`, `notifications`, `downloads`, `nativeMessaging`). Clipboard and download interception are opt-in and disabled by default.

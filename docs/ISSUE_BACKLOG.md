# MantiCollect — Prioritized Issue Backlog

This backlog contains actionable, evidence-backed candidate issues derived from the Phase 12 distribution audit, source code inspection, and architectural limitations.

None of these issues represent fabricated defects; each addresses an identified operational, packaging, or verification milestone.

---

## Issue 1: Real-World Windows Clean-Install and Upgrade Testing on Isolated Environments

* **Title**: `[Packaging]: Validate Windows NSIS clean installation, upgrade, and uninstallation on isolated VMs`
* **Labels**: `type: enhancement`, `area: packaging`, `priority: high`, `status: triage`
* **Current Gap**: Phase 12 verified the installer statically and through automated file-copy tests (`test/distribution-safety.test.js`). Real-world end-to-end execution on fresh Windows 10 and Windows 11 virtual machines (without developer tools or pre-existing dependencies installed) has not yet been executed.
* **Scope**:
  - Test fresh install of `MantiCollect-Setup-0.1.0.exe` on clean Windows 10 x64 and Windows 11 x64 VMs.
  - Test upgrade over simulated v0.0.9 / legacy installations to confirm database WAL preservation.
  - Test uninstallation: verify executables and registry keys are removed while user media is left intact.
* **Acceptance Criteria**:
  - [ ] Installer runs without fatal errors on clean Windows 10 & 11 environments without Node.js installed.
  - [ ] Shortcuts launch `%LOCALAPPDATA%\Programs\MantiCollect\MantiCollect.exe` cleanly.
  - [ ] Upgrading over an existing database preserves all download records and settings.
  - [ ] Uninstaller leaves downloaded user files in `%USERPROFILE%\Downloads\MantiCollect\` untouched.

---

## Issue 2: Authenticode Code-Signing Pipeline & Hardware Security Module (HSM) Integration

* **Title**: `[Security]: Integrate Authenticode code signing with trusted certificate and timestamping`
* **Labels**: `type: enhancement`, `area: security`, `area: packaging`, `priority: high`, `status: triage`
* **Current Gap**: Packaged binaries are currently unsigned (`NotSigned`), triggering Microsoft Defender SmartScreen untrusted warnings on download and initial launch.
* **Scope**:
  - Integrate Windows code signing into `.github/workflows/release.yml` using `CSC_LINK` / `CSC_KEY_PASSWORD` or Azure Trusted Signing / cloud HSM.
  - Configure SHA-256 Authenticode signing with RFC 3161 compliant timestamping.
  - Verify executable and uninstaller signatures using `Get-AuthenticodeSignature`.
* **Acceptance Criteria**:
  - [ ] CI release pipeline signs `MantiCollect-Setup-*.exe` and embedded executables when signing secrets are present.
  - [ ] Digital signatures verify with status `Valid`.
  - [ ] Release pipeline falls back to clear `Unsigned development build` declaration when secrets are absent.

---

## Issue 3: Chrome Web Store & Microsoft Edge Add-ons Packaging and Submission Preparation

* **Title**: `[Extension]: Prepare browser extension assets and submission metadata for Chrome Web Store and Edge Add-ons`
* **Labels**: `type: enhancement`, `area: browser-extension`, `priority: medium`, `status: triage`
* **Current Gap**: The Manifest V3 extension packages cleanly into `release/manticollect-browser-extension-v1.0.0.zip` for developer mode loading. Preparing for public store distribution requires store assets (promotional banners, privacy disclosure forms, fixed store extension IDs).
* **Scope**:
  - Prepare store promotional graphic assets (1280x800 screenshot mockups, 440x280 promotional tile).
  - Draft privacy policy compliance answers (justifying `downloads` and `nativeMessaging` permissions).
  - Document fixed extension ID handling in `com.mantitup.manticollect.json`.
* **Acceptance Criteria**:
  - [ ] Extension package passes Chrome Web Store automated validator with zero policy violations.
  - [ ] Edge Add-ons packaging conforms to Microsoft Partner Center requirements.
  - [ ] Manifest and host documentation reflect permanent store extension IDs.

---

## Issue 4: Live Remote Cloud Storage End-to-End Interoperability Test Suite

* **Title**: `[Storage]: Implement automated integration tests against live mock S3, SFTP, and WebDAV servers`
* **Labels**: `type: enhancement`, `area: storage`, `priority: medium`, `status: triage`
* **Current Gap**: S3, SFTP, and WebDAV providers have unit tests (`s3-provider.test.js`, `sftp-provider.test.js`, `webdav-provider.test.js`), but rely partially on mocked HTTP responses for large transfers. An integration test suite using ephemeral local test servers is needed.
* **Scope**:
  - Set up an automated local MinIO / S3 mock server, embedded SFTP server, and WebDAV server for integration testing.
  - Test real multi-part uploads with network latency simulation.
  - Test credential rotation and session expiration.
* **Acceptance Criteria**:
  - [ ] Automated integration test transfers a 20MB file via S3 multipart upload to local MinIO.
  - [ ] Automated integration test transfers files over authenticated SFTP and verifies host key fingerprint.
  - [ ] Automated integration test executes chunked WebDAV upload and verify file integrity.

---

## Issue 5: S3 Multipart Upload Interrupted Part Recovery and Resumption

* **Title**: `[Storage]: Enable upload queue resumption for interrupted S3 multipart transfers`
* **Labels**: `type: enhancement`, `area: storage`, `priority: medium`, `status: triage`
* **Current Gap**: When an S3 multipart upload fails mid-transfer (e.g. system sleep or lost connection), the current implementation aborts the multipart upload via `AbortMultipartUploadCommand`. For multi-gigabyte backup files, resuming from already-uploaded parts would save significant bandwidth.
* **Scope**:
  - Persist active S3 `UploadId` and completed `PartNumber`/`ETag` list in SQLite `upload_tasks` record.
  - On retry or app restart, call `ListPartsCommand` and resume upload from the first missing part.
* **Acceptance Criteria**:
  - [ ] Interrupted S3 upload retains valid uploaded parts across application restart.
  - [ ] Upload pump resumes from next uncommitted byte offset without re-uploading completed parts.
  - [ ] Complete multipart upload successfully finalizes with combined ETag.

---

## Issue 6: Cross-Platform Evaluation and Portability Review (macOS / Linux Engine Support)

* **Title**: `[Packaging]: Evaluate cross-platform runtime portability for macOS (Apple Silicon) and Linux`
* **Labels**: `type: enhancement`, `area: packaging`, `priority: low`, `status: triage`
* **Current Gap**: MantiCollect is currently configured and packaged specifically for Windows (`win32 x64`). The underlying Electron, Next.js, and SQLite architecture is cross-platform capable, but platform-specific scripts (NSIS, batch launchers, registry keys) require macOS (`.dmg`) and Linux (`.AppImage` / `.deb`) counterparts.
* **Scope**:
  - Implement native messaging host manifest registration for macOS (`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`) and Linux (`~/.config/google-chrome/NativeMessagingHosts/`).
  - Configure `electron-builder` targets for `mac` (universal or arm64) and `linux`.
  - Validate file path separators and platform paths across main process modules.
* **Acceptance Criteria**:
  - [ ] Application builds and starts on macOS (Darwin arm64) and Linux (Ubuntu x64).
  - [ ] Native messaging scripts correctly install on Unix environments.
  - [ ] Storage and download queues operate with POSIX paths.

---

## Issue 7: Full Keyboard Navigation, Focus Rings, and High-Contrast Accessibility Audit

* **Title**: `[UI]: Audit and enhance keyboard tab navigation, focus rings, and screen-reader accessibility`
* **Labels**: `type: enhancement`, `area: ui`, `priority: low`, `good first issue`
* **Current Gap**: The user interface has polished visual styling in dark mode, but full keyboard tab navigation (`tabindex`, visible focus indicators, skip links) and ARIA attributes for screen readers require systematic enhancement.
* **Scope**:
  - Ensure all interactive elements (buttons, inputs, dropdowns, table rows) are reachable via `Tab` and `Shift+Tab`.
  - Add high-contrast focus rings (`focus-visible:ring-2`) conforming to WCAG 2.1 AA.
  - Add descriptive `aria-label` tags to icon-only buttons in sidebar and download queue cards.
* **Acceptance Criteria**:
  - [ ] Entire download queue, settings, and library workflows can be operated solely using keyboard navigation.
  - [ ] Active focused element is clearly indicated by visible high-contrast ring.
  - [ ] Screen readers accurately announce download progress, status changes, and modal states.

---

## Issue 8: NSIS Installer Footprint and Binary Size Optimization

* **Title**: `[Packaging]: Optimize NSIS installer package size and prune redundant dependencies`
* **Labels**: `type: enhancement`, `area: packaging`, `priority: low`, `status: triage`
* **Current Gap**: The Windows installer is currently ~249.8 MB, containing Electron, Next.js static assets, `ffmpeg-static`, `ffprobe-static`, and node modules. Pruning unused platform binaries and optimizing compression can reduce download times for end users.
* **Scope**:
  - Verify `package.json` `build.files` exclusions to ensure test fixtures and redundant vendor docs are pruned.
  - Test LZMA / solid compression in `electron-builder` NSIS configuration.
* **Acceptance Criteria**:
  - [ ] Redundant files (unused documentation, development typings) are excluded from `app.asar`.
  - [ ] NSIS installer produces verifiable binary without breaking runtime execution.

---

## How to Apply These Issues to GitHub

Once authenticated to GitHub via GitHub CLI:

```bash
# 1. Login to GitHub
gh auth login

# 2. Apply labels from taxonomy
# (Labels defined in .github/labels.yml)

# 3. Create issues directly using gh issue create
gh issue create \
  --title "[Packaging]: Validate Windows NSIS clean installation, upgrade, and uninstallation on isolated VMs" \
  --label "type: enhancement,area: packaging,priority: high" \
  --body "See details in docs/ISSUE_BACKLOG.md (Issue 1)"

gh issue create \
  --title "[Security]: Integrate Authenticode code signing with trusted certificate and timestamping" \
  --label "type: enhancement,area: security,area: packaging,priority: high" \
  --body "See details in docs/ISSUE_BACKLOG.md (Issue 2)"

gh issue create \
  --title "[Extension]: Prepare browser extension assets and submission metadata for Chrome Web Store and Edge Add-ons" \
  --label "type: enhancement,area: browser-extension,priority: medium" \
  --body "See details in docs/ISSUE_BACKLOG.md (Issue 3)"

gh issue create \
  --title "[Storage]: Implement automated integration tests against live mock S3, SFTP, and WebDAV servers" \
  --label "type: enhancement,area: storage,priority: medium" \
  --body "See details in docs/ISSUE_BACKLOG.md (Issue 4)"

gh issue create \
  --title "[Storage]: Enable upload queue resumption for interrupted S3 multipart transfers" \
  --label "type: enhancement,area: storage,priority: medium" \
  --body "See details in docs/ISSUE_BACKLOG.md (Issue 5)"

gh issue create \
  --title "[Packaging]: Evaluate cross-platform runtime portability for macOS (Apple Silicon) and Linux" \
  --label "type: enhancement,area: packaging,priority: low" \
  --body "See details in docs/ISSUE_BACKLOG.md (Issue 6)"

gh issue create \
  --title "[UI]: Audit and enhance keyboard tab navigation, focus rings, and screen-reader accessibility" \
  --label "type: enhancement,area: ui,priority: low,good first issue" \
  --body "See details in docs/ISSUE_BACKLOG.md (Issue 7)"

gh issue create \
  --title "[Packaging]: Optimize NSIS installer package size and prune redundant dependencies" \
  --label "type: enhancement,area: packaging,priority: low" \
  --body "See details in docs/ISSUE_BACKLOG.md (Issue 8)"
```

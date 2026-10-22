# MantiCollect — Release Checklist & Deployment Procedure

This checklist defines the required verification steps before tagging, packaging, and publishing any production release of MantiCollect.

---

## Pre-Release Verification (Local Environment)

- [ ] **1. Clean Working Tree**
  - Verify `git status` shows no uncommitted or untracked changes.
  - Ensure the release branch is branched directly from `main`.

- [ ] **2. Version Consistency**
  - Verify version in `package.json` matches target release (e.g. `0.1.0`).
  - Verify version in `package-lock.json` matches `package.json`.
  - Verify version in `browser-extension/manifest.json` matches release target.
  - Verify version in `app/(desktop)/about/page.jsx` matches release target.

- [ ] **3. Changelog Maintenance**
  - Update `CHANGELOG.md` with all new features, fixes, security improvements, and breaking changes under the target version section.

- [ ] **4. Test Suite Execution**
  ```bash
  npm test
  ```
  - Confirm 100% test pass rate with zero failures or skipped critical tests.

- [ ] **5. Production Renderer Build**
  ```bash
  npm run build
  ```
  - Verify all 17 App Router routes are exported to `dist/` without errors.

- [ ] **6. Electron Application Smoke Test**
  ```bash
  npm run smoke
  ```
  - Verify Electron loads `dist/index.html` and exits cleanly with `SMOKE PASS`.

- [ ] **7. Browser Extension Packaging**
  ```bash
  npm run package:extension
  ```
  - Verify `release/manticollect-browser-extension-v<version>.zip` and `release/browser-extension-unpacked` are produced and verified.

- [ ] **8. Local Installer Build & Verification**
  ```bash
  npm run dist
  ```
  - Verify `release/MantiCollect-Setup-<version>.exe` is created.
  - Verify executable size is within expected parameters (~250 MB).
  - Verify installer metadata (Product: MantiCollect, Company: Mantitup).

- [ ] **9. Checksum Generation**
  ```powershell
  Get-FileHash release/*.exe, release/*.zip -Algorithm SHA256 | Format-List
  ```
  - Record SHA-256 hashes for release documentation.

- [ ] **10. Upgrade & Data-Preservation Verification**
  - Verify that running migration does not overwrite existing SQLite databases or settings.
  - Confirm existing credentials in `%APPDATA%\MantiCollect\credentials.enc` remain readable.

---

## GitHub Release Pipeline (Remote CI)

- [ ] **11. Authorized Version Tag Creation**
  - **Do NOT create or push tags without explicit maintainer approval.**
  ```bash
  git tag -a v<version> -m "Release v<version>"
  git push origin v<version>
  ```

- [ ] **12. Release Workflow Execution**
  - Monitor `.github/workflows/release.yml` run in GitHub Actions.
  - Verify Windows runner builds installer, runs tests, packages extension, and generates `SHA256SUMS.txt`.

- [ ] **13. Draft Release Inspection**
  - Navigate to GitHub Releases.
  - Verify the new release is in **Draft** state (never automatically published).
  - Verify attached binaries:
    - `MantiCollect-Setup-<version>.exe`
    - `manticollect-browser-extension-v<version>.zip`
    - `SHA256SUMS.txt`
    - `latest.yml`
  - Review release notes, Authenticode signature status declaration, and checksums.

- [ ] **14. Explicit Publication Approval**
  - Only after manual maintainer review, click **Publish release** on GitHub.

---

## Post-Release Verification

- [ ] **15. Download & Install Verification**
  - Download the published installer from the GitHub Release page on a clean Windows machine.
  - Verify SHA-256 checksum matches `SHA256SUMS.txt`.
  - Install to standard per-user directory `%LOCALAPPDATA%\Programs\MantiCollect`.
  - Confirm desktop and Start Menu shortcuts function correctly.
  - Launch application, verify queue, settings, and library.

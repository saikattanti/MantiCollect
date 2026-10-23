# MantiCollect — Release Checklist & Deployment Procedure

This document defines the formal deployment and verification procedure for production releases of **MantiCollect (A Mantitup Product)**.

Actions are explicitly categorized into **[OWNER ACTION]** (manual maintainer decision points) and **[AUTOMATED]** (CI/CD pipeline and scripted validations).

---

## Phase 1: Pre-Release Local Verification

- [ ] **1. [OWNER ACTION] Verify Intended Release Version & Scope**
  - Confirm target version matches semantic versioning conventions (e.g. `0.1.0`).
  - Verify version in `package.json` (`"version": "0.1.0"`).
  - Verify version in `browser-extension/manifest.json` (`"version": "1.0.0"`).
  - Verify version displayed in `app/(desktop)/about/page.jsx`.

- [ ] **2. [OWNER ACTION] Changelog Review**
  - Verify `CHANGELOG.md` accurately documents all new features, bug fixes, and security enhancements under the target version section.

- [ ] **3. [AUTOMATED] Run Repository Verification**
  ```powershell
  npm run verify
  ```
  - Confirms all 50 repository hygiene, link, image, and YAML syntax checks pass.

- [ ] **4. [AUTOMATED] Execute Full Test Suite**
  ```powershell
  npm test
  ```
  - Confirms 100% pass rate (216/216 tests passing).

- [ ] **5. [AUTOMATED] Production Static Export Build**
  ```powershell
  npm run build
  ```
  - Confirms all 17 Next.js App Router routes export cleanly to `dist/`.

- [ ] **6. [AUTOMATED] Headless Electron Smoke Test**
  ```powershell
  npm run smoke
  ```
  - Confirms Electron boots, loads `dist/index.html`, and reports `SMOKE PASS`.

- [ ] **7. [AUTOMATED] Package Browser Extension**
  ```powershell
  npm run package:extension
  ```
  - Confirms extension manifest, asset files, unpacked directory, and ZIP archive (`manticollect-browser-extension-v1.0.0.zip`).

---

## Phase 2: Remote CI & Git Synchronization

- [ ] **8. [OWNER ACTION] Push Approved Commits to `origin/main`**
  ```powershell
  git push origin main
  ```

- [ ] **9. [AUTOMATED / OWNER ACTION] Verify Remote Continuous Integration**
  ```powershell
  gh run list --workflow ci.yml --repo saikattanti/MantiCollect --limit 3
  ```
  - Ensure the CI workflow for the pushed commit finishes with status **completed (success)**.

- [ ] **10. [OWNER ACTION] Verify and Push Version Tag**
  - Verify local tag points to the intended commit:
    ```powershell
    git tag -l --points-at HEAD
    git show v<version> --no-patch
    ```
  - If creating a new tag:
    ```powershell
    git tag -a v<version> -m "Release v<version>"
    git push origin v<version>
    ```

---

## Phase 3: Release Pipeline Execution & Artifact Validation

- [ ] **11. [AUTOMATED] Release Pipeline Build & Verification (`release.yml`)**
  - Tag push automatically triggers the release workflow on `windows-latest`.
  - `build-and-package` job executes:
    - Version tag validation against `package.json`.
    - `npm ci`, icon generation, extension packaging.
    - Test suite execution (216 tests).
    - Production build and smoke test.
    - Windows NSIS installer build (`electron-builder`).
    - Distributable artifact discovery and non-empty check.
    - SHA-256 checksum manifest creation (`release/SHA256SUMS.txt`).
    - Upload of release artifacts.

- [ ] **12. [AUTOMATED] Checksum Recalculation & Integrity Gate**
  - `publish-draft-release` job:
    - Checks out repository context.
    - Downloads distributable artifacts.
    - Recalculates SHA-256 hashes of every downloaded binary.
    - Strictly matches hashes against `SHA256SUMS.txt`.
    - Fails immediately if any file is missing or hash does not match.

- [ ] **13. [AUTOMATED] Draft GitHub Release Creation**
  - Creates a **Draft** release on GitHub via `gh release create --draft`.
  - Attaches verified binaries:
    - `MantiCollect-Setup-<version>.exe`
    - `manticollect-browser-extension-v<version>.zip`
    - `SHA256SUMS.txt`
  - *Draft status guarantees that release is never visible publicly without maintainer approval.*

---

## Phase 4: Maintainer Review & Manual Publication

- [ ] **14. [OWNER ACTION] Inspect Draft Release on GitHub**
  - Open [https://github.com/saikattanti/MantiCollect/releases](https://github.com/saikattanti/MantiCollect/releases).
  - Verify release title, notes, and attached assets.
  - Review Authenticode code signing declaration.

- [ ] **15. [OWNER ACTION] Download and Verify Release Assets on Clean Machine**
  - Download `MantiCollect-Setup-<version>.exe` and `SHA256SUMS.txt`.
  - Verify checksum in PowerShell:
    ```powershell
    (Get-FileHash MantiCollect-Setup-<version>.exe -Algorithm SHA256).Hash
    ```
  - Execute installer:
    - Confirm installation to `%LOCALAPPDATA%\Programs\MantiCollect`.
    - Confirm Desktop and Start Menu shortcuts.
    - Confirm application launch, settings persistence, and existing database preservation.
  - Test browser extension in Google Chrome or Microsoft Edge.

- [ ] **16. [OWNER ACTION] Publish Release**
  - Only when all verification criteria are satisfied, edit the Draft Release on GitHub and click **Publish release**.

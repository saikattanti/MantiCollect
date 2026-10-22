# Contributing to MantiCollect

Thank you for your interest in contributing to MantiCollect (A Mantitup Product)! We welcome contributions that improve reliability, performance, user experience, and security.

---

## 1. Prerequisites

Before setting up MantiCollect locally, ensure you have:

* **Node.js**: Version `20.x` or `22.x` (LTS recommended).
* **npm**: Version `10.x` or newer.
* **Operating System**: Windows 10/11 x64 (primary supported desktop environment).
* **Git**: Installed and configured.
* **C++ Build Tools** (Optional/Windows): For rebuilding native modules (`better-sqlite3`) if required via `npm run postinstall`.

---

## 2. Getting Started

### Fork and Clone
```bash
# Clone your fork
git clone https://github.com/<your-username>/MantiCollect.git
cd MantiCollect

# Add upstream remote
git remote add upstream https://github.com/saikattanti/MantiCollect.git
```

### Install Dependencies
```bash
npm install
```
*(This automatically runs `electron-builder install-app-deps` to align native binaries with the bundled Electron version).*

### Run the Development Server
```bash
npm run dev
```
This launches the Next.js renderer on port 3000 and boots the Electron main process concurrently.

---

## 3. Development Scripts

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Start renderer dev server and launch Electron with hot-reloading |
| `npm test` | Run complete Node.js test suite across all 215+ tests |
| `npm run build` | Build optimized Next.js static production export (`dist/`) |
| `npm run smoke` | Run headless Electron startup smoke test |
| `npm run generate-icons` | Regenerate app and extension icons from `public/` brand assets |
| `npm run package:extension`| Package Manifest V3 browser extension to `release/` |
| `npm run dist` | Build production Windows NSIS installer (`release/`) |

---

## 4. Coding Standards

* **Architecture Integrity**:
  - Main Process: Node.js / Electron logic resides in `electron/`.
  - Renderer Process: React / Next.js App Router components reside in `app/` and `src/`.
  - Security Boundary: Never expose raw Node.js modules (`fs`, `child_process`, `net`) directly to renderer. All IPC calls must pass through `electron/preload.cjs` with context isolation enabled.
* **Styling**: Vanilla CSS and Tailwind CSS classes. Follow existing dark-mode design system.
* **Asynchronous Safety**: Handle stream errors, socket timeouts, and process terminations explicitly. Never leak file handles or child processes.
* **Preserve Existing Architecture**: Do not replace the existing SQLite database, download queue, segmented engine, or conversion pipeline without prior discussion.

---

## 5. Branch Naming & Commit Conventions

### Branch Naming
Create focused feature or bugfix branches:
* `feature/<short-description>` (e.g. `feature/audio-stream-selector`)
* `fix/<short-description>` (e.g. `fix/sftp-reconnection-retry`)
* `docs/<short-description>` (e.g. `docs/architecture-update`)

### Commit Messages
We follow Conventional Commits formatting:
```
<type>(<scope>): <short description in imperative mood>

[optional detailed body]
```
Common types:
* `feat`: A new feature
* `fix`: A bug fix
* `docs`: Documentation changes
* `test`: Adding or modifying tests
* `refactor`: Code changes that neither fix a bug nor add a feature
* `chore`: Build tasks, package updates, workflow changes

---

## 6. Pull Request Requirements

Before opening a pull request, verify:

1. **Tests Pass**: `npm test` passes completely with zero failures.
2. **Build Succeeds**: `npm run build` generates the static export cleanly.
3. **Smoke Test Passes**: `npm run smoke` reports `SMOKE PASS`.
4. **Extension Validates**: `npm run package:extension` packages cleanly.
5. **No Credentials or Private Data**: Verify no passwords, tokens, or machine-specific paths are committed.
6. **Documentation Updated**: Update relevant markdown docs if user-facing behavior changes.
7. **Single Focus**: Keep PRs scoped to one issue or feature.

---

## 7. Security-Sensitive Contributions

If your PR touches security-sensitive areas (IPC channels in `electron/ipc.js`, preload bridge in `electron/preload.cjs`, loopback bridge in `electron/bridge/`, URL validator in `validator.js`, or credential encryption in `credentials.js`):

* Add explicit automated regression tests in `test/`.
* Verify SSRF protections remain enforced (`assertPublicUrl`).
* Ensure error messages do not leak secrets, tokens, or full filesystem paths.
* Flag the security implications clearly in your PR description.

# MantiCollect — Project Governance, Repository Metadata & GitHub Setup Guide

**Product:** MantiCollect — A Mantitup Product  
**Repository:** [https://github.com/saikattanti/MantiCollect](https://github.com/saikattanti/MantiCollect)

This guide documents the recommended GitHub project configuration, security settings, community discussions, and milestones for project maintainers.

---

## 1. Repository Metadata & About Section

Apply the following metadata in the GitHub repository **About** settings (gear icon on repository home page):

| Setting | Recommended Value | Notes |
| :--- | :--- | :--- |
| **Description** | `Local-first universal desktop media downloader and digital collector built with Electron, Next.js, and yt-dlp.` | Accurate reflection of core stack and offline-first principles. |
| **Website** | *(Leave blank until an official website/domain is launched)* | Do not use placeholder or nonexistent domains. |
| **Topics** | `electron`, `nextjs`, `react`, `media-downloader`, `yt-dlp`, `desktop-app`, `windows`, `open-source`, `javascript` | Improves discoverability in GitHub search and topic tags. |
| **Include in home page** | :white_check_mark: Releases, :white_check_mark: Packages (uncheck), :white_check_mark: Environments (uncheck) | Releases is the primary distribution channel. |
| **Social Preview Image** | `public/MantiCollect-full-logo.png` | Upload the existing approved 1280x640 brand asset from `public/`. |

---

## 2. GitHub Security & Vulnerability Features

Configure under **Settings → Code security and analysis**:

1. **Private Vulnerability Reporting**:
   - Status: **Enable**
   - Enables security researchers to submit private advisories via `SECURITY.md`.
2. **Dependency Graph**:
   - Status: **Enable**
   - Tracks npm dependencies from `package-lock.json`.
3. **Dependabot Alerts**:
   - Status: **Enable**
   - Alerts maintainers when a vulnerable npm package is detected.
4. **Dependabot Security Updates**:
   - Status: **Enable**
   - Works with `.github/dependabot.yml` to automatically submit minimal patch PRs for known CVEs.
5. **Secret Scanning & Push Protection**:
   - Status: **Enable**
   - Blocks accidental commits containing AWS keys, GitHub tokens, or private certificates.

---

## 3. GitHub Discussions Setup

Under **Settings → General → Features**, enable **Discussions**.

Recommended category structure:
* :loudspeaker: **Announcements**: Release notes, roadmap updates, and project news (maintainer-only posting).
* :speech_balloon: **General**: Open community chat, feedback, and informal conversation.
* :bulb: **Ideas**: Feature proposals, workflow brainstorming, and community suggestions.
* :raising_hand: **Q&A**: Questions about installation, configuration, and format support (with marked answers).
* :tada: **Show and Tell**: Community setups, storage architectures, and integration scripts.

---

## 4. GitHub Project Board Workflow

Create a GitHub Project (Board layout) titled **MantiCollect Development & Release**:

### Columns:
1. **Backlog**: Prioritized ideas and incoming features from `docs/ISSUE_BACKLOG.md`.
2. **Ready**: Triaged issues with clear acceptance criteria ready for implementation.
3. **In Progress**: Work actively assigned and under development.
4. **In Review**: Pull requests submitted and undergoing CI testing and code review.
5. **Done**: Merged changes verified in `main`.

---

## 5. Release Milestones

Create the following milestones under **Issues → Milestones**:

| Milestone | Target Version | Objective |
| :--- | :--- | :--- |
| **v0.1.0** | `0.1.0` | Initial open-source release with Windows NSIS installer, Manifest V3 browser extension, multi-connection segmented downloads, and local library. |
| **v0.2.0** | `0.2.0` | Authenticode code signing automation, live cloud test suite (S3/SFTP/WebDAV), accessibility enhancements, and S3 multipart resumption. |
| **v1.0.0** | `1.0.0` | Chrome Web Store & Edge Add-ons public submission, cross-platform engine evaluation, and production auto-update feed. |

---

## 6. Distinction Between Local Files and GitHub-Applied Settings

* **Present Locally in Repository**:
  * CI & Release Workflows: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
  * Issue Forms & PR Template: `.github/ISSUE_TEMPLATE/*.yml`, `.github/PULL_REQUEST_TEMPLATE.md`
  * Labels Definition: `.github/labels.yml`
  * Dependabot Configuration: `.github/dependabot.yml`
  * Community Policies: `LICENSE`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `CONTRIBUTING.md`
  * Architecture & Guides: `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/RELEASE_CHECKLIST.md`, `docs/ISSUE_BACKLOG.md`, `CHANGELOG.md`
* **Settings Requiring GitHub Web UI / Maintainer Permissions**:
  * Enabling Discussions and defining discussion categories.
  * Enabling Private Vulnerability Reporting and Dependabot Alerts.
  * Creating GitHub Project board and columns.
  * Setting repository About description, topics, and social preview banner.
  * Publishing drafted releases.

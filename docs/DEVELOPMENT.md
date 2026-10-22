# MantiCollect — Developer Guide & Setup

**Product:** MantiCollect — A Mantitup Product  
**Environment:** Windows 10/11 x64, Node.js 20+

---

## 1. Local Development Setup

### 1.1 Prerequisites
* **Node.js**: `v20.x` or `v22.x` (LTS).
* **npm**: `v10.x` or higher.
* **Git**: Installed and in PATH.
* **Build Tools**: Visual Studio C++ Build Tools or Windows SDK (for compiling `better-sqlite3` native binaries if prebuilds are not fetched).

### 1.2 Initial Installation
```bash
git clone https://github.com/saikattanti/MantiCollect.git
cd MantiCollect
npm install
```

### 1.3 Running in Development Mode
```bash
npm run dev
```
This script launches two concurrent processes:
1. `next dev -p 3000`: Starts Next.js development server on `http://127.0.0.1:3000`.
2. `electron .`: Boots Electron once port 3000 is listening, loading the live Next.js interface with fast refresh and hot module replacement.

---

## 2. Directory Structure

```
multi-downloader/
├── app/                        # Next.js App Router pages and routes
│   └── (desktop)/              # Desktop route layouts
├── browser-extension/          # Manifest V3 browser extension
│   ├── manifest.json           # Extension manifest
│   ├── background.js           # Background service worker
│   ├── popup.html / popup.js   # Extension toolbar popup interface
│   └── icons/                  # 16, 32, 48, 128 px PNG icons
├── electron/                   # Electron Main Process modules
│   ├── main.js                 # Electron app entry point & lifecycle
│   ├── preload.cjs             # ContextBridge isolated IPC bridge
│   ├── ipc.js                  # IPC channel message handlers
│   ├── db.js                   # better-sqlite3 database initialization & WAL
│   ├── queue.js                # Download job queue management
│   ├── runner.js               # Multi-connection segmented download runner
│   ├── bandwidth.js            # Token-bucket bandwidth throttling
│   ├── converter.js            # FFmpeg conversion engine
│   ├── library.js              # Media file scanner & library queries
│   ├── credentials.js          # AES-256-GCM encrypted credential vault
│   ├── remoteStorage.js        # S3, WebDAV, and SFTP clients
│   ├── backupScheduler.js      # Automated cloud backup scheduling
│   ├── tray.js                 # Windows system tray integration
│   ├── updater.js              # Auto-updater lifecycle
│   └── bridge/                 # Browser integration bridges
│       ├── loopbackServer.js   # Authenticated 127.0.0.1 HTTP bridge
│       ├── nativeMessaging.js  # Chromium stdio length-prefixed IPC framing
│       └── validator.js        # Untrusted URL & submission validator
├── native-host/                # Native Messaging Host Windows scripts
│   ├── manticollect_host.js    # Stdio IPC message handler
│   ├── manticollect_host.bat   # Windows launcher with Electron fallback
│   ├── com.mantitup.manticollect.json # Chrome native host manifest
│   ├── com.mantitup.manticollect.edge.json # Edge native host manifest
│   ├── register-host-windows.bat # Registry registration batch script
│   └── register-host-windows.ps1 # Registry registration PowerShell script
├── public/                     # Approved brand logos and static assets
├── scripts/                    # Automation scripts
│   ├── generate-icons.mjs      # Brand icon generation
│   ├── package-extension.mjs   # Browser extension ZIP & unpacked packager
│   └── smoke.mjs               # Headless Electron smoke test
├── src/                        # React UI components & styling
└── test/                       # Node.js native test suite
```

---

## 3. Testing Workflows

MantiCollect uses Node.js's native test runner (`node:test` and `node:assert/strict`) for deterministic, fast, zero-dependency testing.

### Running All Tests
```bash
npm test
```
Executes all 215+ tests across all subsystems:
* Download queue and database recovery
* Multi-connection segmented downloads and 206 range planning
* yt-dlp parsing and error mapping
* S3 multipart upload and WebDAV / SFTP storage
* Encrypted credential storage and isolation
* System tray and lifecycle behavior
* Loopback HTTP bridge authentication and DNS rebinding protections
* Browser extension packaging and Native Messaging framing
* User-data migration safety and data preservation

### Running a Specific Test File
```bash
node --test test/browser-integration.test.js
node --test test/distribution-safety.test.js
node --test test/extension-safety.test.js
```

### Production Build & Smoke Testing
```bash
# Build production Next.js static bundle to dist/
npm run build

# Run headless Electron boot and window load smoke test
npm run smoke
```

---

## 4. Testing Browser Integration Locally

1. Open Chrome or Edge to `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select `D:\Projects\multi-downloader\browser-extension`.
4. Copy the extension ID shown in the extensions list.
5. In PowerShell:
   ```powershell
   cd native-host
   .\register-host-windows.ps1 -ExtensionId <YOUR_EXTENSION_ID>
   ```
6. Start MantiCollect (`npm run dev`).
7. Open the extension popup in your browser. The connection badge will switch to green **Connected (Native Messaging)**.

---

## 5. Building the Production Installer Locally

```bash
npm run dist
```
Generates the Windows NSIS installer in `release/`:
* `release/MantiCollect-Setup-0.1.0.exe`
* `release/latest.yml`
* `release/*.blockmap`

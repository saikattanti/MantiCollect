# MantiCollect — Distribution, Installation, and Integration Guide

A Mantitup Product • Version 0.1.0 • Windows x64 Distribution

---

## 1. Distribution Artifacts Overview

When downloading or preparing a MantiCollect distribution package, the following production artifacts are generated in the `release/` directory:

| Artifact | Type | Description | Intended Destination |
| :--- | :--- | :--- | :--- |
| `MantiCollect-Setup-0.1.0.exe` | Windows Installer (NSIS) | Nullsoft Windows Installer executable. Installs per-user without requiring Administrator elevation. | `%LOCALAPPDATA%\Programs\MantiCollect` |
| `manticollect-browser-extension-v1.0.0.zip` | Browser Extension ZIP | Packaged Manifest V3 browser extension archive for distribution. | Unpack or upload to store dashboards |
| `browser-extension-unpacked/` | Directory | Clean, ready-to-load directory containing manifest, service worker, popup UI, and branded icons. | Chrome/Edge Developer Mode |
| `native-host/` | Directory / Scripts | Chromium Native Messaging Host script, manifests, and registration scripts for Windows. | Included in application installation |

---

## 2. Windows Desktop Application Installation

### Fresh Installation
1. Double-click `MantiCollect-Setup-0.1.0.exe`.
2. The NSIS installer will guide you through installation.
   - **Default Install Directory**: `%LOCALAPPDATA%\Programs\MantiCollect\`
   - **Custom Install Directory**: You can choose a custom directory (e.g. `D:\Tools\MantiCollect`). Paths containing spaces are supported.
   - **Elevation**: Per-user installation runs entirely under standard user privileges. No administrative UAC prompt is required.
3. The installer creates:
   - Start Menu shortcut: `MantiCollect`
   - Desktop shortcut: `MantiCollect`
4. On first launch, MantiCollect initializes its local SQLite database and configuration files in `%APPDATA%\MantiCollect\`.

### Upgrades & Data Preservation
- When running an installer for a newer version over an existing installation:
  - Existing user databases (`%APPDATA%\MantiCollect\mediavault.db`, WAL, and SHM files) are **strictly preserved**.
  - Download history, library items, remote storage credentials (S3, WebDAV, SFTP), and user settings are never overwritten.
  - Legacy configuration and data from previous releases (e.g. MediaVault directory) are non-destructively migrated without deleting or modifying original source files.

### Uninstallation
1. Open Windows **Settings → Apps → Installed apps**.
2. Locate **MantiCollect** and click **Uninstall** (or run `Uninstall MantiCollect.exe` in `%LOCALAPPDATA%\Programs\MantiCollect\`).
3. User media library files and finished downloads are **never deleted** during uninstallation.

---

## 3. Browser Extension Installation

MantiCollect provides a Manifest V3 browser extension for Google Chrome and Microsoft Edge.

### Installing in Google Chrome
1. Extract `manticollect-browser-extension-v1.0.0.zip` (or locate `release/browser-extension-unpacked/`).
2. Open Google Chrome and navigate to:
   ```
   chrome://extensions
   ```
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** in the top-left toolbar.
5. Select the `browser-extension-unpacked` folder (or extracted directory).
6. The **MantiCollect — Download Manager** extension icon will appear in your browser toolbar. Pin it for quick access.
7. Note your extension ID (a 32-character string, e.g. `abcdefghijklmnopqrstuvwxyzabcdef`).

### Installing in Microsoft Edge
1. Open Microsoft Edge and navigate to:
   ```
   edge://extensions
   ```
2. Enable the **Developer mode** switch in the left sidebar.
3. Click **Load unpacked**.
4. Select the `browser-extension-unpacked` folder.
5. The extension is now active.

---

## 4. Native Messaging Host Registration

The Native Messaging Host provides high-speed, secure inter-process communication between your browser and the MantiCollect desktop application without requiring open network ports.

### Automatic Windows Registration
In PowerShell (or Command Prompt), run:
```powershell
# Open native-host directory
cd native-host

# Option A: Register with your specific extension ID (Recommended)
.\register-host-windows.ps1 -ExtensionId <YOUR_EXTENSION_ID>

# Option B: Run standard registration batch script
.\register-host-windows.bat <YOUR_EXTENSION_ID>
```

### Registry Keys Created
Registration creates per-user registry entries under `HKEY_CURRENT_USER` (no Administrator rights required):
- **Chrome**: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.mantitup.manticollect`
- **Edge**: `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.mantitup.manticollect`

Each registry value points to the manifest JSON file specifying `stdio` communication via `manticollect_host.bat`.

### Runtime Execution without Global Node.js
If Node.js is not globally installed on the system, `manticollect_host.bat` automatically invokes the packaged Electron runtime using:
```bat
set ELECTRON_RUN_AS_NODE=1
"%LOCALAPPDATA%\Programs\MantiCollect\MantiCollect.exe" "%~dp0manticollect_host.js"
```
This ensures zero external runtime dependencies for standard end users.

---

## 5. Loopback HTTP Bridge (Alternative / Development)

If Native Messaging is not configured, the extension falls back automatically to an authenticated loopback HTTP bridge.

1. Launch MantiCollect desktop application.
2. Navigate to **Settings → Browser Integration**.
3. Under **Extension Authorization Token**, click **Copy Token**.
4. Click the MantiCollect extension icon in your browser toolbar.
5. Expand **Bridge Settings**.
6. Paste the token into **Auth Token** and verify the port (default `52443`).
7. Click **Save Settings**. The connection badge turns green: **Connected (Loopback Bridge)**.

### Security Boundaries
- **Strict IP Binding**: The bridge listens exclusively on `127.0.0.1` (never `0.0.0.0`).
- **DNS Rebinding Guard**: Enforces `Host: 127.0.0.1:<port>` or `Host: localhost:<port>`. Remote or spoofed Host headers return `403 Forbidden`.
- **Payload Limiting**: Maximum request body size is capped at 64 KB.
- **Rate Limiting**: Rate limited to 60 requests per minute.
- **SSRF Prevention**: All target URLs pass strict scheme and address checks before acceptance.

---

## 6. Optional Download Interception & Consent

MantiCollect adheres to strict user consent principles:
- **Default State**: Browser download interception is **strictly disabled by default**.
- **Normal Browser Behavior**: When disabled, all browser downloads proceed through Chrome or Edge normally. No downloads are intercepted, cancelled, or erased.
- **Enabling Interception**:
  1. Click the MantiCollect extension toolbar icon.
  2. Open **Bridge Settings**.
  3. Check **Enable Browser Download Interception**.
  4. Click **Save Settings**.
- **Fail-Safe Fallback Guarantee**:
  - The extension sends an enqueue request to MantiCollect with the download URL.
  - The browser download is **never cancelled** unless MantiCollect explicitly confirms successful queueing with an `ok: true` response.
  - If MantiCollect is closed, unresponsive, times out, or rejects the URL, the browser download continues completely uninterrupted. Browser download history is never deleted on failure.

---

## 7. Troubleshooting Disconnected States

| Symptom | Probable Cause | Diagnostic & Resolution |
| :--- | :--- | :--- |
| **Badge shows "Not Connected"** | MantiCollect desktop application is not running | Launch MantiCollect from Start Menu or desktop shortcut. |
| **Badge remains "Checking…"** | Host registration missing or token incorrect | Open extension **Bridge Settings**. If using Loopback, verify Auth Token matches MantiCollect Settings. If using Native Host, run `register-host-windows.bat`. |
| **"URL is already active"** | Idempotent duplicate protection | The URL is already downloading or waiting in the active queue. Open MantiCollect to monitor progress. |
| **"System/internal pages cannot be downloaded"** | Restricted browser scheme | Chrome internal pages (`chrome://*`, `edge://*`, `file://*`) cannot be captured by design. |
| **Port conflict (52443)** | Another application is using port 52443 | In MantiCollect Settings, adjust `browserBridgePort` to an available port (e.g. 52444) and update extension settings accordingly. |

---

## 8. Safe Uninstallation & Cleanup

To cleanly remove MantiCollect and all integrations:
1. **Remove Browser Extension**: In `chrome://extensions` or `edge://extensions`, click **Remove**.
2. **Unregister Native Host**:
   ```powershell
   cd native-host
   .\unregister-host-windows.ps1
   # Or run unregister-host-windows.bat
   ```
   This deletes the `NativeMessagingHosts` registry entries from `HKCU`.
3. **Uninstall Desktop Application**: Run Windows Settings → Apps → MantiCollect → **Uninstall**.
4. **User Data Directory** (Optional): If you wish to delete all settings and download databases, remove `%APPDATA%\MantiCollect\`. Downloaded media files in your download folder are left untouched.

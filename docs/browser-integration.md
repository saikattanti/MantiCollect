# MantiCollect — Browser Integration & Extension Guide

MantiCollect (A Mantitup Product) provides seamless, secure browser integration for Chromium-based browsers, including **Google Chrome** and **Microsoft Edge**.

---

## 1. Overview & Architecture

The browser integration enables users to send supported download URLs directly from their browser to MantiCollect without sacrificing local-first privacy, security, or stability.

### Key Capabilities
1. **Toolbar Extension Popup**: Displays active tab URL, provider detection, live bridge connection status, and one-click submission.
2. **Context Menus**:
   - Right-click any link: **"Download with MantiCollect"**
   - Right-click any page: **"Send Page URL to MantiCollect"**
   - Right-click highlighted text: **"Download Selection in MantiCollect"**
3. **Dual Bridge Communication**:
   - **Native Messaging Host (Primary / Hardened)**: Official Chromium stdio length-prefixed IPC (`stdin`/`stdout`). Completely isolated from web pages with zero open network ports.
   - **Authenticated Loopback HTTP Bridge (Fallback / Dev)**: Strictly bound to `127.0.0.1` and secured with a 256-bit cryptographically generated Bearer token, Host header enforcement, and rate limiting.
4. **Consent-Driven Clipboard Detection**: Detects supported media URLs when copied. Prompts for explicit user confirmation before enqueueing; never downloads automatically or logs arbitrary clipboard contents.
5. **Optional Download Interception**: When explicitly enabled in settings, captures browser file downloads and transfers them to MantiCollect.

---

## 2. Security Safeguards

- **Untrusted Input Boundary**: Every URL from the browser extension or clipboard is treated as untrusted and passes through `validateBrowserSubmission`.
- **Allowed Schemes**: Strictly `http:` and `https:`. All other schemes (`javascript:`, `data:`, `file:`, `chrome:`, `edge:`, `blob:`) are rejected.
- **Credential Protection**: URLs with embedded credentials (e.g. `https://user:pass@host/`) are blocked.
- **SSRF & Private Network Isolation**: Protected via `assertPublicUrl`. Loopback and private IP ranges are blocked by default unless the developer option `allowLocalNetwork` is enabled in Settings.
- **No Arbitrary Commands**: External processes (yt-dlp, FFmpeg) receive parameters as fixed argv arrays; shell interpolation is never used.
- **No Filesystem Traversal**: The browser extension cannot specify destination paths or filenames. All downloads route to the user-configured download folder.
- **Loopback Attack Mitigation**:
  - The loopback HTTP server binds strictly to `127.0.0.1`.
  - Rejects any request with an unexpected `Host` header (blocks DNS rebinding).
  - All endpoints require a valid `Authorization: Bearer <token>` header.
  - Strict 64 KB request payload limit and rate limiting.

---

## 3. Directory Layout

```
multi-downloader/
├── browser-extension/
│   ├── manifest.json              # Chromium Manifest V3 definition
│   ├── background.js              # Service worker (context menus, bridge relay, interception)
│   ├── popup.html                 # MantiCollect branded popup
│   ├── popup.js                   # Popup tab detection and enqueue actions
│   ├── popup.css                  # Modern dark-theme styling
│   └── icons/                     # 16, 32, 48, 128 px PNG icons
├── native-host/
│   ├── manticollect_host.js       # Native Messaging stdio frame handler
│   ├── manticollect_host.bat      # Windows batch launcher
│   ├── manticollect_host.sh       # Unix launcher
│   ├── com.mantitup.manticollect.json # Chrome host manifest
│   ├── com.mantitup.manticollect.edge.json # Edge host manifest
│   ├── register-host-windows.bat  # Automated Windows registry registration
│   ├── register-host-windows.ps1  # PowerShell registration script
│   ├── register-host-unix.sh      # macOS and Linux setup script
│   └── unregister-host-windows.bat# Cleanup script
└── electron/
    ├── bridge/
    │   ├── loopbackServer.js      # Authenticated 127.0.0.1 HTTP bridge
    │   ├── nativeMessaging.js     # Protocol framing parser and encoder
    │   └── validator.js           # Untrusted browser input validator
    └── clipboard.js               # Consent-driven clipboard URL observer
```

---

## 4. Installation & Setup

### Step 1: Load the Unpacked Extension in Chrome or Edge
1. Open Google Chrome or Microsoft Edge.
2. Navigate to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode** (toggle in top right or sidebar).
4. Click **Load unpacked**.
5. Select the `browser-extension` folder inside the MantiCollect directory:
   ```
   D:\Projects\multi-downloader\browser-extension
   ```
   *(You can quickly copy this path from MantiCollect Settings → Browser Integration).*

### Step 2: Configure Bridge Communication

#### Option A: Native Messaging Host (Recommended for Production)
- **Windows**:
  Run `register-host-windows.bat` or `register-host-windows.ps1` from the `native-host` directory.
  This registers the host manifest under:
  - `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.mantitup.manticollect`
  - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.mantitup.manticollect`
- **macOS / Linux**:
  Run `./native-host/register-host-unix.sh`.
  This copies the host manifest to your user Application Support or `.config` directory.

#### Option B: Authenticated Loopback Bridge (Quick Setup / Development)
1. Open MantiCollect desktop application.
2. Go to **Settings → Browser Integration**.
3. Click **Copy** next to **Extension Authorization Token**.
4. In your browser toolbar, click the **MantiCollect extension icon**.
5. Click **Bridge Settings** at the bottom of the popup.
6. Paste the token into the **Auth Token** field and click **Save Settings**.
7. The status badge will switch to green **Connected**.

---

## 5. Usage Workflows

### 1. Toolbar Action
Click the MantiCollect toolbar icon on any media page (e.g. YouTube, SoundCloud, direct MP4 file). The extension detects the URL and platform. Click **Send to MantiCollect** to immediately enqueue it.

### 2. Context Menu
Right-click any link on a page and choose **Download with MantiCollect**. A desktop notification and in-app toast confirm acceptance.

### 3. Clipboard Detection (Consent-Driven)
1. In MantiCollect **Settings → Browser Integration**, enable **Clipboard URL Detection**.
2. Whenever you copy a media or video URL anywhere in your OS and switch to MantiCollect, a prompt appears:
   ```
   Download link copied: https://example.com/video.mp4
   [Download Now]  [Dismiss]
   ```
3. Clicking **Download Now** enqueues the job. Dismissing suppresses the URL without downloading.

### 4. Optional Download Interception
1. In the extension popup under **Bridge Settings**, check **Enable Download Interception**.
2. When you initiate a standard browser file download, MantiCollect captures the transfer and accelerates it through its multi-connection segmented engine.

---

## 6. Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **"Not Connected" in popup** | Desktop app not running or token mismatch | Launch MantiCollect and verify the Auth Token in extension Bridge Settings. |
| **"Native host not found"** | Host manifest not registered in registry/config | Run `register-host-windows.bat` as the current user. |
| **"URL is already active"** | Duplicate submission | The URL is already downloading or in queue. Check the Queue tab. |
| **"Unsupported URL"** | System page or unsupported provider | Internal browser pages (`chrome://`, `file://`) cannot be downloaded. |
| **Port Conflict** | Port 52443 occupied | Change `browserBridgePort` in Settings and extension Bridge Settings. |

---

## 7. Uninstallation

1. In `chrome://extensions` or `edge://extensions`, click **Remove** on the MantiCollect extension.
2. On Windows, run `native-host/unregister-host-windows.bat` to remove registry keys.
3. On macOS/Linux, delete `com.mantitup.manticollect.json` from the browser's `NativeMessagingHosts` folder.

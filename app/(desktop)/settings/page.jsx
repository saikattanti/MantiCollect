'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Palette,
  FolderDown,
  Cpu,
  ShieldAlert,
  ShieldCheck,
  Download,
  FolderOpen,
  Monitor,
  Moon,
  Sun,
  Globe,
  Copy,
  RefreshCw,
  ExternalLink,
  Check,
  ClipboardCheck
} from 'lucide-react';
import { api, onEvent } from '@/lib/ipc.js';
import { Button, Card, CardHeader, Input, Label, Select, Toggle, Spinner } from '@/components/ui.jsx';
import { useTheme } from '@/lib/theme.jsx';

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [bins, setBins] = useState(null);
  const [browserInfo, setBrowserInfo] = useState(null);
  const [installing, setInstalling] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testingBridge, setTestingBridge] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    api.settings.get().then(setS).catch(() => {});
    api.bins.status().then(setBins).catch(() => {});
    api.browser.status().then(setBrowserInfo).catch(() => {});
    return onEvent('ytdlp:install', (p) => {
      if (p.phase === 'downloading' && p.total) setInstalling({ phase: p.phase, pct: (p.received / p.total) * 100, message: p.message });
      else setInstalling(p);
    });
  }, []);

  if (!s) {
    return (
      <div className="flex items-center gap-3 py-20 text-sm text-t3">
        <Spinner /> Loading settings…
      </div>
    );
  }

  function set(key, value) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  async function pickDir() {
    const r = await api.selectDirectory();
    if (r.path) set('downloadDir', r.path);
  }

  async function save() {
    setSaving(true);
    try {
      const next = await api.settings.set(s);
      setS(next);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function installYtDlp() {
    setInstalling({ phase: 'starting' });
    try {
      const r = await api.bins.installYtDlp();
      toast.success(`yt-dlp installed (${r.version || 'ok'})`);
      setBins(await api.bins.status());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setInstalling(null);
    }
  }

  async function copyToClipboard(text, label) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }

  async function handleRegenerateToken() {
    try {
      const res = await api.browser.regenerateToken();
      set('browserAuthToken', res.token);
      toast.success('Generated new browser authorization token');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleTestBridge() {
    setTestingBridge(true);
    try {
      const port = s.browserBridgePort || 52443;
      const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
        headers: { Authorization: `Bearer ${s.browserAuthToken}` }
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Bridge connection verified! (${data.app} v${data.version} on port ${port})`);
      } else {
        toast.error(`Bridge returned error: ${data.error}`);
      }
    } catch (err) {
      toast.error(`Bridge unreachable on 127.0.0.1:${s.browserBridgePort || 52443}: ${err.message}`);
    } finally {
      setTestingBridge(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <p className="overline">System</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Settings</h1>
          <p className="mt-1 text-sm text-t2">Stored locally in the app data folder. No cloud, no telemetry.</p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </header>

      <Card>
        <CardHeader title="Appearance" subtitle="Theme applies instantly; Windows 11 Mica is used for the window backdrop automatically" icon={Palette} />
        <div className="p-5">
          <div className="flex gap-2" role="radiogroup" aria-label="Theme">
            {[
              { id: 'dark', label: 'Dark', icon: Moon },
              { id: 'light', label: 'Light', icon: Sun },
              { id: 'system', label: 'System', icon: Monitor }
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="radio"
                aria-checked={theme === id}
                onClick={() => setTheme(id)}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                  theme === id
                    ? 'border-accent/50 bg-accent-soft text-t1 shadow-xs'
                    : 'border-line bg-surface-2/40 text-t2 hover:border-line-strong hover:text-t1'
                }`}
              >
                <Icon style={{ width: 15, height: 15 }} className={theme === id ? 'text-accent-text' : 'text-t3'} />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-t3">
            Dark is the default. “System” follows your Windows appearance. The main window uses the native Mica material on Windows 11 with a solid
            fallback everywhere else, so readability never depends on transparency effects.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Downloads" icon={FolderDown} />
        <div className="space-y-4 p-5">
          <div>
            <Label>Download folder</Label>
            <div className="flex gap-1.5">
              <Input value={s.downloadDir} onChange={(e) => set('downloadDir', e.target.value)} />
              <Button variant="secondary" onClick={pickDir}>
                <FolderOpen style={{ width: 15, height: 15 }} /> Browse
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Max concurrent downloads (1–8)</Label>
              <Select value={s.concurrency} onChange={(e) => set('concurrency', Number(e.target.value))} className="w-full">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Max file size (MB, 0 = unlimited)</Label>
              <Input type="number" min="0" value={s.maxFileSizeMB} onChange={(e) => set('maxFileSizeMB', Number(e.target.value))} />
            </div>
            <div>
              <Label>When a file name already exists</Label>
              <Select value={s.overwrite} onChange={(e) => set('overwrite', e.target.value)} className="w-full">
                <option value="avoid">Keep both (rename new file)</option>
                <option value="overwrite">Overwrite existing</option>
              </Select>
            </div>
            <div>
              <Label>Source probe timeout (ms)</Label>
              <Input type="number" min="5000" max="120000" step="1000" value={s.probeTimeoutMs} onChange={(e) => set('probeTimeoutMs', Number(e.target.value))} />
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface-2/40 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-t1">IDM Multi-Connection Engine</p>
                <p className="mt-0.5 text-xs text-t3">
                  Accelerates eligible direct HTTP downloads by requesting concurrent byte-range streams.
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={s.segmentedDownloads !== false}
                  onChange={(e) => set('segmentedDownloads', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-3 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
              </label>
            </div>
            {s.segmentedDownloads !== false && (
              <div className="mt-3.5 pt-3 border-t border-line/50 flex items-center justify-between">
                <div>
                  <Label>Connections per download</Label>
                  <p className="text-[11px] text-t3">Number of simultaneous Range workers (default 4, max 8).</p>
                </div>
                <Select
                  value={s.maxConnectionsPerDownload || 4}
                  onChange={(e) => set('maxConnectionsPerDownload', Number(e.target.value))}
                  className="w-28"
                >
                  {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} streams
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Browser Integration"
          subtitle="Send downloads from Google Chrome and Microsoft Edge to MantiCollect"
          icon={Globe}
        />
        <div className="space-y-4 p-5">
          {/* Bridge Status Bar */}
          <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 p-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-ok"></span>
              </span>
              <div>
                <p className="text-[13px] font-semibold text-t1">
                  Local Bridge Active
                </p>
                <p className="text-xs text-t3">
                  Listening on 127.0.0.1:{s.browserBridgePort || 52443} (Loopback only)
                </p>
              </div>
            </div>
            <Button variant="secondary" onClick={handleTestBridge} disabled={testingBridge}>
              <RefreshCw className={`w-3.5 h-3.5 ${testingBridge ? 'animate-spin' : ''}`} />
              {testingBridge ? 'Testing…' : 'Test Connection'}
            </Button>
          </div>

          {/* Extension Installation Helper */}
          <div className="rounded-xl border border-line bg-bg-elev/40 p-4 space-y-3">
            <div>
              <Label>Chromium Extension (Chrome & Edge)</Label>
              <p className="text-xs text-t3 mb-2">
                Load unpacked extension in <code className="px-1 py-0.5 rounded bg-surface-3 text-t2 font-mono text-[11px]">chrome://extensions</code> or <code className="px-1 py-0.5 rounded bg-surface-3 text-t2 font-mono text-[11px]">edge://extensions</code> with Developer Mode enabled:
              </p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={browserInfo?.extensionDir || 'Loading…'}
                  className="font-mono text-xs select-all"
                />
                <Button
                  variant="secondary"
                  onClick={() => copyToClipboard(browserInfo?.extensionDir || '', 'Extension path')}
                  title="Copy path"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => api.browser.openExtensionDir()}
                  title="Open folder in File Explorer"
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Open
                </Button>
              </div>
            </div>

            {/* Auth Token */}
            <div>
              <Label>Extension Authorization Token</Label>
              <p className="text-xs text-t3 mb-2">
                Required for loopback bridge communication. Paste this token into the browser extension popup settings:
              </p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  type="password"
                  value={s.browserAuthToken || ''}
                  className="font-mono text-xs select-all"
                />
                <Button
                  variant="secondary"
                  onClick={() => copyToClipboard(s.browserAuthToken || '', 'Auth token')}
                  title="Copy token"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleRegenerateToken}
                  title="Generate new token"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> New Token
                </Button>
              </div>
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3 pt-1">
            <Toggle
              checked={!!s.clipboardDetection}
              onChange={(v) => set('clipboardDetection', v)}
              label="Clipboard URL Detection (Consent-Driven)"
              description="Detects supported media links when copied to your clipboard. Prompts for confirmation before enqueuing; never downloads automatically or logs arbitrary clipboard text."
            />

            <Toggle
              checked={!!s.downloadInterception}
              onChange={(v) => set('downloadInterception', v)}
              label="Browser Download Interception"
              description="Allows the browser extension to offer downloads initiated in Chrome or Edge directly to MantiCollect."
            />
          </div>

          {/* Native Messaging Host Info */}
          <div className="rounded-xl border border-line bg-surface-2/40 p-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-t1">Native Messaging Host</p>
              <p className="text-xs text-t3 mt-0.5">
                For zero-port Chromium stdio integration, register the host via <code className="px-1 py-0.5 rounded bg-surface-3 text-t2 font-mono text-[11px]">register-host-windows.bat</code>.
              </p>
            </div>
            <Button variant="secondary" onClick={() => api.browser.openHostDir()}>
              <FolderOpen className="w-3.5 h-3.5" /> Host Scripts
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Binaries" subtitle="MediaVault drives FFmpeg and yt-dlp as local child processes" icon={Cpu} />
        <div className="space-y-3 p-5">
          <BinStatus label="FFmpeg" info={bins?.ffmpeg} hint="Bundled via ffmpeg-static. Used for merging video+audio and conversions." />
          <BinStatus label="FFprobe" info={bins?.ffprobe} hint="Bundled via ffprobe-static. Used for media inspection." />
          <div className="flex items-center justify-between rounded-xl border border-line bg-bg-elev/40 p-3.5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-t1">
                yt-dlp {bins?.ytdlp?.version ? `— ${bins.ytdlp.version}` : '— not installed'}
                {bins?.ytdlp?.available && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ok align-middle" />}
              </p>
              <p className="mt-0.5 text-xs text-t3">Official standalone executable from the yt-dlp GitHub releases (MIT). Installed into vendor/yt-dlp.</p>
            </div>
            <Button onClick={installYtDlp} disabled={!!installing}>
              <Download style={{ width: 15, height: 15 }} />
              {installing ? installing.phase : 'Install / update'}
            </Button>
          </div>
          {installing && (installing.pct || installing.message) && (
            <p className="text-xs tabular-nums text-t3">
              {installing.message || ''} {installing.pct ? `${Math.round(installing.pct)}%` : ''}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Authorization"
          subtitle="Explicit, user-provided credentials only. MediaVault never reads your browser automatically."
        />
        <div className="space-y-4 p-5">
          <div>
            <Label>cookies.txt (Netscape format) — optional</Label>
            <Input
              value={s.cookiesFile}
              onChange={(e) => set('cookiesFile', e.target.value)}
              placeholder="C:\Users\you\cookies.txt (leave empty to never send cookies)"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-t3">
              Only used for sources that require it (e.g. profile collections on Instagram/X). Export the file yourself from a browser cookies
              extension while logged into your own account. The path is stored locally; cookie contents are never logged.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-warn/25 bg-warn/5 p-3.5">
            <ShieldAlert className="mt-0.5 shrink-0 text-warn" style={{ width: 16, height: 16 }} />
            <p className="text-xs leading-relaxed text-warn/90">
              Use cookies.txt only for accounts and content you are authorized to access. Bypassing paywalls, DRM, or private-account permissions is
              not supported and may violate platform terms and law.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Network safety" />
        <div className="space-y-4 p-5">
          <Toggle
            checked={!!s.allowLocalNetwork}
            onChange={(v) => set('allowLocalNetwork', v)}
            label="Allow local-network URLs (developer option)"
            description="By default MediaVault blocks localhost, LAN IPs, and hosts resolving to private addresses (SSRF protection). Enable only for local test servers."
          />
          <div className="flex items-start gap-3 rounded-xl border border-line bg-bg-elev/40 p-3.5">
            <ShieldCheck className="mt-0.5 shrink-0 text-ok" style={{ width: 16, height: 16 }} />
            <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-t3">
              <li>Only http/https schemes are fetched; redirects are re-validated hop by hop.</li>
              <li>TLS certificate verification is never disabled.</li>
              <li>User URLs are passed to child processes as argv arrays — never shell-interpolated.</li>
              <li>Downloads stream to temp files inside the download folder and are verified before move.</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

function BinStatus({ label, info, hint }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-bg-elev/40 p-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-t1">
          {label}{' '}
          {info?.available ? (
            <span className="text-xs text-ok">— {info.version}</span>
          ) : (
            <span className="text-xs text-err">— not found</span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-t3" title={info?.path || ''}>
          {info?.path || hint}
        </p>
      </div>
    </div>
  );
}

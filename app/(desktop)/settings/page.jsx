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
  ClipboardCheck,
  Server,
  HardDrive,
  Key,
  Trash2,
  Edit2,
  Plus,
  Gauge,
  Lock,
  Cloud,
  CheckCircle2,
  XCircle,
  AppWindow,
  Bell,
  BellRing,
  Info,
  RotateCw
} from 'lucide-react';
import { api, onEvent } from '@/lib/ipc.js';
import { Button, Card, CardHeader, Input, Label, Select, Toggle, Spinner, Badge, AnimatedDialog } from '@/components/ui.jsx';
import { useTheme } from '@/lib/theme.jsx';

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [bins, setBins] = useState(null);
  const [browserInfo, setBrowserInfo] = useState(null);
  const [installing, setInstalling] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testingBridge, setTestingBridge] = useState(false);
  const { theme, setTheme } = useTheme();

  // Phase 8 & 9: Storage Connections & Credentials
  const [connections, setConnections] = useState([]);
  const [credStatus, setCredStatus] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [testingConnId, setTestingConnId] = useState(null);
  const [testingForm, setTestingForm] = useState(false);
  const [connForm, setConnForm] = useState({
    id: null,
    name: '',
    provider_type: 's3',
    host: '',
    port: '',
    base_path: '',
    username: '',
    credential: '',
    removeCredential: false,
    allow_insecure_http: false,
    host_key_fingerprint: '',
    region: 'us-east-1',
    force_path_style: false
  });

  // Phase 10: Desktop Behavior, Notifications & Updater
  const [updaterStatus, setUpdaterStatus] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);

  useEffect(() => {
    api.settings.get().then(setS).catch(() => {});
    api.bins.status().then(setBins).catch(() => {});
    api.browser.status().then(setBrowserInfo).catch(() => {});
    api.credentials.status().then(setCredStatus).catch(() => {});
    api.updater.status().then(setUpdaterStatus).catch(() => {});
    loadConnections();
    const unsubUpdater = onEvent('updater:status', (status) => {
      setUpdaterStatus(status);
    });
    const unsubInstall = onEvent('ytdlp:install', (p) => {
      if (p.phase === 'downloading' && p.total) setInstalling({ phase: p.phase, pct: (p.received / p.total) * 100, message: p.message });
      else setInstalling(p);
    });
    return () => {
      unsubUpdater?.();
      unsubInstall?.();
    };
  }, []);

  async function loadConnections() {
    try {
      const list = await api.storage.connections.list();
      setConnections(list || []);
    } catch {}
  }

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

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    try {
      const res = await api.updater.check(true);
      setUpdaterStatus(res);
      if (res?.state === 'up-to-date') {
        toast.success('MantiCollect is up to date.');
      } else if (res?.state === 'unsupported_dev') {
        toast.info('Development build: auto-updates are disabled in unpacked mode.');
      } else if (res?.state === 'available') {
        toast.info(`Update ${res?.availableVersion} is available.`);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to check for updates');
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    try {
      await api.updater.install();
    } catch (err) {
      toast.error(`Install error: ${err.message}`);
    }
  }

  async function handleTestNotification() {
    setTestingNotif(true);
    try {
      const res = await api.notifications.test({
        title: 'MantiCollect Notifications',
        body: 'Native desktop notifications are functioning correctly.'
      });
      if (res?.shown) {
        toast.success('Test desktop notification sent');
      } else {
        toast.info('Notifications are disabled in settings or unavailable on this system.');
      }
    } catch (err) {
      toast.error(`Notification test failed: ${err.message}`);
    } finally {
      setTestingNotif(false);
    }
  }

  // --- Storage Connection Actions ---

  function openAddConn() {
    setConnForm({
      id: null,
      name: '',
      provider_type: 's3',
      host: '',
      port: '',
      base_path: '',
      username: '',
      credential: '',
      removeCredential: false,
      allow_insecure_http: false,
      host_key_fingerprint: '',
      region: 'us-east-1',
      force_path_style: false
    });
    setEditOpen(true);
  }

  function openEditConn(conn) {
    setConnForm({
      id: conn.id,
      name: conn.name || '',
      provider_type: conn.provider_type || 's3',
      host: conn.host || '',
      port: conn.port ? String(conn.port) : '',
      base_path: conn.base_path || '',
      username: conn.username || '',
      credential: '',
      removeCredential: false,
      allow_insecure_http: Boolean(conn.allow_insecure_http),
      host_key_fingerprint: conn.host_key_fingerprint || '',
      region: conn.region || 'us-east-1',
      force_path_style: Boolean(conn.force_path_style),
      hasCredentials: conn.hasCredentials
    });
    setEditOpen(true);
  }

  async function handleTestConn(conn) {
    setTestingConnId(conn.id);
    try {
      const res = await api.storage.connections.test({ id: conn.id });
      if (res.ok) {
        toast.success(`Connection verified successfully! ${res.message || ''}`);
        loadConnections();
      } else {
        toast.error(`Connection test failed: ${res.message || 'Unknown error'}`);
      }
    } catch (err) {
      toast.error(`Test error: ${err.message}`);
    } finally {
      setTestingConnId(null);
    }
  }

  async function handleTestForm() {
    setTestingForm(true);
    try {
      const payload = {
        providerType: connForm.provider_type,
        host: connForm.host,
        port: connForm.port ? Number(connForm.port) : undefined,
        basePath: connForm.base_path,
        username: connForm.username,
        credential: connForm.credential,
        allowInsecureHttp: connForm.allow_insecure_http,
        hostKeyFingerprint: connForm.host_key_fingerprint,
        region: connForm.region,
        forcePathStyle: connForm.force_path_style
      };
      if (connForm.id && !connForm.credential) {
        payload.id = connForm.id;
      }
      const res = await api.storage.connections.test(payload);
      if (res.ok) {
        toast.success(`Connection verified! ${res.message || ''}`);
        if (res.hostKeyFingerprint && !connForm.host_key_fingerprint) {
          setConnForm((prev) => ({ ...prev, host_key_fingerprint: res.hostKeyFingerprint }));
          toast.info(`Captured server host key fingerprint`);
        }
      } else {
        toast.error(`Connection test failed: ${res.message || 'Unknown error'}`);
      }
    } catch (err) {
      toast.error(`Test error: ${err.message}`);
    } finally {
      setTestingForm(false);
    }
  }

  async function handleSaveConn() {
    if (!connForm.name.trim()) return toast.error('Connection name is required');
    if (connForm.provider_type === 'local_nas' && !connForm.base_path.trim()) {
      return toast.error('Base folder path is required');
    }
    if ((connForm.provider_type === 'webdav' || connForm.provider_type === 'sftp') && !connForm.host.trim()) {
      return toast.error('Host / Server URL is required');
    }
    if (connForm.provider_type === 's3' && !connForm.base_path.trim()) {
      return toast.error('Bucket name is required for S3-compatible storage');
    }

    try {
      await api.storage.connections.save({
        id: connForm.id,
        name: connForm.name,
        providerType: connForm.provider_type,
        host: connForm.host,
        port: connForm.port ? Number(connForm.port) : undefined,
        basePath: connForm.base_path,
        username: connForm.username,
        credential: connForm.credential,
        removeCredential: connForm.removeCredential,
        allowInsecureHttp: connForm.allow_insecure_http,
        hostKeyFingerprint: connForm.host_key_fingerprint,
        region: connForm.region,
        forcePathStyle: connForm.force_path_style
      });
      toast.success(connForm.id ? 'Connection updated' : 'Connection added');
      setEditOpen(false);
      loadConnections();
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
    }
  }

  async function handleDeleteConn(id, name) {
    if (!confirm(`Delete storage connection "${name}"? Interrupted uploads for this destination will be cleared.`)) return;
    try {
      await api.storage.connections.delete(id);
      toast.success('Connection deleted');
      loadConnections();
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
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
        <CardHeader title="Binaries" subtitle="MantiCollect drives FFmpeg and yt-dlp as local child processes" icon={Cpu} />
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

      {/* Phase 8: Remote Storage & Cloud Export */}
      <Card>
        <CardHeader
          title="Remote Storage & Cloud Export"
          subtitle="Secure WebDAV, SFTP, and Local NAS endpoints for offloading media library files"
          icon={Cloud}
          actions={
            <Button size="sm" onClick={openAddConn}>
              <Plus className="w-3.5 h-3.5" /> Add Connection
            </Button>
          }
        />
        <div className="space-y-4 p-5">
          {/* Hardware/OS Credential Encryption Status Notice */}
          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/40 p-3.5">
            {credStatus?.available ? (
              <>
                <ShieldCheck className="mt-0.5 shrink-0 text-ok" style={{ width: 16, height: 16 }} />
                <div className="text-xs leading-relaxed text-t2">
                  <span className="font-semibold text-t1">Hardware-backed / OS Encryption Active: </span>
                  Credentials are protected using {credStatus?.platform === 'win32' ? 'Windows DPAPI' : credStatus?.platform === 'darwin' ? 'macOS Keychain' : 'Linux Secret Service'}.
                  Passwords, private keys, and passphrases are never saved in plaintext and never exposed to the UI renderer.
                </div>
              </>
            ) : (
              <>
                <ShieldAlert className="mt-0.5 shrink-0 text-warn" style={{ width: 16, height: 16 }} />
                <div className="text-xs leading-relaxed text-warn/90">
                  <span className="font-semibold">OS Credential Protection Unavailable: </span>
                  Safe credential storage is not available in this operating system session. Passwords cannot be saved securely.
                </div>
              </>
            )}
          </div>

          {/* Connection List */}
          {connections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-8 text-center">
              <Server className="mx-auto h-8 w-8 text-t3 mb-2" />
              <p className="text-sm font-medium text-t1">No remote connections configured</p>
              <p className="text-xs text-t3 mt-1 max-w-sm mx-auto">
                Connect your Nextcloud, Synology, TrueNAS, VPS SFTP, or local network share to transfer downloaded media files seamlessly.
              </p>
              <Button size="sm" variant="secondary" className="mt-4" onClick={openAddConn}>
                <Plus className="w-3.5 h-3.5" /> Configure First Connection
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {connections.map((conn) => {
                const isNas = conn.provider_type === 'local_nas';
                const isWebdav = conn.provider_type === 'webdav';
                const isSftp = conn.provider_type === 'sftp';
                const isS3 = conn.provider_type === 's3';
                const isTesting = testingConnId === conn.id;

                return (
                  <div
                    key={conn.id}
                    className="flex flex-col justify-between rounded-xl border border-line bg-surface-2/30 p-4 transition-colors hover:border-line-strong"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {isNas && <HardDrive className="h-4 w-4 shrink-0 text-accent" />}
                          {isWebdav && <Cloud className="h-4 w-4 shrink-0 text-info" />}
                          {isSftp && <Server className="h-4 w-4 shrink-0 text-ok" />}
                          {isS3 && <Cloud className="h-4 w-4 shrink-0 text-purple-400" />}
                          <h3 className="text-sm font-semibold text-t1 truncate">{conn.name}</h3>
                        </div>
                        <Badge variant="outline" className="text-[10px] uppercase font-mono px-2 py-0.5 shrink-0">
                          {conn.provider_type === 's3' ? 'S3 CLOUD' : conn.provider_type?.replace('_', ' ')}
                        </Badge>
                      </div>

                      <p className="mt-2 text-xs font-mono text-t2 truncate" title={isNas ? conn.base_path : isS3 ? `s3://${conn.base_path}${conn.region ? ` (${conn.region})` : ''}` : `${conn.host}${conn.port ? `:${conn.port}` : ''}`}>
                        {isNas ? conn.base_path : isS3 ? `s3://${conn.base_path}${conn.host ? ` • ${conn.host}` : ''}` : `${conn.username ? `${conn.username}@` : ''}${conn.host}${conn.port ? `:${conn.port}` : ''}`}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-t3">
                        <span className="flex items-center gap-1">
                          <Key className="h-3 w-3" />
                          {conn.hasCredentials ? (
                            <span className="text-ok">Encrypted key saved</span>
                          ) : (
                            <span>No secret</span>
                          )}
                        </span>
                        <span>•</span>
                        <span>
                          {conn.last_success_at
                            ? `Connected ${new Date(conn.last_success_at).toLocaleDateString()}`
                            : 'Untested'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-end gap-1.5 border-t border-line/60 pt-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleTestConn(conn)}
                        disabled={isTesting}
                        title="Test connectivity"
                      >
                        {isTesting ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        <span className="ml-1 text-xs">Test</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditConn(conn)}
                        title="Edit connection"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span className="ml-1 text-xs">Edit</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleDeleteConn(conn.id, conn.name)}
                        title="Delete connection"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Phase 8 & 9: Bandwidth Throttling Management */}
      <Card>
        <CardHeader
          title="Bandwidth Management"
          subtitle="Configure upload speed limits for remote exports and automated backups"
          icon={Gauge}
        />
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Global Upload Limit (KB/s)</Label>
              <Input
                type="number"
                min="0"
                step="50"
                value={s.globalUploadLimitKBps ?? 0}
                onChange={(e) => set('globalUploadLimitKBps', Math.max(0, parseInt(e.target.value, 10) || 0))}
                placeholder="0 = Unlimited"
              />
              <p className="mt-1 text-[11px] text-t3">
                Caps the total upload bandwidth across all simultaneous uploads. Set to 0 for unlimited.
              </p>
            </div>

            <div>
              <Label>Per-Task Upload Limit (KB/s)</Label>
              <Input
                type="number"
                min="0"
                step="50"
                value={s.perTaskUploadLimitKBps ?? 0}
                onChange={(e) => set('perTaskUploadLimitKBps', Math.max(0, parseInt(e.target.value, 10) || 0))}
                placeholder="0 = Unlimited"
              />
              <p className="mt-1 text-[11px] text-t3">
                Maximum speed permitted for each individual file transfer. Set to 0 for unlimited.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface-2/40 p-3 text-xs text-t2 leading-relaxed">
            <span className="font-semibold text-t1">Effective Limit Rule: </span>
            The transfer rate limiter enforces <code className="px-1 py-0.5 rounded bg-surface-3 font-mono text-[11px]">min(globalLimit, perTaskLimit)</code>.
            Throttling is coordinated through a shared aggregate token bucket with per-task stream rate-limiters.
          </div>
        </div>
      </Card>

      {/* Add / Edit Connection Dialog */}
      <AnimatedDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={connForm.id ? 'Edit Storage Connection' : 'Add Storage Connection'}
        width={540}
        footer={
          <div className="flex w-full items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTestForm}
              disabled={testingForm}
            >
              {testingForm ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span className="ml-1.5">{testingForm ? 'Testing…' : 'Test Connection'}</span>
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveConn}>
                Save Connection
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <Label>Connection Name</Label>
            <Input
              value={connForm.name}
              onChange={(e) => setConnForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. AWS S3 Media Vault / TrueNAS / Cloudflare R2"
            />
          </div>

          <div>
            <Label>Provider Type</Label>
            <Select
              value={connForm.provider_type}
              onChange={(e) => {
                const val = e.target.value;
                setConnForm((prev) => ({
                  ...prev,
                  provider_type: val,
                  region: prev.region || (val === 's3' ? 'us-east-1' : '')
                }));
              }}
              disabled={!!connForm.id}
            >
              <option value="s3">S3-Compatible Storage (AWS S3 / Cloudflare R2 / MinIO)</option>
              <option value="webdav">WebDAV (HTTPS Nextcloud / ownCloud / Apache)</option>
              <option value="sftp">SFTP (SSH File Transfer Protocol)</option>
              <option value="local_nas">Local NAS / Network Shared Drive</option>
            </Select>
          </div>

          {connForm.provider_type === 's3' && (
            <>
              {!connForm.id && (
                <div>
                  <Label>Quick Provider Preset</Label>
                  <div className="grid grid-cols-4 gap-2 mt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => setConnForm(prev => ({
                        ...prev,
                        host: '',
                        region: 'us-east-1',
                        force_path_style: false,
                        allow_insecure_http: false
                      }))}
                    >
                      AWS S3
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => setConnForm(prev => ({
                        ...prev,
                        host: 'https://<account-id>.r2.cloudflarestorage.com',
                        region: 'auto',
                        force_path_style: false,
                        allow_insecure_http: false
                      }))}
                    >
                      Cloudflare R2
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => setConnForm(prev => ({
                        ...prev,
                        host: 'http://127.0.0.1:9000',
                        region: 'us-east-1',
                        force_path_style: true,
                        allow_insecure_http: true
                      }))}
                    >
                      MinIO
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => setConnForm(prev => ({
                        ...prev,
                        force_path_style: false
                      }))}
                    >
                      Custom
                    </Button>
                  </div>
                </div>
              )}

              <div>
                <Label>S3 Endpoint URL</Label>
                <Input
                  value={connForm.host}
                  onChange={(e) => setConnForm((prev) => ({ ...prev, host: e.target.value }))}
                  placeholder="https://s3.amazonaws.com (leave empty for AWS default)"
                />
                <p className="mt-1 text-[11px] text-t3">
                  Leave empty for official AWS S3. For R2, MinIO, or custom endpoints, specify full HTTPS URL.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Region</Label>
                  <Input
                    value={connForm.region}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, region: e.target.value }))}
                    placeholder="us-east-1 or auto"
                  />
                </div>
                <div>
                  <Label>Bucket Name</Label>
                  <Input
                    value={connForm.base_path}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, base_path: e.target.value }))}
                    placeholder="my-backup-vault"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Access Key ID</Label>
                  <Input
                    value={connForm.username}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, username: e.target.value }))}
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                  />
                </div>
                <div>
                  <Label>Secret Access Key</Label>
                  <Input
                    type="password"
                    value={connForm.credential}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, credential: e.target.value, removeCredential: false }))}
                    placeholder={connForm.hasCredentials ? 'Saved — leave blank to keep' : 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'}
                  />
                </div>
              </div>

              {connForm.hasCredentials && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="removeCredS3"
                    checked={connForm.removeCredential}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, removeCredential: e.target.checked }))}
                    className="rounded border-line text-err focus:ring-err/30"
                  />
                  <label htmlFor="removeCredS3" className="text-xs text-err font-medium cursor-pointer">
                    Remove saved secret access key
                  </label>
                </div>
              )}

              <div className="space-y-2 pt-1">
                <Toggle
                  checked={connForm.force_path_style}
                  onChange={(v) => setConnForm((prev) => ({ ...prev, force_path_style: v }))}
                  label="Force Path-Style Addressing"
                  description="Use path-style URLs (endpoint/bucket/key). Required for MinIO, Ceph, and endpoints without DNS wildcard subdomains."
                />

                <Toggle
                  checked={connForm.allow_insecure_http}
                  onChange={(v) => setConnForm((prev) => ({ ...prev, allow_insecure_http: v }))}
                  label="Allow Insecure HTTP"
                  description="Permits unencrypted http:// (e.g. local MinIO on 127.0.0.1:9000). Never transmit credentials unencrypted over public networks."
                />
              </div>
            </>
          )}

          {connForm.provider_type === 'local_nas' && (
            <div>
              <Label>Base Folder Path</Label>
              <div className="flex gap-2">
                <Input
                  value={connForm.base_path}
                  onChange={(e) => setConnForm((prev) => ({ ...prev, base_path: e.target.value }))}
                  placeholder="e.g. \\NAS\Media or Z:\Backups"
                />
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const r = await api.selectDirectory();
                    if (r?.path) setConnForm((prev) => ({ ...prev, base_path: r.path }));
                  }}
                >
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {connForm.provider_type === 'webdav' && (
            <>
              <div>
                <Label>Server URL</Label>
                <Input
                  value={connForm.host}
                  onChange={(e) => setConnForm((prev) => ({ ...prev, host: e.target.value }))}
                  placeholder="https://cloud.example.com/remote.php/dav/files/user/"
                />
                <p className="mt-1 text-[11px] text-t3">
                  Do not embed credentials in the URL. Passwords must be entered in the secure field below.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Username (Optional)</Label>
                  <Input
                    value={connForm.username}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, username: e.target.value }))}
                    placeholder="user"
                  />
                </div>
                <div>
                  <Label>Password / App Token</Label>
                  <Input
                    type="password"
                    value={connForm.credential}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, credential: e.target.value, removeCredential: false }))}
                    placeholder={connForm.hasCredentials ? 'Saved — leave blank to keep' : 'Enter password or token'}
                  />
                </div>
              </div>

              {connForm.hasCredentials && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="removeCredWebdav"
                    checked={connForm.removeCredential}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, removeCredential: e.target.checked }))}
                    className="rounded border-line text-err focus:ring-err/30"
                  />
                  <label htmlFor="removeCredWebdav" className="text-xs text-err font-medium cursor-pointer">
                    Remove saved credential
                  </label>
                </div>
              )}

              <div className="pt-1">
                <Toggle
                  checked={connForm.allow_insecure_http}
                  onChange={(v) => setConnForm((prev) => ({ ...prev, allow_insecure_http: v }))}
                  label="Allow Insecure HTTP"
                  description="Permits unencrypted http:// WebDAV. Strongly discouraged unless testing on a private LAN."
                />
              </div>
            </>
          )}

          {connForm.provider_type === 'sftp' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label>SFTP Host</Label>
                  <Input
                    value={connForm.host}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, host: e.target.value }))}
                    placeholder="sftp.example.com or 192.168.1.50"
                  />
                </div>
                <div>
                  <Label>Port</Label>
                  <Input
                    type="number"
                    value={connForm.port || '22'}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, port: e.target.value }))}
                    placeholder="22"
                  />
                </div>
              </div>

              <div>
                <Label>Remote Base Directory</Label>
                <Input
                  value={connForm.base_path}
                  onChange={(e) => setConnForm((prev) => ({ ...prev, base_path: e.target.value }))}
                  placeholder="/home/user/uploads or /mnt/storage"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Username</Label>
                  <Input
                    value={connForm.username}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, username: e.target.value }))}
                    placeholder="sftpuser"
                  />
                </div>
                <div>
                  <Label>Password / Key Passphrase</Label>
                  <Input
                    type="password"
                    value={connForm.credential}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, credential: e.target.value, removeCredential: false }))}
                    placeholder={connForm.hasCredentials ? 'Saved — leave blank to keep' : 'Enter password'}
                  />
                </div>
              </div>

              {connForm.hasCredentials && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="removeCredSftp"
                    checked={connForm.removeCredential}
                    onChange={(e) => setConnForm((prev) => ({ ...prev, removeCredential: e.target.checked }))}
                    className="rounded border-line text-err focus:ring-err/30"
                  />
                  <label htmlFor="removeCredSftp" className="text-xs text-err font-medium cursor-pointer">
                    Remove saved credential
                  </label>
                </div>
              )}

              <div>
                <Label>Trusted Host Key Fingerprint (Optional / Pinning)</Label>
                <Input
                  value={connForm.host_key_fingerprint}
                  onChange={(e) => setConnForm((prev) => ({ ...prev, host_key_fingerprint: e.target.value }))}
                  placeholder="SHA256:... (leave empty to capture on first connection test)"
                />
                <p className="mt-1 text-[11px] text-t3">
                  Clicking "Test Connection" will capture and verify the server's SSH host key fingerprint to prevent MITM attacks.
                </p>
              </div>
            </>
          )}
        </div>
      </AnimatedDialog>

      <Card>
        <CardHeader
          title="Authorization"
          subtitle="Explicit, user-provided credentials only. MantiCollect never reads your browser automatically."
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

      <Card id="desktop-behavior-section">
        <CardHeader
          title="Desktop Behavior"
          subtitle="System tray integration, background scheduling, and window controls"
          icon={AppWindow}
        />
        <div className="space-y-4 p-5">
          <Toggle
            checked={s.closeToTray !== false}
            onChange={(v) => set('closeToTray', v)}
            label="Close button hides to system tray"
            description="When enabled, clicking the window close button keeps MantiCollect running in the background tray so active downloads and scheduled backups continue uninterrupted."
          />
          <Toggle
            checked={!!s.minimizeToTray}
            onChange={(v) => set('minimizeToTray', v)}
            label="Minimize button hides to system tray"
            description="When enabled, minimizing the window removes it from the taskbar and keeps it accessible from the system tray."
          />
          <Toggle
            checked={!!s.startMinimized}
            onChange={(v) => set('startMinimized', v)}
            label="Start application minimized in system tray"
            description="Launches MantiCollect in the background without displaying the main window on startup."
          />
          <Toggle
            checked={s.notifyOnCloseToTray !== false}
            onChange={(v) => set('notifyOnCloseToTray', v)}
            label="Notify when hidden to tray"
            description="Displays a one-time desktop alert confirming the app is continuing to run in the background when first closed to tray."
          />

          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/40 p-3.5">
            <Info className="mt-0.5 shrink-0 text-accent-text" style={{ width: 16, height: 16 }} />
            <div className="space-y-1 text-xs leading-relaxed text-t3">
              <p className="font-medium text-t2">Background Scheduling & In-Process Lifecycle</p>
              <p>
                In-process background tasks and automated backup schedules execute as long as the MantiCollect process remains alive.
                Explicitly choosing <strong>Quit MantiCollect</strong> from the system tray menu gracefully halts active work.
                If the application or system is terminated, any missed schedules will be reconciled on next launch.
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Desktop Notifications"
          subtitle="Native operating system alerts for transfer completions, backup statuses, and updates"
          icon={Bell}
        />
        <div className="space-y-4 p-5">
          <div className="flex items-center justify-between pb-3 border-b border-line/40">
            <div>
              <p className="text-[13px] font-semibold text-t1">Enable Desktop Notifications</p>
              <p className="text-xs text-t3">Master toggle for all native OS desktop notifications.</p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTestNotification}
                disabled={testingNotif || s.notificationsEnabled === false}
              >
                <BellRing style={{ width: 14, height: 14 }} /> {testingNotif ? 'Sending…' : 'Send Test Notification'}
              </Button>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={s.notificationsEnabled !== false}
                  onChange={(e) => set('notificationsEnabled', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-3 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
              </label>
            </div>
          </div>

          <div className={`space-y-3 transition-opacity ${s.notificationsEnabled === false ? 'opacity-50 pointer-events-none' : ''}`}>
            <Toggle
              checked={s.notifyDownloadComplete !== false}
              onChange={(v) => set('notifyDownloadComplete', v)}
              label="Download completed"
              description="Notify when a download completes successfully."
            />
            <Toggle
              checked={s.notifyDownloadFailed !== false}
              onChange={(v) => set('notifyDownloadFailed', v)}
              label="Download failed"
              description="Notify when a download encounters a network, disk, or extraction error."
            />
            <Toggle
              checked={s.notifyBackupComplete !== false}
              onChange={(v) => set('notifyBackupComplete', v)}
              label="Cloud backup completed"
              description="Notify when a scheduled or manual cloud backup run finishes transferring."
            />
            <Toggle
              checked={s.notifyBackupFailed !== false}
              onChange={(v) => set('notifyBackupFailed', v)}
              label="Cloud backup failed or partial"
              description="Notify when a cloud backup fails to connect or fails to upload items."
            />
            <Toggle
              checked={!!s.notifyBackupStarted}
              onChange={(v) => set('notifyBackupStarted', v)}
              label="Scheduled backup started"
              description="Notify when an automated background backup schedule begins running."
            />
            <Toggle
              checked={s.notifyUpdates !== false}
              onChange={(v) => set('notifyUpdates', v)}
              label="Application update available"
              description="Notify when a verified new release is available to install."
            />
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/40 p-3.5">
            <ShieldCheck className="mt-0.5 shrink-0 text-ok" style={{ width: 16, height: 16 }} />
            <p className="text-xs leading-relaxed text-t3">
              Notification privacy: Notification payloads are sanitized before reaching the OS. Authentication tokens, private keys, signed query parameters, and sensitive credentials are never displayed or logged in notification alerts.
            </p>
          </div>
        </div>
      </Card>

      <Card id="application-updates-section">
        <CardHeader
          title="Application Updates"
          subtitle="Signed release channels and secure integrity verification"
          icon={RefreshCw}
        />
        <div className="space-y-4 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-line bg-surface-2/40 p-4">
            <div>
              <div className="flex items-center gap-2.5">
                <p className="text-[14px] font-semibold text-t1">MantiCollect v{updaterStatus?.currentVersion || '0.1.0'}</p>
                {updaterStatus?.state === 'unsupported_dev' && (
                  <Badge variant="secondary">Development Build</Badge>
                )}
                {updaterStatus?.state === 'idle' && (
                  <Badge variant="outline">Idle</Badge>
                )}
                {updaterStatus?.state === 'checking' && (
                  <Badge variant="secondary">Checking…</Badge>
                )}
                {updaterStatus?.state === 'available' && (
                  <Badge variant="default">v{updaterStatus.availableVersion} Available</Badge>
                )}
                {updaterStatus?.state === 'downloading' && (
                  <Badge variant="secondary">Downloading…</Badge>
                )}
                {updaterStatus?.state === 'ready' && (
                  <Badge variant="default">Ready to Install</Badge>
                )}
                {updaterStatus?.state === 'up-to-date' && (
                  <Badge variant="outline">Up to Date</Badge>
                )}
                {updaterStatus?.state === 'error' && (
                  <Badge variant="destructive">Check Failed</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-t3">
                {updaterStatus?.message || 'Production releases use cryptographically signed installers and HTTPS feeds.'}
              </p>
              {updaterStatus?.lastCheckedAt && (
                <p className="mt-0.5 text-[11px] text-t3">
                  Last checked: {new Date(updaterStatus.lastCheckedAt).toLocaleTimeString()}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {updaterStatus?.state === 'ready' ? (
                <Button variant="primary" onClick={handleInstallUpdate}>
                  <RotateCw style={{ width: 14, height: 14 }} /> Restart & Install
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate || updaterStatus?.state === 'checking'}
                >
                  <RefreshCw
                    style={{ width: 14, height: 14 }}
                    className={checkingUpdate || updaterStatus?.state === 'checking' ? 'animate-spin' : ''}
                  />
                  {checkingUpdate || updaterStatus?.state === 'checking' ? 'Checking…' : 'Check for updates'}
                </Button>
              )}
            </div>
          </div>

          <Toggle
            checked={s.autoCheckUpdates !== false}
            onChange={(v) => set('autoCheckUpdates', v)}
            label="Automatically check for updates on startup"
            description="Silently query the release endpoint when MantiCollect starts. You will be notified before any update is applied."
          />

          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/40 p-3.5">
            <Lock className="mt-0.5 shrink-0 text-accent-text" style={{ width: 16, height: 16 }} />
            <div className="space-y-1 text-xs leading-relaxed text-t3">
              <p className="font-medium text-t2">Release Engineering & Integrity Verification</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Production auto-updates enforce Authenticode code-signing verification on Windows.</li>
                <li>Download payloads verify SHA-512 hashes before any installer execution.</li>
                <li>Arbitrary update URLs and untrusted binaries are strictly prohibited by Electron main process security policies.</li>
              </ul>
            </div>
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
            description="By default MantiCollect blocks localhost, LAN IPs, and hosts resolving to private addresses (SSRF protection). Enable only for local test servers."
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

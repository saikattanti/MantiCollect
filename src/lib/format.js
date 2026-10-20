export function formatBytes(n) {
  if (n == null || Number.isNaN(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(Math.abs(n)) / 3));
  const v = n / 10 ** (3 * i);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatSpeed(bps) {
  if (!bps || bps <= 0) return '';
  return `${formatBytes(bps)}/s`;
}

export function formatDuration(sec) {
  if (!sec || sec <= 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/**
 * Format remaining ETA seconds human-readably (e.g. "45s", "2m 15s", "1h 04m").
 * Returns "—" when unavailable; never displays misleading "0s" when speed is unknown.
 */
export function formatEta(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  if (m < 60) return `${m}m ${remSec > 0 ? `${remSec}s` : ''}`.trim();
  const h = Math.floor(m / 60);
  const remMin = m % 60;
  return `${h}h ${remMin > 0 ? `${String(remMin).padStart(2, '0')}m` : ''}`.trim();
}

export function formatPercent(pct) {
  if (pct == null || Number.isNaN(pct)) return '—';
  const clamped = Math.min(100, Math.max(0, pct));
  return `${Math.round(clamped * 10) / 10}%`;
}

export function formatBytesDone(j) {
  if (j.bytesTotal || j.totalBytes) {
    const total = j.bytesTotal || j.totalBytes;
    const done = j.bytesDone ?? j.downloadedBytes ?? 0;
    return `${formatBytes(done)} / ${formatBytes(total)}`;
  }
  const done = j.bytesDone ?? j.downloadedBytes;
  return done ? formatBytes(done) : '';
}

export function formatDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function statusLabel(status) {
  return {
    waiting: 'Waiting',
    fetching_metadata: 'Fetching metadata',
    downloading: 'Downloading',
    processing: 'Processing',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled'
  }[status] || status;
}

'use client';

import React from 'react';
import {
  FolderOpen,
  XCircle,
  RotateCcw,
  Trash2,
  Copy,
  ExternalLink,
  Clock,
  Gauge,
  HardDrive,
  FileText,
  AlertTriangle,
  Pause,
  Play,
  Layers
} from 'lucide-react';
import { toast } from 'sonner';
import { formatBytes, formatSpeed, formatEta, formatPercent, formatDate } from '@/lib/format.js';
import { Button, StatusBadge, ProgressBar } from '@/components/ui.jsx';
import Thumb from '@/components/Thumb.jsx';
import SpeedGraph from '@/components/SpeedGraph.jsx';

/**
 * IDM-Inspired Download Details Panel.
 * Provides deep telemetry for active or finished transfers:
 * - Real byte counts (done, total, remaining)
 * - Smoothed current speed and overall average speed
 * - ETA calculation without fake assumptions
 * - Rolling 60-second SVG speed history graph
 * - File and destination management
 */
export default function DownloadDetails({
  job,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRemove,
  onReveal,
  className = ''
}) {
  if (!job) return null;

  const isActive = ['waiting', 'fetching_metadata', 'downloading', 'processing', 'pausing', 'resuming'].includes(job.status);
  const isTransferring = ['downloading', 'processing', 'resuming'].includes(job.status);
  const isPaused = job.status === 'paused';
  const hasTotal = job.totalBytes != null && job.totalBytes > 0;
  const progressPct = hasTotal ? (job.progressPercent != null ? job.progressPercent : (job.progress || 0) * 100) : null;

  async function copyText(text, label = 'Copied') {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error('Clipboard unavailable');
    }
  }

  return (
    <div className={`mt-3 rounded-xl border border-line-strong bg-surface-2/50 p-4 shadow-sm text-sm ${className}`}>
      {/* File & Source Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start justify-between">
        <div className="flex items-start gap-3.5 min-w-0">
          {job.thumbnail ? (
            <Thumb src={job.thumbnail} alt="" className="h-14 w-14 shrink-0 rounded-lg shadow-xs" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 shadow-xs">
              <FileText className="text-t3" style={{ width: 22, height: 22 }} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusBadge status={job.status} />
              {job.provider && (
                <span className="rounded-full border border-line bg-surface-2/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-t3">
                  {job.provider}
                </span>
              )}
              {job.format && (
                <span className="truncate text-xs text-t3" title={job.format}>
                  {job.format}
                </span>
              )}
              {job.isSegmented && (
                <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] font-semibold tracking-wider text-accent-text flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                  {job.activeConnections ? `${job.activeConnections} Streams` : `${job.segmentsCount || 4} Segments`}
                </span>
              )}
            </div>
            <h3 className="mt-1 text-[14px] font-semibold text-t1 break-all" title={job.filename || job.title}>
              {job.filename || job.title || job.url}
            </h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-t3 break-all" title={job.url}>
              <span className="truncate">{job.url}</span>
              <button
                onClick={() => copyText(job.url, 'URL copied')}
                className="shrink-0 p-0.5 text-t3 hover:text-t1"
                title="Copy source URL"
                aria-label="Copy source URL"
              >
                <Copy style={{ width: 11, height: 11 }} />
              </button>
            </p>
          </div>
        </div>

        {/* Quick Action cluster */}
        <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-start">
          {job.status === 'completed' && job.resultPath && (
            <Button variant="secondary" size="sm" onClick={() => onReveal?.(job.resultPath)}>
              <FolderOpen style={{ width: 14, height: 14 }} /> Open folder
            </Button>
          )}
          {['downloading', 'resuming'].includes(job.status) && (
            <Button variant="secondary" size="sm" onClick={() => onPause?.(job.id)}>
              <Pause style={{ width: 14, height: 14 }} /> Pause
            </Button>
          )}
          {job.status === 'pausing' && (
            <Button variant="secondary" size="sm" disabled>
              <Pause style={{ width: 14, height: 14 }} className="animate-spin" /> Pausing…
            </Button>
          )}
          {(job.status === 'paused' || (job.status === 'failed' && job.resumable)) && (
            <Button variant="primary" size="sm" onClick={() => onResume?.(job.id)}>
              <Play style={{ width: 14, height: 14 }} /> Resume
            </Button>
          )}
          {['waiting', 'fetching_metadata', 'downloading', 'processing', 'pausing', 'paused', 'resuming'].includes(job.status) && (
            <Button variant="danger" size="sm" onClick={() => onCancel?.(job.id)}>
              <XCircle style={{ width: 14, height: 14 }} /> Cancel
            </Button>
          )}
          {['failed', 'cancelled'].includes(job.status) && (
            <Button variant="secondary" size="sm" onClick={() => onRetry?.(job.id)}>
              <RotateCcw style={{ width: 14, height: 14 }} /> Retry
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onRemove?.(job.id)} title="Remove record">
            <Trash2 style={{ width: 14, height: 14 }} />
          </Button>
        </div>
      </div>

      {/* Progress Bar (when active or paused) */}
      {(isTransferring || isPaused) && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-t1 tabular-nums">
              {hasTotal ? formatPercent(progressPct) : (isPaused ? 'Paused (streamed)' : 'Streaming chunks…')}
            </span>
            <span className="text-t3 tabular-nums">
              {formatBytes(job.downloadedBytes)}
              {hasTotal ? ` / ${formatBytes(job.totalBytes)}` : ' downloaded'}
            </span>
          </div>
          <ProgressBar
            value={hasTotal ? (progressPct / 100) : 1}
            indeterminate={!hasTotal || job.status === 'processing'}
            active={job.status === 'downloading'}
          />
        </div>
      )}

      {/* Telemetry Metrics Grid */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-line/60 pt-3.5">
        <div className="rounded-lg border border-line/40 bg-surface-2/20 p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-t3">Downloaded</p>
          <p className="mt-1 text-xs font-semibold text-t1 tabular-nums">
            {formatBytes(job.downloadedBytes)}
          </p>
          <p className="text-[10px] text-t3 mt-0.5">
            {hasTotal ? `of ${formatBytes(job.totalBytes)}` : 'stream length unknown'}
          </p>
        </div>

        <div className="rounded-lg border border-line/40 bg-surface-2/20 p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-t3">Remaining</p>
          <p className="mt-1 text-xs font-semibold text-t1 tabular-nums">
            {job.remainingBytes != null ? formatBytes(job.remainingBytes) : (job.status === 'completed' ? '0 B' : '—')}
          </p>
          <p className="text-[10px] text-t3 mt-0.5">
            {hasTotal && job.status !== 'completed' ? `${formatPercent(100 - progressPct)} left` : (job.status === 'completed' ? 'Completed' : 'Unknown')}
          </p>
        </div>

        <div className="rounded-lg border border-line/40 bg-surface-2/20 p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-t3">Transfer Speed</p>
          <p className="mt-1 text-xs font-semibold text-t1 tabular-nums">
            {formatSpeed(job.currentSpeed) || (isTransferring ? 'Negotiating…' : '—')}
          </p>
          <p className="text-[10px] text-t3 mt-0.5">
            {job.avgSpeed ? `avg ${formatSpeed(job.avgSpeed)}` : (isTransferring ? 'Calculating…' : 'Idle')}
          </p>
        </div>

        <div className="rounded-lg border border-line/40 bg-surface-2/20 p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-t3">Time Left (ETA)</p>
          <p className="mt-1 text-xs font-semibold text-t1 tabular-nums">
            {job.status === 'completed' ? 'Finished' : formatEta(job.etaSeconds)}
          </p>
          <p className="text-[10px] text-t3 mt-0.5">
            {job.startedAt ? `Started ${formatDate(job.startedAt)}` : 'Waiting in queue'}
          </p>
        </div>
      </div>

      {/* Live Speed Graph (for active transfers or jobs with history) */}
      {(isTransferring || (job.speedHistory && job.speedHistory.length > 0)) && (
        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-[11px] font-medium text-t2 flex items-center gap-1.5">
              <Gauge style={{ width: 13, height: 13 }} className="text-accent" />
              Real-Time Speed Telemetry (Last 60s)
            </span>
          </div>
          <SpeedGraph
            history={job.speedHistory}
            currentSpeed={job.currentSpeed}
            avgSpeed={job.avgSpeed}
            height={90}
          />
        </div>
      )}

      {/* Multi-Connection Segment Slice Breakdown */}
      {job.isSegmented && job.segmentPlan && Array.isArray(job.segmentPlan) && (
        <div className="mt-3 rounded-lg border border-line/50 bg-surface-2/30 p-3">
          <div className="flex items-center justify-between text-[11px] font-medium text-t2 mb-1.5">
            <span className="flex items-center gap-1.5">
              <Layers style={{ width: 12, height: 12 }} className="text-accent" />
              Segment Slices ({job.segmentsDone || 0} / {job.segmentPlan.length} Complete)
            </span>
            {job.activeConnections > 0 && (
              <span className="text-[10px] text-accent-text font-semibold">
                {job.activeConnections} active stream{job.activeConnections > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {job.segmentPlan.map((seg, idx) => (
              <div key={idx} className="rounded border border-line/40 bg-surface/60 p-1.5 text-[10px]">
                <div className="flex justify-between text-t3 font-mono">
                  <span>Part {idx + 1}</span>
                  <span>{formatBytes(seg.total)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full transition-all duration-300 ${
                      (job.segmentsDone || 0) > idx ? 'bg-ok' : 'bg-accent'
                    }`}
                    style={{
                      width: (job.segmentsDone || 0) > idx ? '100%' : `${Math.min(100, Math.round((job.progress || 0) * 100))}%`
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Destination File Path */}
      {job.destination && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line/40 bg-surface-2/20 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1 truncate text-t3">
            <span className="text-t2 font-medium">Destination: </span>
            <span className="font-mono text-[11px]">{job.resultPath || job.destination}</span>
          </div>
          {job.resultPath && (
            <button
              onClick={() => onReveal?.(job.resultPath)}
              className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent-text hover:underline"
            >
              <FolderOpen style={{ width: 12, height: 12 }} /> Show in folder
            </button>
          )}
        </div>
      )}

      {/* Error Callout (if failed) */}
      {job.error && (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-err/30 bg-err/10 p-3 text-xs leading-relaxed text-err">
          <AlertTriangle className="shrink-0 mt-0.5" style={{ width: 15, height: 15 }} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Download Failed</p>
            <p className="mt-0.5 break-all">{job.error}</p>
          </div>
          <button
            onClick={() => copyText(job.error, 'Error message copied')}
            className="p-1 text-err hover:opacity-80"
            title="Copy error details"
          >
            <Copy style={{ width: 12, height: 12 }} />
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Loader,
  XCircle,
  RotateCcw,
  Trash2,
  FolderOpen,
  Download,
  ListOrdered,
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  Gauge,
  CheckCircle2,
  AlertCircle,
  Pause,
  Play
} from 'lucide-react';
import { api, onEvent } from '@/lib/ipc.js';
import { formatBytes, formatSpeed, formatEta, formatPercent, formatBytesDone, formatDate } from '@/lib/format.js';
import { Button, Card, StatusBadge, ProgressBar, EmptyState, AnimatedDialog } from '@/components/ui.jsx';
import Thumb from '@/components/Thumb.jsx';
import DownloadDetails from '@/components/DownloadDetails.jsx';

const TRANSFERRING = ['downloading', 'processing', 'fetching_metadata', 'pausing', 'resuming'];
const PAUSED = ['paused'];
const WAITING = ['waiting'];
const FINISHED = ['completed', 'failed', 'cancelled'];

export default function QueuePage() {
  const reduce = useReducedMotion();
  const [jobs, setJobs] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [finishedFilter, setFinishedFilter] = useState('all'); // 'all' | 'completed' | 'failed' | 'cancelled'
  const [confirmRemove, setConfirmRemove] = useState(null);

  useEffect(() => {
    api.jobs.list().then(setJobs).catch(() => {});
    return onEvent('jobs:updated', setJobs);
  }, []);

  const active = jobs.filter((j) => TRANSFERRING.includes(j.status));
  const paused = jobs.filter((j) => PAUSED.includes(j.status));
  const waiting = jobs.filter((j) => WAITING.includes(j.status));
  const finished = jobs.filter((j) => FINISHED.includes(j.status));

  const filteredFinished = finished.filter((j) => {
    if (finishedFilter === 'completed') return j.status === 'completed';
    if (finishedFilter === 'failed') return j.status === 'failed';
    if (finishedFilter === 'cancelled') return j.status === 'cancelled';
    return true;
  });

  const completedCount = finished.filter((j) => j.status === 'completed').length;
  const failedCount = finished.filter((j) => j.status === 'failed').length;
  const cancelledCount = finished.filter((j) => j.status === 'cancelled').length;

  function toggleExpand(id) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function act(fn, id, okMsg) {
    try {
      await fn(id);
      if (okMsg) toast.success(okMsg);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function reveal(resultPath) {
    if (!resultPath) return;
    try {
      await api.reveal(resultPath);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="overline">Manage</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Download Queue</h1>
          <p className="mt-1 text-sm text-t2">
            {active.length} transferring · {paused.length} paused · {waiting.length} waiting · {finished.length} finished
          </p>
        </div>
        <div className="flex items-center gap-2">
          {finished.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => act(api.jobs.clearCompleted, null, 'Cleared finished jobs')}
            >
              Clear finished ({finished.length})
            </Button>
          )}
        </div>
      </header>

      {/* Global Empty State */}
      {jobs.length === 0 && (
        <EmptyState
          icon={Download}
          title="Queue is empty"
          hint="Add downloads from the Universal Downloader, the title bar input, or Quick Download."
        />
      )}

      {/* 1. ACTIVE TRANSFERS */}
      {active.length > 0 && (
        <Card className="overflow-hidden border-accent/20">
          <div className="flex items-center justify-between border-b border-line bg-surface-2/30 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-t1">Active Transfers</span>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent-text">
                {active.length}
              </span>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-t3">
              <span className="h-2 w-2 rounded-full bg-accent pulse-dot" aria-hidden /> Live Telemetry
            </span>
          </div>

          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {active.map((j) => {
                const isExpanded = expandedId === j.id;
                const hasTotal = j.totalBytes != null && j.totalBytes > 0;
                const pct = hasTotal ? (j.progressPercent != null ? j.progressPercent : (j.progress || 0) * 100) : null;
                const displaySpeed = j.currentSpeed || j.speed;

                return (
                  <motion.li
                    key={j.id}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, x: -8 }}
                    transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                    className="p-4 sm:px-5"
                  >
                    {/* Compact Active Row */}
                    <div className="flex items-center gap-3">
                      {j.thumbnail ? (
                        <Thumb src={j.thumbnail} alt="" className="h-11 w-11 shrink-0 rounded-lg shadow-xs" />
                      ) : (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2">
                          <Activity className="text-accent animate-pulse" style={{ width: 16, height: 16 }} />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[13px] font-medium text-t1">{j.filename || j.title || j.url}</p>
                          {j.provider && (
                            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.2 text-[10px] font-medium uppercase tracking-wide text-t3">
                              {j.provider}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-t3">
                          <span className="truncate max-w-[240px]">{j.url}</span>
                          {j.format && <span>· {j.format}</span>}
                          {hasTotal && (
                            <span className="tabular-nums font-medium text-t2">
                              · {formatBytesDone(j)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Live Speed & ETA Badges */}
                      <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0 text-right">
                        <div className="flex items-center gap-1.5">
                          {displaySpeed > 0 && (
                            <span className="rounded-md bg-accent-soft/80 px-2 py-0.5 text-xs font-semibold tabular-nums text-accent-text">
                              {formatSpeed(displaySpeed)}
                            </span>
                          )}
                          <StatusBadge status={j.status} />
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-t3 tabular-nums">
                          {j.etaSeconds != null && (
                            <span className="flex items-center gap-1">
                              <Clock style={{ width: 10, height: 10 }} />
                              {formatEta(j.etaSeconds)} left
                            </span>
                          )}
                          {hasTotal && pct != null && (
                            <span>{formatPercent(pct)}</span>
                          )}
                        </div>
                      </div>

                      {/* Action cluster */}
                      <div className="flex shrink-0 items-center gap-1">
                        {['downloading', 'resuming'].includes(j.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => act(api.jobs.pause, j.id, 'Pausing download')}
                            title="Pause download"
                            aria-label="Pause download"
                            className="h-8 w-8 p-0 text-t3 hover:text-warn"
                          >
                            <Pause style={{ width: 14, height: 14 }} />
                          </Button>
                        )}
                        {j.status === 'pausing' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled
                            title="Pausing…"
                            aria-label="Pausing…"
                            className="h-8 w-8 p-0 text-warn opacity-50 cursor-not-allowed"
                          >
                            <Pause style={{ width: 14, height: 14 }} className="animate-pulse" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpand(j.id)}
                          title={isExpanded ? 'Hide details' : 'Show details'}
                          aria-label={isExpanded ? 'Hide details' : 'Show details'}
                          className="h-8 w-8 p-0 text-t3 hover:text-t1"
                        >
                          {isExpanded ? <ChevronUp style={{ width: 15, height: 15 }} /> : <ChevronDown style={{ width: 15, height: 15 }} />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => act(api.jobs.cancel, j.id, 'Download cancelled')}
                          title="Cancel download"
                          aria-label="Cancel download"
                          className="h-8 w-8 p-0 text-t3 hover:text-err"
                        >
                          <XCircle style={{ width: 15, height: 15 }} />
                        </Button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-3 flex items-center gap-3 pl-0 sm:pl-[56px]">
                      <ProgressBar
                        value={hasTotal ? (pct != null ? pct / 100 : j.progress) : 1}
                        indeterminate={!hasTotal || j.status === 'processing'}
                        active={j.status === 'downloading'}
                        className="flex-1"
                      />
                      <span className="shrink-0 text-right text-[11px] tabular-nums text-t3">
                        {j.status === 'processing'
                          ? 'merging / converting…'
                          : hasTotal
                          ? `${formatPercent(pct)} (${formatBytes(j.downloadedBytes || j.bytesDone)})`
                          : `${formatBytes(j.downloadedBytes || j.bytesDone)} streamed`}
                      </span>
                    </div>

                    {/* Expandable IDM Details Panel */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={reduce ? false : { opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={reduce ? undefined : { opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <DownloadDetails
                            job={j}
                            onPause={() => act(api.jobs.pause, j.id, 'Pausing download')}
                            onResume={() => act(api.jobs.resume, j.id, 'Resuming download')}
                            onCancel={() => act(api.jobs.cancel, j.id, 'Cancelled')}
                            onRetry={() => act(api.jobs.retry, j.id, 'Retrying')}
                            onRemove={() => setConfirmRemove(j.id)}
                            onReveal={reveal}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </Card>
      )}

      {/* 2. PAUSED DOWNLOADS */}
      {paused.length > 0 && (
        <Card className="overflow-hidden border-warn/30">
          <div className="flex items-center justify-between border-b border-line bg-surface-2/30 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-t1">Paused Downloads</span>
              <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-warn">
                {paused.length}
              </span>
            </div>
            <span className="text-[11px] text-t3">Partial files retained on disk · Ready to resume</span>
          </div>

          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {paused.map((j) => {
                const isExpanded = expandedId === j.id;
                const hasTotal = j.totalBytes != null && j.totalBytes > 0;
                const pct = hasTotal ? (j.progressPercent != null ? j.progressPercent : (j.progress || 0) * 100) : null;

                return (
                  <motion.li
                    key={j.id}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, x: -8 }}
                    transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                    className="p-4 sm:px-5"
                  >
                    <div className="flex items-center gap-3">
                      {j.thumbnail ? (
                        <Thumb src={j.thumbnail} alt="" className="h-11 w-11 shrink-0 rounded-lg shadow-xs opacity-80" />
                      ) : (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2">
                          <Pause className="text-warn" style={{ width: 16, height: 16 }} />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[13px] font-medium text-t1">{j.filename || j.title || j.url}</p>
                          {j.provider && (
                            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.2 text-[10px] font-medium uppercase tracking-wide text-t3">
                              {j.provider}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-t3">
                          <span className="truncate max-w-[240px]">{j.url}</span>
                          {j.format && <span>· {j.format}</span>}
                          <span className="tabular-nums font-medium text-t2">
                            · {formatBytes(j.downloadedBytes || j.bytesDone)} {hasTotal ? `of ${formatBytes(j.totalBytes)}` : 'retained'}
                          </span>
                        </div>
                      </div>

                      {/* Paused Badge */}
                      <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0 text-right">
                        <StatusBadge status="paused" />
                        <div className="text-[11px] text-t3 tabular-nums">
                          {hasTotal && pct != null ? `${formatPercent(pct)} saved` : 'Stream saved'}
                        </div>
                      </div>

                      {/* Action cluster */}
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => act(api.jobs.resume, j.id, 'Resuming download')}
                          title="Resume download"
                          aria-label="Resume download"
                          className="h-8 w-8 p-0 text-accent hover:text-accent-text hover:bg-accent-soft"
                        >
                          <Play style={{ width: 14, height: 14 }} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpand(j.id)}
                          title={isExpanded ? 'Hide details' : 'Show details'}
                          aria-label={isExpanded ? 'Hide details' : 'Show details'}
                          className="h-8 w-8 p-0 text-t3 hover:text-t1"
                        >
                          {isExpanded ? <ChevronUp style={{ width: 15, height: 15 }} /> : <ChevronDown style={{ width: 15, height: 15 }} />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => act(api.jobs.cancel, j.id, 'Download cancelled')}
                          title="Cancel and remove partial file"
                          aria-label="Cancel download"
                          className="h-8 w-8 p-0 text-t3 hover:text-err"
                        >
                          <XCircle style={{ width: 15, height: 15 }} />
                        </Button>
                      </div>
                    </div>

                    {/* Retained Progress Bar */}
                    <div className="mt-3 flex items-center gap-3 pl-0 sm:pl-[56px]">
                      <ProgressBar
                        value={hasTotal ? (pct != null ? pct / 100 : j.progress) : 1}
                        indeterminate={false}
                        active={false}
                        className="flex-1 opacity-70"
                      />
                      <span className="shrink-0 text-right text-[11px] tabular-nums text-t3">
                        {hasTotal ? `${formatPercent(pct)} (${formatBytes(j.downloadedBytes || j.bytesDone)})` : `${formatBytes(j.downloadedBytes || j.bytesDone)} saved`}
                      </span>
                    </div>

                    {/* Expandable IDM Details Panel */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={reduce ? false : { opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={reduce ? undefined : { opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <DownloadDetails
                            job={j}
                            onPause={() => act(api.jobs.pause, j.id, 'Pausing download')}
                            onResume={() => act(api.jobs.resume, j.id, 'Resuming download')}
                            onCancel={() => act(api.jobs.cancel, j.id, 'Cancelled')}
                            onRetry={() => act(api.jobs.retry, j.id, 'Retrying')}
                            onRemove={() => setConfirmRemove(j.id)}
                            onReveal={reveal}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </Card>
      )}

      {/* 3. WAITING IN QUEUE */}
      {waiting.length > 0 && (
        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-t1">Waiting in Queue</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-t2 border border-line">
                {waiting.length}
              </span>
            </div>
            <span className="text-[11px] text-t3">Queued for concurrency slot</span>
          </div>

          <ul className="divide-y divide-line">
            {waiting.map((j, idx) => (
              <li key={j.id} className="p-4 sm:px-5">
                <div className="flex items-center gap-3">
                  {/* Queue Position Pill */}
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 font-mono text-xs font-semibold text-accent-text"
                    title={`Queue Position #${idx + 1}`}
                  >
                    #{idx + 1}
                  </span>

                  {j.thumbnail ? (
                    <Thumb src={j.thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-lg shadow-xs" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2">
                      <ListOrdered className="text-t3" style={{ width: 14, height: 14 }} />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-t1">{j.title || j.url}</p>
                    <p className="truncate text-[11px] text-t3">
                      {j.url} {j.format ? `· ${j.format}` : ''}
                      {j.destination ? ` · to ${j.destination}` : ''}
                    </p>
                  </div>

                  <StatusBadge status="waiting" />

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => act(api.jobs.cancel, j.id, 'Removed from queue')}
                      title="Cancel job"
                      aria-label="Cancel job"
                      className="h-8 w-8 p-0 text-t3 hover:text-err"
                    >
                      <XCircle style={{ width: 14, height: 14 }} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmRemove(j.id)}
                      title="Remove record"
                      aria-label="Remove record"
                      className="h-8 w-8 p-0 text-t3 hover:text-err"
                    >
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 3. FINISHED TRANSFERS */}
      {finished.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-t1">Finished Transfers</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-t2 border border-line">
                {finished.length}
              </span>
            </div>

            {/* Segmented Filter Control */}
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-2/40 p-0.5 text-xs">
              <button
                onClick={() => setFinishedFilter('all')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  finishedFilter === 'all' ? 'bg-surface text-t1 shadow-xs' : 'text-t3 hover:text-t1'
                }`}
              >
                All ({finished.length})
              </button>
              <button
                onClick={() => setFinishedFilter('completed')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  finishedFilter === 'completed' ? 'bg-surface text-t1 shadow-xs' : 'text-t3 hover:text-t1'
                }`}
              >
                Completed ({completedCount})
              </button>
              {failedCount > 0 && (
                <button
                  onClick={() => setFinishedFilter('failed')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    finishedFilter === 'failed' ? 'bg-surface text-err shadow-xs' : 'text-t3 hover:text-t1'
                  }`}
                >
                  Failed ({failedCount})
                </button>
              )}
              {cancelledCount > 0 && (
                <button
                  onClick={() => setFinishedFilter('cancelled')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    finishedFilter === 'cancelled' ? 'bg-surface text-t1 shadow-xs' : 'text-t3 hover:text-t1'
                  }`}
                >
                  Cancelled ({cancelledCount})
                </button>
              )}
            </div>
          </div>

          {filteredFinished.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-t3">No downloads in this filter.</p>
          ) : (
            <ul className="divide-y divide-line">
              {filteredFinished.map((j) => {
                const isExpanded = expandedId === j.id;
                return (
                  <li key={j.id} className="p-4 sm:px-5">
                    <div className="flex items-center gap-3">
                      {j.thumbnail ? (
                        <Thumb src={j.thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-lg shadow-xs" />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2">
                          {j.status === 'completed' ? (
                            <CheckCircle2 className="text-ok" style={{ width: 14, height: 14 }} />
                          ) : (
                            <AlertCircle className="text-t3" style={{ width: 14, height: 14 }} />
                          )}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-t1">{j.filename || j.title || j.url}</p>
                        <p className="truncate text-[11px] text-t3">
                          {formatDate(j.finishedAt)}
                          {j.bytesDone ? ` · ${formatBytes(j.bytesDone)}` : ''}
                          {j.format ? ` · ${j.format}` : ''}
                        </p>
                      </div>

                      <StatusBadge status={j.status} />

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpand(j.id)}
                          title={isExpanded ? 'Hide details' : 'Show details'}
                          aria-label={isExpanded ? 'Hide details' : 'Show details'}
                          className="h-8 w-8 p-0 text-t3 hover:text-t1"
                        >
                          {isExpanded ? <ChevronUp style={{ width: 15, height: 15 }} /> : <ChevronDown style={{ width: 15, height: 15 }} />}
                        </Button>
                        {j.status === 'completed' && j.resultPath && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => reveal(j.resultPath)}
                            title="Show in folder"
                            aria-label="Show in folder"
                            className="h-8 w-8 p-0 text-t3 hover:text-t1"
                          >
                            <FolderOpen style={{ width: 14, height: 14 }} />
                          </Button>
                        )}
                        {['failed', 'cancelled'].includes(j.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => act(api.jobs.retry, j.id, 'Retrying download')}
                            title="Retry download"
                            aria-label="Retry download"
                            className="h-8 w-8 p-0 text-t3 hover:text-accent-text"
                          >
                            <RotateCcw style={{ width: 14, height: 14 }} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmRemove(j.id)}
                          title="Remove record"
                          aria-label="Remove record"
                          className="h-8 w-8 p-0 text-t3 hover:text-err"
                        >
                          <Trash2 style={{ width: 14, height: 14 }} />
                        </Button>
                      </div>
                    </div>

                    {/* Result path preview if completed */}
                    {j.status === 'completed' && j.resultPath && !isExpanded && (
                      <p className="mt-1.5 truncate pl-0 sm:pl-[52px] font-mono text-[11px] text-t3/80" title={j.resultPath}>
                        {j.resultPath}
                      </p>
                    )}

                    {/* Error snippet if failed */}
                    {j.error && !isExpanded && (
                      <div className="mt-2.5 sm:ml-[52px] rounded-lg border border-err/25 bg-err/10 px-3.5 py-1.5 text-xs text-err">
                        {j.error}
                      </div>
                    )}

                    {/* Expandable IDM Details Panel */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={reduce ? false : { opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={reduce ? undefined : { opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <DownloadDetails
                            job={j}
                            onCancel={() => act(api.jobs.cancel, j.id, 'Cancelled')}
                            onRetry={() => act(api.jobs.retry, j.id, 'Retrying')}
                            onRemove={() => setConfirmRemove(j.id)}
                            onReveal={reveal}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {/* Confirm Remove Dialog */}
      <AnimatedDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        title="Remove this job?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const id = confirmRemove;
                setConfirmRemove(null);
                await act(api.jobs.remove, id, 'Job record removed');
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-t2 leading-relaxed">
          The downloaded file on disk is kept. This only removes the job record from your queue and history.
        </p>
      </AnimatedDialog>
    </div>
  );
}


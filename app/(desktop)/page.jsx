'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Download,
  Link2,
  ClipboardPaste,
  Loader,
  CheckCircle2,
  HardDrive,
  ListOrdered,
  Activity,
  ArrowUpRight,
  XCircle,
  Video,
  Music,
  Image as ImageIcon,
  Share2,
  FolderOpen,
  Globe,
  Cpu
} from 'lucide-react';
import { api, onEvent } from '@/lib/ipc.js';
import { formatBytes, formatSpeed, formatEta, formatBytesDone, formatDate } from '@/lib/format.js';
import { Button, Card, CardHeader, Stat, StatusBadge, ProgressBar, EmptyState, GlassPanel } from '@/components/ui.jsx';

const ACTIVE = ['waiting', 'downloading', 'processing', 'fetching_metadata'];

export default function DashboardPage() {
  const router = useRouter();
  const [quick, setQuick] = useState('');
  const [jobs, setJobs] = useState([]);
  const [bins, setBins] = useState(null);
  const [info, setInfo] = useState(null);
  const [lib, setLib] = useState(null);

  useEffect(() => {
    api.jobs.list().then(setJobs).catch(() => {});
    api.bins.status().then(setBins).catch(() => {});
    api.info().then(setInfo).catch(() => {});
    api.library.scan().then(setLib).catch(() => {});
    return onEvent('jobs:updated', setJobs);
  }, []);

  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  const waiting = jobs.filter((j) => j.status === 'waiting');
  const completed = jobs.filter((j) => j.status === 'completed');
  const storageBytes = lib ? lib.files.reduce((s, f) => s + f.size, 0) : 0;
  const recent = jobs.filter((j) => !ACTIVE.includes(j.status)).slice(0, 6);

  function quickSubmit() {
    const v = quick.trim();
    if (!v) return;
    router.push(`/universal?url=${encodeURIComponent(v)}`);
    setQuick('');
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setQuick(t.trim());
    } catch {}
  }

  return (
    <div className="space-y-5">
      {/* welcome + quick download */}
      <section>
        <p className="overline">Overview</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-t1">Download anything supported.</h1>
        <p className="mt-1 text-sm text-t2">Paste a link — MantiCollect identifies the source, reads the real formats, and queues the download.</p>
      </section>

      <GlassPanel className="p-4 sm:p-5 shadow-sm">
        <div className="flex gap-2.5">
          <div className="relative flex-1 group">
            <Link2 className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-t3 transition-colors group-focus-within:text-accent" style={{ width: 16, height: 16 }} />
            <input
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && quickSubmit()}
              placeholder="https://…  — video, audio, image, post, playlist, or direct file"
              aria-label="Quick download URL"
              className="h-12 w-full rounded-xl border border-line-strong bg-surface-2/40 pl-11 pr-12 text-[14px] text-t1 placeholder:text-t3/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] transition-all outline-none focus:border-accent/70 focus:bg-surface focus:ring-2 focus:ring-accent/25"
            />
            {quick && (
              <button
                onClick={() => setQuick('')}
                aria-label="Clear"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-t3 transition-colors hover:bg-surface-2 hover:text-t1"
              >
                <XCircle style={{ width: 16, height: 16 }} />
              </button>
            )}
          </div>
          <Button variant="secondary" size="lg" onClick={paste} title="Paste from clipboard" aria-label="Paste URL">
            <ClipboardPaste style={{ width: 16, height: 16 }} />
          </Button>
          <Button size="lg" onClick={quickSubmit} disabled={!quick.trim()}>
            <Download style={{ width: 16, height: 16 }} />
            Download
          </Button>
        </div>
        <div className="mt-3 flex items-center justify-between px-1">
          <p className="text-xs text-t3">
            Direct media files and 16 registered platforms — support is decided by the source, never assumed.
          </p>
          <Link href="/platforms" className="flex items-center gap-1 text-xs font-medium text-accent-text transition-colors hover:brightness-125">
            Platform support <ArrowUpRight style={{ width: 12, height: 12 }} />
          </Link>
        </div>
      </GlassPanel>

      {/* stats — real data only */}
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Active downloads" value={active.length} sub={active.length ? 'running or queued' : 'queue is idle'} icon={Loader} tone="accent" />
        <Stat label="Waiting in queue" value={waiting.length} sub={waiting.length ? 'concurrency-limited' : 'nothing pending'} icon={ListOrdered} tone="info" />
        <Stat label="Completed" value={completed.length} sub={formatBytes(completed.reduce((s, j) => s + (j.bytesDone || 0), 0)) + ' downloaded'} icon={CheckCircle2} tone="ok" />
        <Stat label="Library storage" value={formatBytes(storageBytes)} sub={lib ? `${lib.files.length} file(s) in download folder` : 'scanning…'} icon={HardDrive} tone="neutral" />
      </section>

      <section className="grid gap-4 xl:grid-cols-5">
        {/* active downloads */}
        <Card className="xl:col-span-3">
          <CardHeader
            title="Active downloads"
            subtitle="Live progress from the download processes"
            icon={Activity}
            actions={
              <Link href="/queue" className="flex items-center gap-1 text-xs font-medium text-accent-text hover:brightness-125">
                Queue <ArrowUpRight style={{ width: 12, height: 12 }} />
              </Link>
            }
          />
          {active.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Download}
                title="Nothing downloading"
                hint="Use the panel above or the Universal Downloader to add your first media."
                action={
                  <Link href="/universal">
                    <Button size="sm">Open Universal Downloader</Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {active.slice(0, 6).map((j) => (
                <li key={j.id} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={j.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-t1">{j.title || j.url}</p>
                      <p className="truncate text-[11px] text-t3">
                        {j.provider || 'auto'}
                        {j.format ? ` · ${j.format}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-[11px] tabular-nums text-t3">
                      {j.status === 'downloading' ? (
                        <span className="flex items-center gap-1.5 justify-end">
                          {(j.currentSpeed || j.speed) > 0 && (
                            <span className="font-semibold text-accent-text">{formatSpeed(j.currentSpeed || j.speed)}</span>
                          )}
                          {j.etaSeconds != null && (
                            <span>· {formatEta(j.etaSeconds)} left</span>
                          )}
                          {(j.bytesTotal || j.totalBytes) ? <span>· {Math.round((j.progress || 0) * 100)}%</span> : ''}
                        </span>
                      ) : j.status === 'processing' ? (
                        'converting…'
                      ) : (
                        'queued'
                      )}
                    </div>
                    <button
                      onClick={() => api.jobs.cancel(j.id).catch(() => {})}
                      title="Cancel"
                      className="shrink-0 rounded-md p-1.5 text-t3 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent hover:bg-surface-2 hover:text-err"
                      aria-label="Cancel download"
                    >
                      <XCircle style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                  <ProgressBar className="mt-2.5" value={j.progress} active={j.status === 'downloading'} indeterminate={j.status === 'waiting' || j.status === 'fetching_metadata'} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* recent + engine */}
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader
              title="Recent activity"
              icon={Activity}
              actions={
                <Link href="/history" className="flex items-center gap-1 text-xs font-medium text-accent-text hover:brightness-125">
                  History <ArrowUpRight style={{ width: 12, height: 12 }} />
                </Link>
              }
            />
            {recent.length === 0 ? (
              <p className="px-5 py-6 text-center text-xs text-t3">Finished downloads will appear here.</p>
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((j) => (
                  <li key={j.id} className="flex items-center gap-3 px-5 py-2.5">
                    <StatusBadge status={j.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-t1">{j.title || j.url}</p>
                      <p className="truncate text-[11px] text-t3">
                        {j.provider || 'auto'} · {formatDate(j.finishedAt)}
                        {j.bytesTotal ? ` · ${formatBytesDone(j)}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Engine"
              subtitle="Real binary checks"
              icon={Cpu}
              actions={
                <Link href="/settings" className="text-xs font-medium text-accent-text hover:brightness-125">
                  Settings
                </Link>
              }
            />
            <div className="space-y-2.5 p-5">
              <EngineRow label="FFmpeg" ok={bins?.ffmpeg?.available} value={bins?.ffmpeg?.version || 'not found — needed for merging & conversion'} />
              <EngineRow label="FFprobe" ok={bins?.ffprobe?.available} value={bins?.ffprobe?.version || 'not found'} />
              <EngineRow label="yt-dlp" ok={bins?.ytdlp?.available} value={bins?.ytdlp?.version || 'not installed — Settings → Binaries'} />
            </div>
          </Card>
        </div>
      </section>

      {/* quick actions */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <QuickAction href="/video" icon={Video} label="Video" hint="Quality selection" />
        <QuickAction href="/audio" icon={Music} label="Audio" hint="Extract or convert" />
        <QuickAction href="/image" icon={ImageIcon} label="Images" hint="Files & albums" />
        <QuickAction href="/social" icon={Share2} label="Social" hint="Posts & reels" />
        <QuickAction href="/collections" icon={FolderOpen} label="Collections" hint="Playlists & boards" />
        <QuickAction href="/platforms" icon={Globe} label="Platforms" hint="Support matrix" />
      </section>
    </div>
  );
}

function EngineRow({ label, ok, value }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line/60 bg-surface-2/30 px-3.5 py-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-ok shadow-[0_0_6px_var(--mv-ok)]' : 'bg-err shadow-[0_0_6px_var(--mv-err)]'}`} aria-hidden />
      <span className="w-18 shrink-0 text-[13px] font-medium text-t1">{label}</span>
      <span className={`min-w-0 truncate text-xs ${ok ? 'text-t3' : 'text-err/90 font-medium'}`} title={value}>
        {value}
      </span>
    </div>
  );
}

function QuickAction({ href, icon: Icon, label, hint }) {
  return (
    <Link href={href} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
      <Card hover className="fade-up flex h-full flex-col gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-accent-soft shadow-xs">
          <Icon className="text-accent-text" style={{ width: 16, height: 16 }} />
        </div>
        <div>
          <p className="text-[13px] font-semibold tracking-tight text-t1">{label}</p>
          <p className="mt-0.5 text-[11px] text-t3">{hint}</p>
        </div>
      </Card>
    </Link>
  );
}

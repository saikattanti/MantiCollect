import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Link2,
  Search,
  Loader2,
  AlertTriangle,
  Download,
  FolderOpen,
  CheckSquare,
  Square,
  ClipboardPaste,
  X,
  Clock,
  User,
  HardDrive,
  CalendarDays,
  ChevronDown,
  Check
} from 'lucide-react';
import { api } from '../lib/ipc.js';
import { formatBytes, formatDuration } from '../lib/format.js';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Input, Label, Select, EmptyState } from '../components/ui.jsx';
import Thumb from './Thumb.jsx';

const PLATFORM_LABELS = {};
/**
 * Universal URL input + probe + preview + download.
 * Shared by Universal / Video / Audio / Image / Social / Collections.
 * `focusKind` preselects the relevant option family.
 * Supports ?url=… deep links (title bar / dashboard quick input).
 */
export default function ProbeView({ focusKind = null, defaultCollectionMode = false }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [url, setUrl] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState(null);
  const [result, setResult] = useState(null);
  const [destDir, setDestDir] = useState('');
  const [formatId, setFormatId] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [starting, setStarting] = useState(false);
  const autoRan = useRef(false);

  function probeWith(value) {
    if (!value) return;
    setProbing(true);
    setProbeError(null);
    setResult(null);
    setSelected(new Set());
    api
      .probe(value)
      .then((res) => {
        setResult(res);
        const opts = res.options || [];
        const preferred = focusKind
          ? opts.find((o) => o.kind === focusKind) || opts.find((o) => (focusKind === 'video' || focusKind === 'image') && o.kind !== 'audio') || opts[0]
          : opts[0];
        setFormatId(preferred ? preferred.id : '');
        if (defaultCollectionMode && res.type === 'collection') setSelected(new Set((res.items || []).map((i) => i.id)));
      })
      .catch((err) => setProbeError(err.message))
      .finally(() => setProbing(false));
  }

  function probe() {
    probeWith(url.trim());
  }

  // deep link: /universal?url=…
  useEffect(() => {
    const u = searchParams.get('url');
    if (u && !autoRan.current) {
      autoRan.current = true;
      setUrl(u);
      probeWith(u);
      router.replace(pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setUrl(t.trim());
    } catch {}
  }

  async function pickDir() {
    const { path } = await api.selectDirectory();
    if (path) setDestDir(path);
  }

  async function startItem() {
    if (!result) return;
    const opt = (result.options || []).find((o) => o.id === formatId) || null;
    setStarting(true);
    try {
      await api.jobs.start({
        url: result.webpageUrl || url.trim(),
        provider: result.provider,
        kind: opt ? opt.kind : null,
        title: result.title,
        format: opt ? opt.label : 'default',
        destDir: destDir || undefined,
        extra: {
          formatOption: opt,
          expectedId: result.id || null,
          thumbnail: result.thumbnail || null
        }
      });
      toast.success('Added to download queue');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setStarting(false);
    }
  }

  async function startCollection() {
    if (!result || selected.size === 0) return;
    setStarting(true);
    try {
      const items = (result.items || []).filter((i) => selected.has(i.id));
      // One queue job per item: independent progress; one failure never
      // cancels the rest.
      const collectionId = `col-${Date.now()}`;
      for (const item of items) {
        await api.jobs.start({
          url: item.url || result.webpageUrl || url.trim(),
          provider: result.provider,
          kind: focusKind || 'media',
          title: item.title,
          format: 'per item',
          destDir: destDir || undefined,
          collectionId,
          extra: {
            playlistItems: item.url ? null : [item.id],
            expectedId: item.id || null,
            thumbnail: item.thumbnail || null
          }
        });
      }
      toast.success(`Queued ${items.length} item${items.length === 1 ? '' : 's'}`);
      setResult(null);
      setUrl('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setStarting(false);
    }
  }

  const toggleItem = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const allItems = result?.items || [];
  const allSelected = allItems.length > 0 && selected.size === allItems.length;

  return (
    <div className="space-y-4">
      {/* input */}
      <Card className="p-4 sm:p-5">
        <div className="flex gap-2.5">
          <div className="relative flex-1 group">
            <Link2 className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-t3 transition-colors group-focus-within:text-accent" style={{ width: 16, height: 16 }} />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && probe()}
              placeholder="Paste a media URL, post, profile, or playlist link…"
              aria-label="Media URL"
              className="h-11 w-full rounded-xl border border-line-strong bg-surface-2/40 pl-10 pr-16 text-sm text-t1 placeholder:text-t3/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-all outline-none focus:border-accent/70 focus:bg-surface focus:ring-2 focus:ring-accent/25"
            />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              <button
                onClick={paste}
                title="Paste from clipboard"
                aria-label="Paste"
                className="rounded-md p-1.5 text-t3 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent hover:bg-surface-2 hover:text-t1"
              >
                <ClipboardPaste style={{ width: 14, height: 14 }} />
              </button>
              {url && (
                <button
                  onClick={() => setUrl('')}
                  title="Clear"
                  aria-label="Clear"
                  className="rounded-md p-1.5 text-t3 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent hover:bg-surface-2 hover:text-t1"
                >
                  <X style={{ width: 14, height: 14 }} />
                </button>
              )}
            </div>
          </div>
          <Button size="lg" onClick={probe} disabled={probing || !url.trim()}>
            {probing ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <Search style={{ width: 16, height: 16 }} />}
            Analyze
          </Button>
        </div>
        {probing && (
          <div className="mt-3">
            <div className="shimmer h-1.5 w-full overflow-hidden rounded-full bg-surface-2 border border-line/40" />
            <p className="mt-2 flex items-center gap-2 text-xs text-t3">
              <Loader2 className="animate-spin text-accent" style={{ width: 13, height: 13 }} />
              Contacting source and reading real metadata — this takes a few seconds…
            </p>
          </div>
        )}
      </Card>

      {/* error state */}
      {probeError && (
        <Card className="fade-up border-err/30 p-4" style={{ background: 'color-mix(in srgb, var(--mv-err) 5%, var(--mv-surface))' }}>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-err/30 bg-err/10 shadow-xs">
              <AlertTriangle className="text-err" style={{ width: 16, height: 16 }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-t1">Could not process this URL</p>
              <p className="mt-1 text-xs leading-relaxed text-t2">{probeError}</p>
            </div>
          </div>
        </Card>
      )}

      {/* item preview */}
      {result && result.type === 'item' && (
        <Card className="fade-up overflow-hidden shadow-sm">
          <div className="flex flex-col gap-5 p-5 sm:flex-row">
            {result.thumbnail && (
              <Thumb src={result.thumbnail} alt="" className="aspect-video w-full sm:w-48 shrink-0 rounded-xl" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-accent/25 bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold capitalize text-accent-text">{result.provider}</span>
                {result.ext && <span className="rounded-full border border-line bg-surface-2/70 px-2.5 py-0.5 text-[11px] font-medium uppercase text-t3">{result.ext}</span>}
              </div>
              <h3 className="mt-2.5 truncate text-[16px] font-semibold tracking-tight text-t1" title={result.title}>
                {result.title}
              </h3>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-t2">
                {result.uploader && (
                  <span className="flex items-center gap-1.5">
                    <User className="text-t3" style={{ width: 13, height: 13 }} /> {result.uploader}
                  </span>
                )}
                {result.duration > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="text-t3" style={{ width: 13, height: 13 }} /> {formatDuration(result.duration)}
                  </span>
                )}
                {result.contentLength > 0 && (
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="text-t3" style={{ width: 13, height: 13 }} /> {formatBytes(result.contentLength)}
                  </span>
                )}
                {result.uploadDate && (
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="text-t3" style={{ width: 13, height: 13 }} /> {result.uploadDate}
                  </span>
                )}
                {result.contentType && <span className="font-mono text-[11px] text-t3">{result.contentType}</span>}
              </div>
              {(result.videoFormats?.length || result.audioFormats?.length) && (
                <FormatReport result={result} />
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3.5 border-t border-line bg-surface-2/30 px-5 py-4">
            {(result.options || []).length > 0 && (
              <div className="min-w-[260px] flex-1">
                <Label>Format — as reported by the source</Label>
                <Select value={formatId} onChange={(e) => setFormatId(e.target.value)} className="w-full">
                  {(result.options || []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="w-72">
              <Label>Destination</Label>
              <div className="flex gap-1.5">
                <Input value={destDir} onChange={(e) => setDestDir(e.target.value)} placeholder="default download folder" />
                <Button variant="secondary" onClick={pickDir} aria-label="Browse folder">
                  <FolderOpen style={{ width: 15, height: 15 }} />
                </Button>
              </div>
            </div>
            <Button size="lg" onClick={startItem} disabled={starting}>
              <Download style={{ width: 16, height: 16 }} />
              Download
            </Button>
          </div>
        </Card>
      )}

      {/* collection preview */}
      {result && result.type === 'collection' && (
        <Card className="fade-up overflow-hidden">
          <CardHeader
            title={result.title || 'Collection'}
            subtitle={`${result.count ?? allItems.length} item(s) — only what the source actually exposes`}
            actions={
              <Button size="sm" variant="secondary" onClick={() => setSelected(allSelected ? new Set() : new Set(allItems.map((i) => i.id)))}>
                {allSelected ? 'Clear selection' : 'Select all'}
              </Button>
            }
          />
          <div className="max-h-[420px] overflow-y-auto px-3 py-2">
            {allItems.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  title="No items listed"
                  hint="The source reported a collection but did not expose its items — a real limitation. Try a direct post or video link instead."
                />
              </div>
            ) : (
              <ul className="space-y-0.5">
                {allItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2/50">
                    <button onClick={() => toggleItem(item.id)} aria-label={`Select ${item.title}`} className="shrink-0">
                      {selected.has(item.id) ? (
                        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-accent text-white">
                          <Check style={{ width: 12, height: 12 }} />
                        </span>
                      ) : (
                        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md border border-line-strong bg-transparent">
                          <Square className="text-t3" style={{ width: 11, height: 11 }} />
                        </span>
                      )}
                    </button>
                    {item.thumbnail ? (
                      <Thumb src={item.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded-md" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2">
                        <Link2 className="text-t3" style={{ width: 12, height: 12 }} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-t1">{item.title}</p>
                      {item.duration > 0 && <p className="text-[11px] text-t3">{formatDuration(item.duration)}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-line bg-bg-elev/40 px-5 py-3.5">
            <span className="text-xs text-t3">
              {selected.size} of {allItems.length} selected
            </span>
            <Button onClick={startCollection} disabled={starting || selected.size === 0}>
              <Download style={{ width: 16, height: 16 }} />
              Download selected ({selected.size})
            </Button>
          </div>
        </Card>
      )}

      {/* empty state */}
      {!result && !probing && !probeError && (
        <EmptyState
          icon={Link2}
          title="Paste a link to get started"
          hint="Direct media files (JPG, MP4, MP3, …), videos, posts, playlists, and collections. The preview shows exactly what the source reports — nothing is invented."
        />
      )}
    </div>
  );
}

function FormatReport({ result }) {
  const [open, setOpen] = useState(false);
  const rows = [...(result.videoFormats || []), ...(result.audioFormats || [])].slice(0, 30);
  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[11px] font-medium text-accent-text transition-colors hover:brightness-125">
        <ChevronDown className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`} style={{ width: 12, height: 12 }} />
        Source format report ({rows.length})
      </button>
      {open && (
        <div className="panel-inset fade-up mt-2 max-h-44 overflow-y-auto p-2">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-t3">
                <th className="pr-3 font-medium">codec</th>
                <th className="pr-3 font-medium">res</th>
                <th className="pr-3 font-medium">ext</th>
                <th className="pr-3 font-medium">bitrate</th>
                <th className="font-medium">size</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f, i) => (
                <tr key={i} className="border-t border-line text-t2">
                  <td className="pr-3">{f.vcodec || f.acodec}</td>
                  <td className="pr-3">{f.height ? `${f.height}p` : 'audio'}</td>
                  <td className="pr-3">{f.ext}</td>
                  <td className="pr-3">{f.tbr ? `${(f.tbr / 1000).toFixed(1)}k` : '—'}</td>
                  <td>{f.filesize ? formatBytes(f.filesize) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

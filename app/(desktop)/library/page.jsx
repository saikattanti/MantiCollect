'use client';

import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import {
  LayoutGrid,
  List,
  Search,
  Archive,
  Trash2,
  RefreshCcw,
  FolderOpen,
  Copy,
  AlertTriangle,
  Library as LibraryIcon,
  Check
} from 'lucide-react';
import { api, onEvent } from '@/lib/ipc.js';
import { formatBytes, formatDate } from '@/lib/format.js';
import { Button, Card, Input, Select, EmptyState, Spinner, AnimatedDialog } from '@/components/ui.jsx';

export default function LibraryPage() {
  const [files, setFiles] = useState(null);
  const [baseDir, setBaseDir] = useState('');
  const [view, setView] = useState('grid');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('date');
  const [selected, setSelected] = useState(() => new Set());
  const [thumbs, setThumbs] = useState({});
  const [zipping, setZipping] = useState(null);
  const [missing, setMissing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    scan();
    return onEvent('zip:progress', (p) => {
      if (p.phase === 'done' || p.phase === 'complete') {
        setZipping(null);
        toast.success(`ZIP exported: ${p.count ?? ''} file(s)${p.size ? ` (${formatBytes(p.size)})` : ''}`);
      } else if (p.phase === 'error') {
        setZipping(null);
        toast.error(p.error);
      } else {
        setZipping({ ...p });
      }
    });
  }, []);

  async function scan() {
    try {
      const res = await api.library.scan();
      setFiles(res.files);
      setBaseDir(res.baseDir);
      loadMissing();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function loadMissing() {
    try {
      const res = await api.library.missing();
      setMissing(res.missing);
    } catch {
      setMissing(null);
    }
  }

  useEffect(() => {
    // lazy thumbnails for visible images (real bytes, 3 MB cap in main)
    const visible = filtered.slice(0, 60).filter((f) => f.kind === 'image' && !thumbs[f.path]);
    if (!visible.length) return;
    let cancelled = false;
    (async () => {
      for (const f of visible.slice(0, 12)) {
        try {
          const t = await api.library.thumbnail(f.path);
          if (cancelled) return;
          if (t) setThumbs((prev) => ({ ...prev, [f.path]: t }));
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, search, kind, sort]);

  const filtered = useMemo(() => {
    let list = files || [];
    if (kind !== 'all') list = list.filter((f) => f.kind === kind);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (sort === 'date') return b.mtime - a.mtime;
      if (sort === 'size') return b.size - a.size;
      return a.name.localeCompare(b.name);
    });
  }, [files, kind, search, sort]);

  const totalSize = (files || []).reduce((s, f) => s + f.size, 0);

  async function zipSelected() {
    if (!selected.size) return;
    try {
      await api.library.zip([...selected]);
      setZipping({ phase: 'starting' });
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function doDelete() {
    try {
      await api.library.delete([...selected]);
      toast.success(`Deleted ${selected.size} file(s)`);
      setSelected(new Set());
      scan();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConfirmDelete(false);
    }
  }

  async function reveal(p) {
    try {
      await api.reveal(p);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function copyPath(p) {
    try {
      await navigator.clipboard.writeText(p);
      toast.success('Path copied');
    } catch {
      toast.error('Clipboard unavailable');
    }
  }

  function toggleSelect(p) {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setSelected(next);
  }

  if (files === null) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-sm text-t3">
        <Spinner /> Scanning download folder…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <p className="overline">Manage</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Local Library</h1>
          <p className="mt-1 text-sm text-t2">
            Live scan of <span className="text-t2" title={baseDir}>{baseDir}</span> — {files.length} file(s), {formatBytes(totalSize)}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={scan}>
          <RefreshCcw style={{ width: 14, height: 14 }} /> Refresh
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-t3" style={{ width: 14, height: 14 }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files…" className="w-64 pl-9" aria-label="Search files" />
        </div>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-32" aria-label="Filter by type">
          <option value="all">All types</option>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
          <option value="image">Image</option>
          <option value="archive">Archive</option>
          <option value="other">Other</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-36" aria-label="Sort order">
          <option value="date">Newest first</option>
          <option value="size">Largest first</option>
          <option value="name">Name A–Z</option>
        </Select>
        <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="View mode">
          <button
            onClick={() => setView('grid')}
            className={`px-2.5 py-1.5 transition-colors ${view === 'grid' ? 'bg-accent-soft text-accent-text' : 'text-t3 hover:bg-surface-2 hover:text-t1'}`}
            title="Grid view"
            aria-pressed={view === 'grid'}
          >
            <LayoutGrid style={{ width: 15, height: 15 }} />
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-2.5 py-1.5 transition-colors ${view === 'list' ? 'bg-accent-soft text-accent-text' : 'text-t3 hover:bg-surface-2 hover:text-t1'}`}
            title="List view"
            aria-pressed={view === 'list'}
          >
            <List style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <span className="ml-auto text-xs tabular-nums text-t3">{selected.size} selected</span>
        <Button size="sm" variant="secondary" onClick={zipSelected} disabled={!selected.size || !!zipping}>
          <Archive style={{ width: 14, height: 14 }} />
          {zipping ? `Zipping ${zipping.count ?? 0}/${zipping.total ?? '…'}` : 'Export ZIP'}
        </Button>
        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)} disabled={!selected.size}>
          <Trash2 style={{ width: 14, height: 14 }} /> Delete
        </Button>
      </div>

      {missing && missing.missing.length > 0 && (
        <Card className="border-warn/25 p-3.5" style={{ background: 'color-mix(in srgb, var(--mv-warn) 4%, var(--mv-surface))' }}>
          <div className="flex items-center gap-2 text-[13px] text-warn">
            <AlertTriangle style={{ width: 15, height: 15 }} className="shrink-0" />
            <span className="min-w-0 truncate">
              {missing.missing.length} record(s) point to files that no longer exist: {missing.missing.map((m) => m.title || m.resultPath).join(', ').slice(0, 160)}
            </span>
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={LibraryIcon} title="No files here" hint="Downloads land in the download folder and appear in this library automatically." />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          {filtered.slice(0, 200).map((f) => (
            <div
              key={f.path}
              className={`card card-hover group relative cursor-pointer overflow-hidden rounded-xl p-0 ${selected.has(f.path) ? 'border-accent/60' : ''}`}
              onClick={() => toggleSelect(f.path)}
              role="button"
              aria-pressed={selected.has(f.path)}
            >
              <div className="flex h-28 items-center justify-center overflow-hidden bg-bg-elev">
                {f.kind === 'image' && thumbs[f.path] ? (
                  <img src={thumbs[f.path]} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                ) : (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-t3">{f.kind}</span>
                )}
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-medium text-t1" title={f.path}>
                  {f.name}
                </p>
                <p className="mt-0.5 text-[10px] tabular-nums text-t3">
                  {formatBytes(f.size)} · {formatDate(f.mtime)}
                </p>
              </div>
              {selected.has(f.path) && (
                <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-md bg-accent text-white shadow" aria-hidden>
                  <Check style={{ width: 12, height: 12 }} />
                </span>
              )}
              <div className="absolute left-2 top-2 hidden gap-1 group-hover:flex" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => reveal(f.path)}
                  className="rounded-md border border-line bg-surface p-1.5 text-t2 transition-colors hover:text-t1"
                  title="Show in folder"
                  aria-label="Show in folder"
                >
                  <FolderOpen style={{ width: 12, height: 12 }} />
                </button>
                <button
                  onClick={() => copyPath(f.path)}
                  className="rounded-md border border-line bg-surface p-1.5 text-t2 transition-colors hover:text-t1"
                  title="Copy path"
                  aria-label="Copy path"
                >
                  <Copy style={{ width: 12, height: 12 }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-t3">
              <tr>
                <th className="w-8 px-4 py-3" />
                <th className="px-2 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Size</th>
                <th className="px-3 py-3 font-medium">Modified</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((f) => (
                <tr
                  key={f.path}
                  className={`cursor-pointer border-t border-line transition-colors hover:bg-surface-2/40 ${selected.has(f.path) ? 'bg-accent-soft/40' : ''}`}
                  onClick={() => toggleSelect(f.path)}
                >
                  <td className="px-4 py-2.5">{selected.has(f.path) ? '☑' : '☐'}</td>
                  <td className="max-w-96 truncate px-2 py-2.5 text-[13px] text-t1">{f.name}</td>
                  <td className="px-3 py-2.5 text-xs text-t3">{f.kind}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-t2">{formatBytes(f.size)}</td>
                  <td className="px-3 py-2.5 text-xs text-t3">{formatDate(f.mtime)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => reveal(f.path)} title="Show in folder" aria-label="Show in folder">
                        <FolderOpen style={{ width: 14, height: 14 }} />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => copyPath(f.path)} title="Copy path" aria-label="Copy path">
                        <Copy style={{ width: 14, height: 14 }} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <AnimatedDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${selected.size} file(s)?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doDelete}>
              Delete files
            </Button>
          </>
        }
      >
        <p>
          This permanently removes the actual files from <span className="font-mono text-xs">{baseDir}</span>. This cannot be undone.
        </p>
      </AnimatedDialog>
    </div>
  );
}

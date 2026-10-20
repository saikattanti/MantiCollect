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
  Check,
  Video,
  Music,
  Image as ImageIcon,
  FileText,
  Package,
  FolderPlus,
  FileSpreadsheet,
  FileJson,
  Cpu,
  Layers,
  Info,
  Play,
  CloudUpload,
  Cloud,
  Server,
  HardDrive
} from 'lucide-react';
import { api, onEvent } from '@/lib/ipc.js';
import { formatBytes, formatDate } from '@/lib/format.js';
import { Button, Card, Input, Label, Select, EmptyState, Spinner, AnimatedDialog, Badge, Progress } from '@/components/ui.jsx';

const CATEGORIES = [
  { id: 'all', label: 'All Files', icon: Layers },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'image', label: 'Images', icon: ImageIcon },
  { id: 'document', label: 'Documents', icon: FileText },
  { id: 'archive', label: 'Archives', icon: Package }
];

export default function LibraryPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [baseDir, setBaseDir] = useState('');
  const [view, setView] = useState('grid');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [sort, setSort] = useState('date');
  const [selected, setSelected] = useState(() => new Set());
  const [thumbs, setThumbs] = useState({});
  const [collections, setCollections] = useState([]);

  // Async task trackers
  const [zipping, setZipping] = useState(null);
  const [exportProgress, setExportProgress] = useState(null);

  // Modals
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [inspectItem, setInspectItem] = useState(null);
  const [probingItem, setProbingItem] = useState(false);
  const [addToColOpen, setAddToColOpen] = useState(false);
  const [targetColId, setTargetColId] = useState('');

  // Conversion Modal
  const [convertItem, setConvertItem] = useState(null);
  const [presets, setPresets] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState('mp4_universal');
  const [convertingJob, setConvertingJob] = useState(null);

  // Phase 8: Remote Upload Modal
  const [remoteUploadOpen, setRemoteUploadOpen] = useState(false);
  const [storageConnections, setStorageConnections] = useState([]);
  const [selectedStorageConnId, setSelectedStorageConnId] = useState('');
  const [remoteSubdir, setRemoteSubdir] = useState('');
  const [uploadTasks, setUploadTasks] = useState([]);
  const [liveUploads, setLiveUploads] = useState({});
  const [startingUpload, setStartingUpload] = useState(false);

  useEffect(() => {
    loadLibrary();
    loadCollections();
    loadPresets();

    const unsubZip = onEvent('zip:progress', (p) => {
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

    const unsubExport = onEvent('export:progress', (p) => {
      setExportProgress(p);
    });

    const unsubConversionProg = onEvent('conversion:progress', (p) => {
      if (convertingJob && convertingJob.id === p.id) {
        setConvertingJob((prev) => ({ ...prev, progress: p.progress }));
      }
    });

    const unsubConversionUpd = onEvent('conversion:updated', (tasks) => {
      if (convertingJob) {
        const found = tasks.find((t) => t.id === convertingJob.id);
        if (found) {
          setConvertingJob(found);
          if (found.status === 'completed') {
            toast.success(`Converted ${found.dest_path.split('\\').pop()}`);
            loadLibrary();
          } else if (found.status === 'failed') {
            toast.error(`Conversion failed: ${found.error}`);
          }
        }
      }
    });

    const unsubUploadProg = onEvent('upload:progress', (p) => {
      setLiveUploads((prev) => ({
        ...prev,
        [p.id]: { ...(prev[p.id] || {}), ...p }
      }));
    });

    const unsubUploadUpd = onEvent('upload:updated', (tasks) => {
      setUploadTasks(tasks || []);
    });

    return () => {
      unsubZip();
      unsubExport();
      unsubConversionProg();
      unsubConversionUpd();
      unsubUploadProg();
      unsubUploadUpd();
    };
  }, []);

  async function loadLibrary() {
    setLoading(true);
    try {
      const res = await api.library.query({
        search,
        category,
        collectionId: collectionFilter !== 'all' ? collectionFilter : null,
        sort,
        order: sort === 'name' ? 'asc' : 'desc',
        limit: 200
      });
      setData(res);
      setBaseDir(res.baseDir);
    } catch (err) {
      toast.error(`Library query error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadCollections() {
    try {
      const list = await api.collections.list();
      setCollections(list || []);
    } catch {}
  }

  async function loadPresets() {
    try {
      const list = await api.converter.presets();
      setPresets(list || []);
      if (list && list.length > 0) setSelectedPreset(list[0].id);
    } catch {}
  }

  useEffect(() => {
    loadLibrary();
  }, [search, category, collectionFilter, sort]);

  // Lazy image thumbnails
  useEffect(() => {
    const items = data?.items || [];
    const visibleImages = items.slice(0, 40).filter((f) => f.kind === 'image' && f.existsOnDisk && !thumbs[f.path]);
    if (!visibleImages.length) return;
    let cancelled = false;
    (async () => {
      for (const f of visibleImages.slice(0, 10)) {
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
  }, [data]);

  function toggleSelect(p) {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setSelected(next);
  }

  function selectAll() {
    if (!data?.items) return;
    if (selected.size === data.items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.items.map((i) => i.path)));
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

  // --- Batch Actions ---

  async function handleBatchExportFiles() {
    if (!selected.size) return;
    try {
      const res = await api.export.selectDir();
      if (!res.path) return;
      toast.info(`Exporting ${selected.size} file(s) to ${res.path}…`);
      const exportRes = await api.export.files([...selected], res.path);
      setExportProgress(null);
      if (exportRes.failed > 0) {
        toast.warning(`Export complete: ${exportRes.exported} copied, ${exportRes.failed} failed.`);
      } else {
        toast.success(`Successfully exported ${exportRes.exported} file(s) to ${res.path}`);
      }
    } catch (err) {
      setExportProgress(null);
      toast.error(`Export failed: ${err.message}`);
    }
  }

  async function handleExportJson() {
    if (!selected.size || !data?.items) return;
    try {
      const selectedItems = data.items.filter((i) => selected.has(i.path));
      const res = await api.export.selectFile({
        defaultName: `manticollect-metadata-${Date.now()}.json`,
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });
      if (!res.path) return;
      await api.export.json(selectedItems, res.path);
      toast.success(`Metadata exported as JSON: ${res.path}`);
    } catch (err) {
      toast.error(`Export failed: ${err.message}`);
    }
  }

  async function handleExportCsv() {
    if (!selected.size || !data?.items) return;
    try {
      const selectedItems = data.items.filter((i) => selected.has(i.path));
      const res = await api.export.selectFile({
        defaultName: `manticollect-metadata-${Date.now()}.csv`,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
      });
      if (!res.path) return;
      await api.export.csv(selectedItems, res.path);
      toast.success(`Metadata exported as CSV: ${res.path}`);
    } catch (err) {
      toast.error(`Export failed: ${err.message}`);
    }
  }

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
      loadLibrary();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConfirmDelete(false);
    }
  }

  async function handleAddToCollection() {
    if (!targetColId || !selected.size) return;
    try {
      const res = await api.collections.addItems(targetColId, [...selected]);
      toast.success(`Added ${res.added} item(s) to collection`);
      setAddToColOpen(false);
      loadLibrary();
      loadCollections();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // --- Inspect Metadata ---

  async function openInspect(item) {
    setInspectItem(item);
  }

  async function handleReProbe() {
    if (!inspectItem) return;
    setProbingItem(true);
    try {
      const fresh = await api.library.probeFile(inspectItem.path);
      setInspectItem((prev) => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          duration: fresh.duration,
          width: fresh.width,
          height: fresh.height,
          resolution: fresh.width && fresh.height ? `${fresh.width}x${fresh.height}` : null,
          videoCodec: fresh.video_codec,
          audioCodec: fresh.audio_codec,
          bitrate: fresh.bitrate,
          formatName: fresh.format_name,
          channels: fresh.channels
        }
      }));
      toast.success('Media metadata refreshed via FFprobe');
      loadLibrary();
    } catch (err) {
      toast.error(`FFprobe inspection error: ${err.message}`);
    } finally {
      setProbingItem(false);
    }
  }

  // --- Safe FFmpeg Conversion ---

  function openConvert(item) {
    setConvertItem(item);
    setConvertingJob(null);
    if (item.kind === 'video') setSelectedPreset('mp4_universal');
    else if (item.kind === 'audio') setSelectedPreset('audio_mp3');
    else setSelectedPreset('mp4_universal');
  }

  async function handleStartConvert() {
    if (!convertItem || !selectedPreset) return;
    try {
      const task = await api.converter.start({
        sourcePath: convertItem.path,
        presetId: selectedPreset,
        durationSeconds: convertItem.metadata?.duration || null
      });
      setConvertingJob(task);
      toast.info('Conversion queued in background');
    } catch (err) {
      toast.error(`Could not start conversion: ${err.message}`);
    }
  }

  async function handleCancelConvert() {
    if (!convertingJob) return;
    try {
      await api.converter.cancel(convertingJob.id);
      toast.info('Conversion cancelled');
      setConvertingJob(null);
    } catch (err) {
      toast.error(err.message);
    }
  }

  // --- Phase 8: Remote Upload Actions ---

  async function openRemoteUploadModal() {
    try {
      const list = await api.storage.connections.list();
      setStorageConnections(list || []);
      if (list && list.length > 0 && !selectedStorageConnId) {
        setSelectedStorageConnId(list[0].id);
      }
      setRemoteUploadOpen(true);
    } catch (err) {
      toast.error(`Could not load storage connections: ${err.message}`);
    }
  }

  async function handleStartRemoteUpload() {
    if (!selectedStorageConnId) {
      toast.error('Please select a storage destination');
      return;
    }
    const paths = Array.from(selected);
    if (!paths.length) return;

    setStartingUpload(true);
    try {
      await api.storage.upload.start({
        connectionId: selectedStorageConnId,
        sourcePaths: paths,
        remoteSubdir
      });
      toast.success(`Queued ${paths.length} file(s) for remote upload`);
    } catch (err) {
      toast.error(`Upload error: ${err.message}`);
    } finally {
      setStartingUpload(false);
    }
  }

  async function handleCancelUpload(id) {
    try {
      await api.storage.upload.cancel(id);
      toast.info('Upload cancelled');
    } catch (err) {
      toast.error(err.message);
    }
  }

  const items = data?.items || [];
  const counts = data?.counts || { all: 0 };
  const totalBytes = data?.totalBytes || 0;

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="overline">Library & Storage</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Media Library</h1>
          <p className="mt-1 text-sm text-t2">
            Organized local storage in <span className="font-mono text-xs text-t2" title={baseDir}>{baseDir}</span> — {counts.all || items.length} item(s), {formatBytes(totalBytes)}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={loadLibrary} disabled={loading}>
          <RefreshCcw style={{ width: 14, height: 14 }} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </header>

      {/* Category Pills Bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line pb-3">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const count = counts[cat.id] ?? 0;
          const isActive = category === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? 'bg-accent-soft text-accent-text border border-accent/40 shadow-xs'
                  : 'text-t2 hover:bg-surface-2/60 hover:text-t1 border border-transparent'
              }`}
            >
              <Icon style={{ width: 13, height: 13 }} />
              <span>{cat.label}</span>
              <span className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums ${isActive ? 'bg-accent/20 text-accent-text' : 'bg-surface-2 text-t3'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Controls Bar: Search, Collection Filter, Sort, View Toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-t3" style={{ width: 14, height: 14 }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, name, format…"
            className="w-64 pl-9"
          />
        </div>

        {/* Collection Filter */}
        <Select
          value={collectionFilter}
          onChange={(e) => setCollectionFilter(e.target.value)}
          className="w-40"
          aria-label="Filter by collection"
        >
          <option value="all">All Collections</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.item_count || 0})
            </option>
          ))}
        </Select>

        {/* Sort Order */}
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-36" aria-label="Sort order">
          <option value="date">Newest first</option>
          <option value="size">Largest first</option>
          <option value="name">Name A–Z</option>
        </Select>

        {/* View Mode Toggle */}
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

        <button
          onClick={selectAll}
          className="text-xs text-accent-text hover:underline font-medium ml-1"
        >
          {selected.size === items.length && items.length > 0 ? 'Deselect all' : 'Select all'}
        </button>

        <span className="ml-auto text-xs tabular-nums text-t3">{selected.size} selected</span>
      </div>

      {/* Floating Multi-Select Batch Action Bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft/30 p-2.5 shadow-md">
          <span className="text-xs font-semibold text-accent-text px-2">
            {selected.size} item(s) selected:
          </span>

          <Button size="sm" variant="secondary" onClick={handleBatchExportFiles}>
            <FolderOpen style={{ width: 13, height: 13 }} /> Export Files to Folder
          </Button>

          <Button size="sm" variant="secondary" onClick={handleExportJson}>
            <FileJson style={{ width: 13, height: 13 }} /> Export JSON
          </Button>

          <Button size="sm" variant="secondary" onClick={handleExportCsv}>
            <FileSpreadsheet style={{ width: 13, height: 13 }} /> Export CSV
          </Button>

          <Button size="sm" variant="secondary" onClick={() => setAddToColOpen(true)}>
            <FolderPlus style={{ width: 13, height: 13 }} /> Add to Collection
          </Button>

          <Button size="sm" variant="secondary" onClick={openRemoteUploadModal}>
            <CloudUpload style={{ width: 13, height: 13 }} /> Upload to Remote
          </Button>

          <Button size="sm" variant="secondary" onClick={zipSelected} disabled={!!zipping}>
            <Archive style={{ width: 13, height: 13 }} />
            {zipping ? `Zipping…` : 'Export ZIP'}
          </Button>

          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 style={{ width: 13, height: 13 }} /> Delete
          </Button>
        </div>
      )}

      {/* Export Progress Notification Card */}
      {exportProgress && (
        <Card className="border-accent/40 p-3 bg-accent-soft/20">
          <div className="flex items-center justify-between text-xs text-t1 font-medium">
            <span>
              Exporting: {exportProgress.exported || 0} of {exportProgress.total || 0} files ({exportProgress.percent || 0}%)
            </span>
            <span className="font-mono text-t3 text-[11px] truncate max-w-xs">{exportProgress.currentFile}</span>
          </div>
          <Progress value={exportProgress.percent || 0} className="mt-2 h-1.5" />
        </Card>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-20 text-sm text-t3">
          <Spinner /> Loading media library…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={LibraryIcon}
          title="No files match your query"
          hint="Downloads land in the download folder and appear here automatically."
        />
      ) : view === 'grid' ? (
        /* GRID VIEW */
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {items.map((f) => {
            const isSel = selected.has(f.path);
            const isVideoOrAudio = f.kind === 'video' || f.kind === 'audio';
            return (
              <div
                key={f.path}
                className={`card card-hover group relative cursor-pointer overflow-hidden rounded-xl p-0 transition-all ${
                  isSel ? 'border-accent ring-2 ring-accent/30' : ''
                } ${!f.existsOnDisk ? 'opacity-70 border-err/40' : ''}`}
                onClick={() => toggleSelect(f.path)}
                role="button"
                aria-pressed={isSel}
              >
                {/* Media Preview / Thumbnail Area */}
                <div className="flex h-32 items-center justify-center overflow-hidden bg-bg-elev relative">
                  {f.kind === 'image' && thumbs[f.path] ? (
                    <img
                      src={thumbs[f.path]}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : f.kind === 'video' ? (
                    <Video className="text-accent-text/60" style={{ width: 28, height: 28 }} />
                  ) : f.kind === 'audio' ? (
                    <Music className="text-accent-text/60" style={{ width: 28, height: 28 }} />
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-t3">{f.kind}</span>
                  )}

                  {/* Technical Metadata Badge (Resolution / Duration) */}
                  {(f.metadata?.resolution || f.metadata?.duration) && (
                    <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[9px] tabular-nums text-white backdrop-blur-xs font-mono">
                      {f.metadata.resolution && <span>{f.metadata.resolution}</span>}
                      {f.metadata.duration && <span>{Math.round(f.metadata.duration)}s</span>}
                    </div>
                  )}

                  {/* Missing File Indicator */}
                  {!f.existsOnDisk && (
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-err/90 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                      <AlertTriangle style={{ width: 10, height: 10 }} /> File Missing
                    </div>
                  )}
                </div>

                {/* Details Body */}
                <div className="p-3">
                  <p className="truncate text-xs font-semibold text-t1" title={f.title || f.name}>
                    {f.title || f.name}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] font-mono text-t3" title={f.path}>
                    {f.name}
                  </p>

                  <div className="mt-2 flex items-center justify-between text-[10px] tabular-nums text-t3">
                    <span>{f.size ? formatBytes(f.size) : '—'}</span>
                    <span>{formatDate(f.mtime)}</span>
                  </div>

                  {/* Collection Tags */}
                  {f.collections && f.collections.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {f.collections.map((col) => (
                        <span
                          key={col.id}
                          className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                          style={{ backgroundColor: `${col.color}20`, color: col.color || '#00e5ff' }}
                        >
                          {col.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selection Checkmark */}
                {isSel && (
                  <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-md bg-accent text-white shadow" aria-hidden>
                    <Check style={{ width: 12, height: 12 }} />
                  </span>
                )}

                {/* Hover Action Overlay */}
                <div
                  className="absolute left-2 top-2 hidden gap-1 group-hover:flex"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => openInspect(f)}
                    className="rounded-md border border-line bg-surface/90 p-1.5 text-t2 transition-colors hover:text-accent-text"
                    title="Inspect technical metadata"
                  >
                    <Info style={{ width: 12, height: 12 }} />
                  </button>

                  {isVideoOrAudio && f.existsOnDisk && (
                    <button
                      onClick={() => openConvert(f)}
                      className="rounded-md border border-line bg-surface/90 p-1.5 text-t2 transition-colors hover:text-accent-text"
                      title="Convert format"
                    >
                      <Cpu style={{ width: 12, height: 12 }} />
                    </button>
                  )}

                  {f.existsOnDisk && (
                    <button
                      onClick={() => reveal(f.path)}
                      className="rounded-md border border-line bg-surface/90 p-1.5 text-t2 transition-colors hover:text-t1"
                      title="Show in folder"
                    >
                      <FolderOpen style={{ width: 12, height: 12 }} />
                    </button>
                  )}

                  <button
                    onClick={() => copyPath(f.path)}
                    className="rounded-md border border-line bg-surface/90 p-1.5 text-t2 transition-colors hover:text-t1"
                    title="Copy path"
                  >
                    <Copy style={{ width: 12, height: 12 }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* LIST VIEW */
        <Card>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-t3 border-b border-line">
              <tr>
                <th className="w-8 px-4 py-3" />
                <th className="px-2 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Technical Specs</th>
                <th className="px-3 py-3 font-medium">Size</th>
                <th className="px-3 py-3 font-medium">Date</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => {
                const isSel = selected.has(f.path);
                const isVideoOrAudio = f.kind === 'video' || f.kind === 'audio';
                return (
                  <tr
                    key={f.path}
                    className={`cursor-pointer border-t border-line transition-colors hover:bg-surface-2/40 ${
                      isSel ? 'bg-accent-soft/40' : ''
                    } ${!f.existsOnDisk ? 'opacity-70 bg-err/5' : ''}`}
                    onClick={() => toggleSelect(f.path)}
                  >
                    <td className="px-4 py-2.5">{isSel ? '☑' : '☐'}</td>
                    <td className="max-w-md truncate px-2 py-2.5 text-[13px] text-t1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{f.title || f.name}</span>
                        {!f.existsOnDisk && (
                          <Badge variant="outline" className="border-err/40 text-err text-[10px]">
                            Missing
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-t3 font-mono truncate">{f.name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-t3 uppercase font-medium">{f.kind}</td>
                    <td className="px-3 py-2.5 text-xs font-mono text-t2 tabular-nums">
                      {f.metadata?.resolution || f.metadata?.duration ? (
                        <span>
                          {f.metadata.resolution ? `${f.metadata.resolution} ` : ''}
                          {f.metadata.videoCodec ? `(${f.metadata.videoCodec}) ` : ''}
                          {f.metadata.duration ? `· ${Math.round(f.metadata.duration)}s` : ''}
                        </span>
                      ) : (
                        <span className="text-t3">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-t2">
                      {f.size ? formatBytes(f.size) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-t3 tabular-nums">{formatDate(f.mtime)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openInspect(f)}
                          title="Technical metadata"
                        >
                          <Info style={{ width: 14, height: 14 }} />
                        </Button>

                        {isVideoOrAudio && f.existsOnDisk && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openConvert(f)}
                            title="Convert format"
                          >
                            <Cpu style={{ width: 14, height: 14 }} />
                          </Button>
                        )}

                        {f.existsOnDisk && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => reveal(f.path)}
                            title="Show in folder"
                          >
                            <FolderOpen style={{ width: 14, height: 14 }} />
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyPath(f.path)}
                          title="Copy path"
                        >
                          <Copy style={{ width: 14, height: 14 }} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Technical Metadata Inspection Modal */}
      <AnimatedDialog
        open={Boolean(inspectItem)}
        onClose={() => setInspectItem(null)}
        title="Technical Media Metadata"
        width={520}
        footer={
          <div className="flex items-center justify-between w-full">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReProbe}
              disabled={probingItem || !inspectItem?.existsOnDisk}
            >
              <Cpu style={{ width: 13, height: 13 }} />
              {probingItem ? 'Probing with FFprobe…' : 'Probe File with FFprobe'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setInspectItem(null)}>
              Close
            </Button>
          </div>
        }
      >
        {inspectItem && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-t3 uppercase tracking-wider">File Details</p>
              <p className="text-sm font-semibold text-t1 mt-1 truncate">{inspectItem.name}</p>
              <p className="text-xs text-t3 font-mono break-all mt-0.5">{inspectItem.path}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                <span className="text-t3">Category</span>
                <p className="font-semibold text-t1 uppercase mt-0.5">{inspectItem.kind}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                <span className="text-t3">File Size</span>
                <p className="font-semibold text-t1 mt-0.5">{inspectItem.size ? formatBytes(inspectItem.size) : 'Unknown'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                <span className="text-t3">Resolution</span>
                <p className="font-semibold text-t1 mt-0.5">{inspectItem.metadata?.resolution || 'Unknown'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                <span className="text-t3">Duration</span>
                <p className="font-semibold text-t1 mt-0.5">{inspectItem.metadata?.duration ? `${Math.round(inspectItem.metadata.duration * 10) / 10} seconds` : 'Unknown'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                <span className="text-t3">Video Codec</span>
                <p className="font-semibold text-t1 mt-0.5">{inspectItem.metadata?.videoCodec || 'Unknown'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                <span className="text-t3">Audio Codec</span>
                <p className="font-semibold text-t1 mt-0.5">{inspectItem.metadata?.audioCodec || 'Unknown'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                <span className="text-t3">Bitrate</span>
                <p className="font-semibold text-t1 mt-0.5">{inspectItem.metadata?.bitrate ? `${Math.round(inspectItem.metadata.bitrate / 1000)} kbps` : 'Unknown'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                <span className="text-t3">Audio Channels</span>
                <p className="font-semibold text-t1 mt-0.5">{inspectItem.metadata?.channels ? `${inspectItem.metadata.channels} channels` : 'Unknown'}</p>
              </div>
            </div>

            <p className="text-[11px] text-t3 border-l-2 border-accent pl-2 py-0.5">
              Metadata is extracted via asynchronous FFprobe inspection and cached persistently. Unknown fields remain unknown rather than fabricated.
            </p>
          </div>
        )}
      </AnimatedDialog>

      {/* Safe FFmpeg Conversion Modal */}
      <AnimatedDialog
        open={Boolean(convertItem)}
        onClose={() => setConvertItem(null)}
        title="FFmpeg Conversion"
        width={500}
        footer={
          convertingJob && (convertingJob.status === 'converting' || convertingJob.status === 'waiting') ? (
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-t3">Converting in background…</span>
              <Button variant="danger" size="sm" onClick={handleCancelConvert}>
                Cancel Conversion
              </Button>
            </div>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setConvertItem(null)}>
                Close
              </Button>
              <Button onClick={handleStartConvert} disabled={!convertItem?.existsOnDisk}>
                <Play style={{ width: 13, height: 13 }} /> Start Conversion
              </Button>
            </>
          )
        }
      >
        {convertItem && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-t3 uppercase tracking-wider">Source File</p>
              <p className="text-sm font-semibold text-t1 mt-0.5 truncate">{convertItem.name}</p>
              <p className="text-xs text-t3 font-mono truncate">{convertItem.path}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-t3 uppercase tracking-wider mb-1.5">
                Safe Conversion Preset
              </label>
              <div className="space-y-2">
                {presets.map((p) => {
                  const isSel = selectedPreset === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPreset(p.id)}
                      className={`cursor-pointer rounded-xl border p-3 transition-all ${
                        isSel ? 'border-accent bg-accent-soft/30' : 'border-line hover:border-line-strong bg-surface-2/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-t1">{p.label}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {p.targetExt}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-t3">{p.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {convertingJob && (
              <div className="rounded-xl border border-accent/40 bg-accent-soft/20 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-t1">
                  <span>Status: {convertingJob.status}</span>
                  <span className="tabular-nums">{convertingJob.progress || 0}%</span>
                </div>
                <Progress value={convertingJob.progress || 0} className="h-2" />
                {convertingJob.status === 'completed' && (
                  <p className="text-xs text-accent-text font-medium">
                    ✓ Conversion finished successfully! Output file saved in destination folder.
                  </p>
                )}
                {convertingJob.status === 'failed' && (
                  <p className="text-xs text-err font-medium">
                    ✕ Failed: {convertingJob.error}
                  </p>
                )}
              </div>
            )}

            <p className="text-[11px] text-t3 border-l-2 border-accent pl-2 py-0.5">
              Conversions execute via predefined safe FFmpeg argument allowlists in a sandboxed child process. Original files are never modified or overwritten.
            </p>
          </div>
        )}
      </AnimatedDialog>

      {/* Add To Collection Modal */}
      <AnimatedDialog
        open={addToColOpen}
        onClose={() => setAddToColOpen(false)}
        title="Add Selected to Collection"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddToColOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddToCollection} disabled={!targetColId}>
              Add {selected.size} Item(s)
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-t2">
            Select a target collection for the {selected.size} selected item(s):
          </p>
          {collections.length === 0 ? (
            <p className="text-xs text-warn">
              No collections found. Create a collection first in the Collections page.
            </p>
          ) : (
            <Select
              value={targetColId}
              onChange={(e) => setTargetColId(e.target.value)}
              className="w-full"
            >
              <option value="">Select target collection…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.item_count || 0} items)
                </option>
              ))}
            </Select>
          )}
        </div>
      </AnimatedDialog>

      {/* Phase 8: Remote Upload Dialog */}
      <AnimatedDialog
        open={remoteUploadOpen}
        onClose={() => setRemoteUploadOpen(false)}
        title="Upload Selected Files to Remote Storage"
        width={560}
        footer={
          <div className="flex w-full items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setRemoteUploadOpen(false)}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={handleStartRemoteUpload}
              disabled={startingUpload || storageConnections.length === 0}
            >
              {startingUpload ? <Spinner className="w-3.5 h-3.5" /> : <CloudUpload className="w-3.5 h-3.5" />}
              <span className="ml-1.5">Start Remote Upload</span>
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface-2/30 p-3">
            <p className="text-xs text-t2">
              <span className="font-semibold text-t1">{selected.size} file(s) selected </span>
              for remote transfer.
            </p>
          </div>

          <div>
            <Label>Target Storage Connection</Label>
            {storageConnections.length === 0 ? (
              <div className="rounded-xl border border-dashed border-warn/40 bg-warn/5 p-4 text-center">
                <p className="text-xs text-warn font-medium">No storage connections configured</p>
                <p className="text-[11px] text-t3 mt-1">
                  Configure a WebDAV, SFTP, or Local NAS connection in Settings → Remote Storage first.
                </p>
              </div>
            ) : (
              <Select
                value={selectedStorageConnId}
                onChange={(e) => setSelectedStorageConnId(e.target.value)}
                className="w-full"
              >
                {storageConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.provider_type?.replace('_', ' ')?.toUpperCase()}) — {c.host || c.base_path}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div>
            <Label>Destination Subdirectory (Optional)</Label>
            <Input
              value={remoteSubdir}
              onChange={(e) => setRemoteSubdir(e.target.value)}
              placeholder="e.g. Media/2026 or backups (leave empty for root base directory)"
            />
            <p className="mt-1 text-[11px] text-t3">
              Subfolder path relative to the remote storage base folder. Will be created automatically if missing.
            </p>
          </div>

          {/* Active / Recent Upload Tasks Telemetry */}
          {uploadTasks.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-line">
              <div className="flex items-center justify-between text-xs font-semibold text-t1">
                <span>Active & Recent Uploads</span>
                <button
                  onClick={() => api.storage.upload.clear()}
                  className="text-[11px] text-t3 hover:text-t1 underline font-normal"
                >
                  Clear finished
                </button>
              </div>

              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {uploadTasks.slice(0, 10).map((task) => {
                  const live = liveUploads[task.id] || {};
                  const percent = live.percent ?? (task.bytes_total > 0 ? Math.round((task.bytes_done / task.bytes_total) * 100) : 0);
                  const filename = task.source_path?.split(/[\\/]/).pop();
                  const isDone = task.status === 'completed';
                  const isFailed = task.status === 'failed';
                  const isCancelled = task.status === 'cancelled';
                  const isUploading = task.status === 'uploading';

                  return (
                    <div
                      key={task.id}
                      className="rounded-lg border border-line bg-surface-2/40 p-2.5 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-t1 truncate max-w-[280px]" title={filename}>
                          {filename}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${
                              isDone
                                ? 'border-ok/40 text-ok'
                                : isFailed
                                ? 'border-err/40 text-err'
                                : isCancelled
                                ? 'border-line text-t3'
                                : 'border-accent/40 text-accent-text'
                            }`}
                          >
                            {task.status}
                          </Badge>
                          {isUploading && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-[10px]"
                              onClick={() => handleCancelUpload(task.id)}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>

                      <Progress value={percent} className="h-1.5" />

                      <div className="flex items-center justify-between text-[11px] text-t3">
                        <span>
                          {formatBytes(live.bytesDone ?? task.bytes_done)} / {formatBytes(live.bytesTotal ?? task.bytes_total)}
                        </span>
                        {live.speed > 0 && <span>{formatBytes(live.speed)}/s</span>}
                        <span>{percent}%</span>
                      </div>

                      {task.error_message && (
                        <p className="text-[11px] text-err truncate" title={task.error_message}>
                          Error: {task.error_message}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </AnimatedDialog>

      {/* Delete Confirmation Modal */}
      <AnimatedDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Permanently delete ${selected.size} file(s)?`}
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
        <div className="space-y-2">
          <p>
            This permanently removes the actual files from your disk in <span className="font-mono text-xs">{baseDir}</span>.
          </p>
          <p className="text-xs text-err">
            Warning: This action cannot be undone.
          </p>
        </div>
      </AnimatedDialog>
    </div>
  );
}

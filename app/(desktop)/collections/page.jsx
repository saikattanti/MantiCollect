'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import { toast } from 'sonner';
import {
  Folder,
  Plus,
  FolderOpen,
  Trash2,
  Edit2,
  Search,
  ArrowLeft,
  FileText,
  Video,
  Music,
  Image as ImageIcon,
  Archive,
  DownloadCloud,
  Check,
  ExternalLink
} from 'lucide-react';
import { api } from '@/lib/ipc.js';
import { formatBytes, formatDate } from '@/lib/format.js';
import { Button, Card, Input, Textarea, EmptyState, Spinner, AnimatedDialog, Badge } from '@/components/ui.jsx';
import ProbeView from '@/components/ProbeView.jsx';

const COLLECTION_COLORS = [
  '#00e5ff', // Cyan
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444'  // Rose
];

export default function CollectionsPage() {
  const [activeTab, setActiveTab] = useState('collections'); // 'collections' | 'downloader'
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCol, setSelectedCol] = useState(null); // active collection detail view
  const [colItems, setColItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedItems, setSelectedItems] = useState(() => new Set());

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState(COLLECTION_COLORS[0]);

  const [editCol, setEditCol] = useState(null);
  const [editName, setEditName] = useState('');

  const [deleteCol, setDeleteCol] = useState(null);

  useEffect(() => {
    loadCollections();
  }, []);

  async function loadCollections() {
    setLoading(true);
    try {
      const list = await api.collections.list();
      setCollections(list || []);
    } catch (err) {
      toast.error(`Failed to load collections: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function openCollection(col) {
    setSelectedCol(col);
    setSelectedItems(new Set());
    setSearch('');
    setItemsLoading(true);
    try {
      // Query library items belonging to this collection
      const res = await api.library.query({ collectionId: col.id, limit: 200 });
      setColItems(res.items || []);
    } catch (err) {
      toast.error(`Failed to load collection items: ${err.message}`);
      setColItems([]);
    } finally {
      setItemsLoading(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) {
      toast.error('Collection name is required');
      return;
    }
    try {
      await api.collections.create({
        name: newName.trim(),
        description: newDesc.trim(),
        color: newColor
      });
      toast.success(`Created collection "${newName.trim()}"`);
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      loadCollections();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleRename() {
    if (!editCol || !editName.trim()) return;
    try {
      await api.collections.rename(editCol.id, editName.trim());
      toast.success('Collection renamed');
      setEditCol(null);
      if (selectedCol?.id === editCol.id) {
        setSelectedCol((prev) => ({ ...prev, name: editName.trim() }));
      }
      loadCollections();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDelete() {
    if (!deleteCol) return;
    try {
      await api.collections.delete(deleteCol.id);
      toast.success(`Deleted collection "${deleteCol.name}"`);
      setDeleteCol(null);
      if (selectedCol?.id === deleteCol.id) {
        setSelectedCol(null);
      }
      loadCollections();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleRemoveSelected() {
    if (!selectedCol || !selectedItems.size) return;
    try {
      await api.collections.removeItems(selectedCol.id, [...selectedItems]);
      toast.success(`Removed ${selectedItems.size} item(s) from "${selectedCol.name}"`);
      setSelectedItems(new Set());
      openCollection(selectedCol);
      loadCollections();
    } catch (err) {
      toast.error(err.message);
    }
  }

  function toggleSelectItem(path) {
    const next = new Set(selectedItems);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelectedItems(next);
  }

  const filteredItems = useMemo(() => {
    if (!search.trim()) return colItems;
    const q = search.toLowerCase();
    return colItems.filter(
      (item) => item.name?.toLowerCase().includes(q) || item.title?.toLowerCase().includes(q)
    );
  }, [colItems, search]);

  return (
    <div className="space-y-5">
      {/* Top Header & Mode Navigation */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="overline">Organize & Ingest</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Media Collections</h1>
          <p className="mt-1 max-w-2xl text-sm text-t2">
            Organize completed downloads into custom collections without duplicating files on disk, or ingest full playlists and albums.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex overflow-hidden rounded-lg border border-line bg-surface-2/40 p-1">
          <button
            onClick={() => {
              setActiveTab('collections');
              setSelectedCol(null);
            }}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'collections' ? 'bg-accent-soft text-accent-text shadow-xs' : 'text-t2 hover:text-t1'
            }`}
          >
            <Folder style={{ width: 14, height: 14 }} />
            My Collections ({collections.length})
          </button>
          <button
            onClick={() => setActiveTab('downloader')}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'downloader' ? 'bg-accent-soft text-accent-text shadow-xs' : 'text-t2 hover:text-t1'
            }`}
          >
            <DownloadCloud style={{ width: 14, height: 14 }} />
            Download Playlist / Album
          </button>
        </div>
      </header>

      {/* Mode 1: Download Playlist/Album (ProbeView) */}
      {activeTab === 'downloader' && (
        <Suspense
          fallback={
            <div className="flex items-center gap-3 py-10 text-sm text-t3">
              <Spinner /> Loading…
            </div>
          }
        >
          <ProbeView defaultCollectionMode />
        </Suspense>
      )}

      {/* Mode 2: User Collections */}
      {activeTab === 'collections' && (
        <>
          {/* View A: Collection Detail View */}
          {selectedCol ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/30 p-4">
                <div className="flex items-center gap-3">
                  <Button variant="secondary" size="sm" onClick={() => setSelectedCol(null)}>
                    <ArrowLeft style={{ width: 14, height: 14 }} /> Back to Collections
                  </Button>
                  <div
                    className="h-4 w-4 rounded-full border border-white/20"
                    style={{ backgroundColor: selectedCol.color || '#00e5ff' }}
                  />
                  <div>
                    <h2 className="text-base font-semibold text-t1">{selectedCol.name}</h2>
                    {selectedCol.description && (
                      <p className="text-xs text-t3">{selectedCol.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums text-t3">
                    {colItems.length} item(s) · {selectedItems.size} selected
                  </span>
                  {selectedItems.size > 0 && (
                    <Button variant="danger" size="sm" onClick={handleRemoveSelected}>
                      <Trash2 style={{ width: 14, height: 14 }} /> Remove from Collection
                    </Button>
                  )}
                </div>
              </div>

              {/* Search Bar within collection */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-t3"
                    style={{ width: 14, height: 14 }}
                  />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search inside this collection…"
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Items List */}
              {itemsLoading ? (
                <div className="flex items-center justify-center gap-3 py-16 text-sm text-t3">
                  <Spinner /> Loading collection items…
                </div>
              ) : filteredItems.length === 0 ? (
                <EmptyState
                  icon={FolderOpen}
                  title="Collection is empty"
                  hint="Add items to this collection from the Library page using the multi-select batch bar."
                />
              ) : (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  {filteredItems.map((item) => {
                    const isSel = selectedItems.has(item.path);
                    return (
                      <Card
                        key={item.path}
                        hover
                        onClick={() => toggleSelectItem(item.path)}
                        className={`group relative cursor-pointer p-3 transition-colors ${
                          isSel ? 'border-accent bg-accent-soft/20' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {item.kind === 'video' ? (
                              <Video className="text-accent-text" style={{ width: 16, height: 16 }} />
                            ) : item.kind === 'audio' ? (
                              <Music className="text-accent-text" style={{ width: 16, height: 16 }} />
                            ) : item.kind === 'image' ? (
                              <ImageIcon className="text-accent-text" style={{ width: 16, height: 16 }} />
                            ) : (
                              <FileText className="text-t3" style={{ width: 16, height: 16 }} />
                            )}
                            <Badge variant="outline" className="text-[10px] uppercase">
                              {item.kind}
                            </Badge>
                          </div>
                          {isSel && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent text-white shadow-xs">
                              <Check style={{ width: 12, height: 12 }} />
                            </span>
                          )}
                        </div>

                        <p className="mt-2.5 truncate text-xs font-semibold text-t1" title={item.title || item.name}>
                          {item.title || item.name}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-t3 font-mono" title={item.path}>
                          {item.name}
                        </p>

                        <div className="mt-3 flex items-center justify-between text-[10px] tabular-nums text-t3">
                          <span>{item.size ? formatBytes(item.size) : '—'}</span>
                          <span>{item.metadata?.duration ? `${Math.round(item.metadata.duration)}s` : ''}</span>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* View B: Collections Overview Grid */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-t3">
                  Collections help group your library items thematically. Deleting a collection never deletes your media files.
                </p>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus style={{ width: 14, height: 14 }} /> New Collection
                </Button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-3 py-16 text-sm text-t3">
                  <Spinner /> Loading collections…
                </div>
              ) : collections.length === 0 ? (
                <EmptyState
                  icon={Folder}
                  title="No collections yet"
                  hint="Create custom collections to categorize and batch-export your library items."
                  action={
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                      <Plus style={{ width: 14, height: 14 }} /> Create First Collection
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  {collections.map((col) => (
                    <Card
                      key={col.id}
                      hover
                      onClick={() => openCollection(col)}
                      className="group cursor-pointer p-4 transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line shadow-xs"
                            style={{ backgroundColor: `${col.color}15`, borderColor: `${col.color}40` }}
                          >
                            <Folder style={{ width: 18, height: 18, color: col.color || '#00e5ff' }} />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-t1 group-hover:text-accent-text transition-colors">
                              {col.name}
                            </h3>
                            <p className="text-[11px] tabular-nums text-t3">
                              {col.item_count || 0} item(s)
                            </p>
                          </div>
                        </div>

                        <div
                          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              setEditCol(col);
                              setEditName(col.name);
                            }}
                            className="rounded-md border border-line bg-surface p-1 text-t3 hover:text-t1"
                            title="Rename collection"
                          >
                            <Edit2 style={{ width: 12, height: 12 }} />
                          </button>
                          <button
                            onClick={() => setDeleteCol(col)}
                            className="rounded-md border border-line bg-surface p-1 text-err/70 hover:text-err"
                            title="Delete collection"
                          >
                            <Trash2 style={{ width: 12, height: 12 }} />
                          </button>
                        </div>
                      </div>

                      {col.description && (
                        <p className="mt-3 line-clamp-2 text-xs text-t2">
                          {col.description}
                        </p>
                      )}

                      <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-2 text-[10px] text-t3">
                        <span>Created {formatDate(col.created_at)}</span>
                        <span className="flex items-center gap-1 text-accent-text">
                          Open <FolderOpen style={{ width: 11, height: 11 }} />
                        </span>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Create Collection Dialog */}
      <AnimatedDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create New Collection"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>Create Collection</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-t2 mb-1">
              Collection Name
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Tutorials, Music Videos, Research"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-t2 mb-1">
              Description (Optional)
            </label>
            <Textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Brief notes about what belongs in this collection…"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-t2 mb-1.5">
              Accent Color
            </label>
            <div className="flex items-center gap-2">
              {COLLECTION_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`h-7 w-7 rounded-full transition-transform ${
                    newColor === c ? 'scale-110 ring-2 ring-white/60 ring-offset-2 ring-offset-surface' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
      </AnimatedDialog>

      {/* Rename Collection Dialog */}
      <AnimatedDialog
        open={Boolean(editCol)}
        onClose={() => setEditCol(null)}
        title="Rename Collection"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditCol(null)}>
              Cancel
            </Button>
            <Button onClick={handleRename}>Save Name</Button>
          </>
        }
      >
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-t2 mb-1">
            Collection Name
          </label>
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="New name"
            autoFocus
          />
        </div>
      </AnimatedDialog>

      {/* Delete Collection Dialog */}
      <AnimatedDialog
        open={Boolean(deleteCol)}
        onClose={() => setDeleteCol(null)}
        title={`Delete Collection "${deleteCol?.name}"?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteCol(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete Collection
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <p>
            Are you sure you want to delete the collection <span className="font-semibold text-t1">{deleteCol?.name}</span>?
          </p>
          <p className="text-xs text-t3 border-l-2 border-accent pl-2 py-0.5">
            <strong>Note:</strong> Deleting a collection only removes the grouping. The actual downloaded media files on your disk will remain completely intact.
          </p>
        </div>
      </AnimatedDialog>
    </div>
  );
}

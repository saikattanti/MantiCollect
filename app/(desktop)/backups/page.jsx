'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CloudUpload,
  Calendar,
  Clock,
  Play,
  Trash2,
  Edit2,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FolderOpen,
  ShieldCheck,
  Layers,
  HardDrive,
  ExternalLink,
  FileText,
  StopCircle,
  Info
} from 'lucide-react';
import { api, onEvent } from '@/lib/ipc.js';
import { formatBytes, formatDate } from '@/lib/format.js';
import {
  Button,
  Card,
  CardHeader,
  Input,
  Label,
  Select,
  Toggle,
  Spinner,
  Badge,
  AnimatedDialog,
  Stat,
  EmptyState,
  ProgressBar
} from '@/components/ui.jsx';

export default function BackupsPage() {
  const [schedules, setSchedules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [connections, setConnections] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRunItemModal, setActiveRunItemModal] = useState(null);
  const [runningActionId, setRunningActionId] = useState(null);

  // Edit / Add modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    id: null,
    name: '',
    enabled: true,
    source_type: 'entire_library',
    collection_id: '',
    destination_connection_id: '',
    remote_prefix: 'backups/',
    recurrence_type: 'daily',
    interval_minutes: 60,
    daily_time: '02:00',
    weekly_day: 0,
    dedup_policy: 'skip',
    include_new_downloads: true
  });

  useEffect(() => {
    loadAll();

    const unsubSchedules = onEvent('backup:schedules:updated', () => {
      loadSchedules();
    });

    const unsubRuns = onEvent('backup:runs:updated', () => {
      loadRuns();
    });

    return () => {
      unsubSchedules();
      unsubRuns();
    };
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([
        loadSchedules(),
        loadRuns(),
        loadConnections(),
        loadCollections()
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadSchedules() {
    try {
      const list = await api.backup.schedules.list();
      setSchedules(list || []);
    } catch (err) {
      console.error('Failed to load schedules:', err);
    }
  }

  async function loadRuns() {
    try {
      const list = await api.backup.runs.list(null, 50);
      setRuns(list || []);
    } catch (err) {
      console.error('Failed to load backup runs:', err);
    }
  }

  async function loadConnections() {
    try {
      const list = await api.storage.connections.list();
      setConnections(list || []);
    } catch {}
  }

  async function loadCollections() {
    try {
      const list = await api.collections.list();
      setCollections(list || []);
    } catch {}
  }

  function openCreateModal() {
    const firstConn = connections[0]?.id || '';
    setForm({
      id: null,
      name: '',
      enabled: true,
      source_type: 'entire_library',
      collection_id: collections[0]?.id || '',
      destination_connection_id: firstConn,
      remote_prefix: 'backups/',
      recurrence_type: 'daily',
      interval_minutes: 60,
      daily_time: '02:00',
      weekly_day: 0,
      dedup_policy: 'skip',
      include_new_downloads: true
    });
    setModalOpen(true);
  }

  function openEditModal(sch) {
    setForm({
      id: sch.id,
      name: sch.name || '',
      enabled: Boolean(sch.enabled),
      source_type: sch.source_type || 'entire_library',
      collection_id: sch.collection_id || collections[0]?.id || '',
      destination_connection_id: sch.destination_connection_id || '',
      remote_prefix: sch.remote_prefix || '',
      recurrence_type: sch.recurrence_type || 'daily',
      interval_minutes: sch.interval_minutes || 60,
      daily_time: sch.daily_time || '02:00',
      weekly_day: sch.weekly_day ?? 0,
      dedup_policy: sch.dedup_policy || 'skip',
      include_new_downloads: Boolean(sch.include_new_downloads)
    });
    setModalOpen(true);
  }

  async function handleSaveSchedule() {
    if (!form.name.trim()) return toast.error('Schedule name is required');
    if (!form.destination_connection_id) return toast.error('Destination storage connection is required');
    if (form.source_type === 'collection' && !form.collection_id) {
      return toast.error('Please select a collection');
    }

    try {
      await api.backup.schedules.save(form);
      toast.success(form.id ? 'Schedule updated' : 'Schedule created');
      setModalOpen(false);
      loadSchedules();
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
    }
  }

  async function handleDeleteSchedule(id, name) {
    if (!confirm(`Delete backup schedule "${name}"? Past run history will be preserved.`)) return;
    try {
      await api.backup.schedules.delete(id);
      toast.success('Schedule deleted');
      loadSchedules();
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
    }
  }

  async function handleToggleSchedule(id, currentEnabled) {
    try {
      await api.backup.schedules.toggle(id, !currentEnabled);
      toast.success(!currentEnabled ? 'Schedule enabled' : 'Schedule paused');
      loadSchedules();
    } catch (err) {
      toast.error(`Toggle failed: ${err.message}`);
    }
  }

  async function handleRunNow(id) {
    setRunningActionId(id);
    try {
      const res = await api.backup.schedules.runNow(id);
      toast.success(`Backup started! (Run ID: ${res.runId?.slice(0, 8)})`);
      loadRuns();
      loadSchedules();
    } catch (err) {
      toast.error(`Failed to start backup: ${err.message}`);
    } finally {
      setRunningActionId(null);
    }
  }

  async function handleCancelRun(runId) {
    if (!confirm('Cancel this running backup job? Uploads in progress will be cleanly stopped.')) return;
    try {
      await api.backup.runs.cancel(runId);
      toast.success('Backup cancelled');
      loadRuns();
    } catch (err) {
      toast.error(`Cancel failed: ${err.message}`);
    }
  }

  async function openRunDetails(runId) {
    try {
      const details = await api.backup.runs.get(runId);
      setActiveRunItemModal(details);
    } catch (err) {
      toast.error(`Failed to load run details: ${err.message}`);
    }
  }

  // Calculate high-level metrics
  const activeSchedulesCount = schedules.filter((s) => s.enabled).length;
  const totalRunsCount = runs.length;
  const totalBackedUpBytes = runs.reduce((acc, r) => acc + (r.bytes_transferred || 0), 0);
  const successfulRuns = runs.filter((r) => r.status === 'completed').length;
  const successRate = totalRunsCount > 0 ? Math.round((successfulRuns / totalRunsCount) * 100) : 100;

  const activeRunningJob = runs.find((r) => r.status === 'running');

  if (loading && !schedules.length) {
    return (
      <div className="flex items-center gap-3 py-20 text-sm text-t3 justify-center">
        <Spinner /> Loading Cloud Backups…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-t1">Cloud Backups & Synchronization</h1>
          <p className="mt-1 text-xs text-t3">
            Automated media backups to S3-compatible cloud storage, WebDAV, SFTP, and Local NAS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={loadAll}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Button size="sm" onClick={openCreateModal}>
            <Plus className="w-3.5 h-3.5" /> New Schedule
          </Button>
        </div>
      </header>

      {/* Metrics Row */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Active Schedules"
          value={activeSchedulesCount}
          sub={`${schedules.length} total configured`}
          icon={Calendar}
          tone="accent"
        />
        <Stat
          label="Backup Executions"
          value={totalRunsCount}
          sub={`${successfulRuns} successful`}
          icon={Clock}
          tone="info"
        />
        <Stat
          label="Backed Up Volume"
          value={formatBytes(totalBackedUpBytes)}
          sub="Verified transfers"
          icon={CloudUpload}
          tone="ok"
        />
        <Stat
          label="Success Rate"
          value={`${successRate}%`}
          sub={runs.some((r) => r.status === 'partial') ? 'Partial runs recorded' : 'Zero failures'}
          icon={ShieldCheck}
          tone={successRate > 90 ? 'ok' : 'warn'}
        />
      </div>

      {/* Active Run Banner (if work is in progress) */}
      {activeRunningJob && (
        <Card className="border-accent/40 bg-accent-soft/30 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Spinner className="h-4 w-4 text-accent" />
                <span className="text-sm font-semibold text-t1">Backup in Progress: {activeRunningJob.schedule_name || 'Active Schedule'}</span>
                <Badge variant="outline" className="border-accent/30 bg-accent/10 text-[11px] text-accent-text">
                  Running
                </Badge>
              </div>
              <p className="text-xs text-t2">
                Items: {activeRunningJob.items_completed || 0} completed • {activeRunningJob.items_failed || 0} failed • {activeRunningJob.items_skipped || 0} skipped of {activeRunningJob.items_total || 0} total
              </p>
              <p className="text-xs font-mono text-t3">
                Transferred: {formatBytes(activeRunningJob.bytes_transferred || 0)}
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleCancelRun(activeRunningJob.id)}
            >
              <StopCircle className="w-3.5 h-3.5 mr-1" /> Cancel Backup
            </Button>
          </div>
          <div className="mt-4">
            <ProgressBar
              value={activeRunningJob.items_total > 0 ? (activeRunningJob.items_completed + activeRunningJob.items_skipped) / activeRunningJob.items_total : 0}
              active
            />
          </div>
        </Card>
      )}

      {/* Schedules Section */}
      <Card>
        <CardHeader
          title="Backup Schedules"
          subtitle="Persistent backup jobs survive restarts and execute automatically on schedule"
          icon={Calendar}
          actions={
            <Button size="sm" onClick={openCreateModal}>
              <Plus className="w-3.5 h-3.5" /> Add Schedule
            </Button>
          }
        />
        <div className="p-5">
          {schedules.length === 0 ? (
            <EmptyState
              icon={CloudUpload}
              title="No automated backup schedules"
              hint="Create a scheduled backup to automatically mirror your downloaded media library or collections to S3, MinIO, R2, or NAS."
              action={
                <Button size="sm" onClick={openCreateModal}>
                  <Plus className="w-3.5 h-3.5" /> Create First Schedule
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {schedules.map((sch) => {
                const conn = connections.find((c) => c.id === sch.destination_connection_id);
                const isRunning = activeRunningJob?.schedule_id === sch.id;
                const isActionBusy = runningActionId === sch.id;

                let recurrenceLabel = 'One-time';
                if (sch.recurrence_type === 'daily') recurrenceLabel = `Daily at ${sch.daily_time || '02:00'}`;
                else if (sch.recurrence_type === 'weekly') {
                  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                  recurrenceLabel = `Weekly on ${days[sch.weekly_day ?? 0]} at ${sch.daily_time || '02:00'}`;
                } else if (sch.recurrence_type === 'interval') {
                  recurrenceLabel = `Every ${sch.interval_minutes || 60}m`;
                }

                return (
                  <div
                    key={sch.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-line bg-surface-2/30 p-4 transition-colors hover:border-line-strong"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-t1">{sch.name}</span>
                        <Badge
                          variant="outline"
                          className={
                            sch.enabled
                              ? 'border-ok/30 bg-ok/10 text-ok text-[10px]'
                              : 'border-line bg-surface-2 text-t3 text-[10px]'
                          }
                        >
                          {sch.enabled ? 'Enabled' : 'Paused'}
                        </Badge>
                        <Badge variant="outline" className="border-accent/30 bg-accent-soft text-accent-text text-[10px]">
                          {recurrenceLabel}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] text-t2 font-mono">
                          {sch.source_type === 'entire_library'
                            ? 'All Library'
                            : sch.source_type === 'collection'
                            ? `Collection: ${sch.collection_name || 'Selected'}`
                            : 'New Downloads'}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-t3 flex-wrap">
                        <span className="flex items-center gap-1 font-mono text-t2">
                          <HardDrive className="w-3.5 h-3.5 text-t3" />
                          {conn ? `${conn.name} (${conn.provider_type})` : 'Destination Storage'}
                          {sch.remote_prefix ? ` → /${sch.remote_prefix}` : ''}
                        </span>
                        <span>•</span>
                        <span>
                          Next Run:{' '}
                          <span className="font-medium text-t2">
                            {sch.enabled && sch.next_run_at ? formatDate(sch.next_run_at) : 'None'}
                          </span>
                        </span>
                        <span>•</span>
                        <span>
                          Last Run:{' '}
                          <span className="text-t2">
                            {sch.last_run_at ? formatDate(sch.last_run_at) : 'Never'}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleRunNow(sch.id)}
                        disabled={isRunning || isActionBusy}
                        title="Execute backup now"
                      >
                        {isActionBusy ? (
                          <Spinner className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5 text-accent" />
                        )}
                        <span className="ml-1 text-xs">Run Now</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleToggleSchedule(sch.id, sch.enabled)}
                        title={sch.enabled ? 'Pause schedule' : 'Enable schedule'}
                      >
                        <span className="text-xs">{sch.enabled ? 'Pause' : 'Enable'}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditModal(sch)}
                        title="Edit schedule configuration"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleDeleteSchedule(sch.id, sch.name)}
                        title="Delete schedule"
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

      {/* Backup Run History */}
      <Card>
        <CardHeader
          title="Backup Run History"
          subtitle="Audit log of previous backup executions, deduplication results, and transfer status"
          icon={Clock}
          actions={
            <Button size="sm" variant="ghost" onClick={loadRuns}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh Log
            </Button>
          }
        />
        <div className="p-5">
          {runs.length === 0 ? (
            <div className="py-8 text-center text-xs text-t3">
              No backup executions recorded yet. Run a schedule above to generate history.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-t3">
                    <th className="pb-2.5 font-medium">Schedule / Destination</th>
                    <th className="pb-2.5 font-medium">Started</th>
                    <th className="pb-2.5 font-medium">Status</th>
                    <th className="pb-2.5 font-medium">Items Breakdown</th>
                    <th className="pb-2.5 font-medium">Volume</th>
                    <th className="pb-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {runs.map((r) => {
                    let statusBadge = (
                      <Badge variant="outline" className="border-ok/30 bg-ok/10 text-ok text-[11px]">
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Completed
                      </Badge>
                    );

                    if (r.status === 'partial') {
                      statusBadge = (
                        <Badge variant="outline" className="border-warn/30 bg-warn/10 text-warn text-[11px]">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Partial Success
                        </Badge>
                      );
                    } else if (r.status === 'failed') {
                      statusBadge = (
                        <Badge variant="outline" className="border-err/30 bg-err/10 text-err text-[11px]">
                          <XCircle className="w-3 h-3 mr-1" /> Failed
                        </Badge>
                      );
                    } else if (r.status === 'running') {
                      statusBadge = (
                        <Badge variant="outline" className="border-accent/30 bg-accent-soft text-accent-text text-[11px]">
                          <Spinner className="w-3 h-3 mr-1" /> Running
                        </Badge>
                      );
                    } else if (r.status === 'cancelled') {
                      statusBadge = (
                        <Badge variant="outline" className="border-line bg-surface-2 text-t3 text-[11px]">
                          Cancelled
                        </Badge>
                      );
                    }

                    return (
                      <tr key={r.id} className="hover:bg-surface-2/30 transition-colors">
                        <td className="py-3 pr-3">
                          <p className="font-semibold text-t1">{r.schedule_name || 'Scheduled Backup'}</p>
                          <p className="text-[11px] font-mono text-t3 truncate max-w-xs">{r.connection_name || 'Cloud Storage'}</p>
                        </td>
                        <td className="py-3 pr-3 text-t2 font-mono">
                          {formatDate(r.started_at)}
                        </td>
                        <td className="py-3 pr-3">{statusBadge}</td>
                        <td className="py-3 pr-3 text-t2">
                          <span className="text-ok font-medium">{r.items_completed || 0} ok</span>
                          {r.items_failed > 0 && <span className="text-err font-medium ml-1.5">• {r.items_failed} failed</span>}
                          {r.items_skipped > 0 && <span className="text-t3 ml-1.5">• {r.items_skipped} skipped</span>}
                        </td>
                        <td className="py-3 pr-3 font-mono text-t2">
                          {formatBytes(r.bytes_transferred || 0)}
                        </td>
                        <td className="py-3 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openRunDetails(r.id)}
                            className="text-xs h-7"
                          >
                            <FileText className="w-3 h-3 mr-1" /> Details
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Create / Edit Schedule Dialog */}
      <AnimatedDialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? 'Edit Backup Schedule' : 'Create Automated Backup Schedule'}
        width={560}
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveSchedule}>
              {form.id ? 'Save Changes' : 'Create Schedule'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <Label>Schedule Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Nightly S3 Cloud Vault / Weekly TrueNAS Sync"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Source Content</Label>
              <Select
                value={form.source_type}
                onChange={(e) => setForm((prev) => ({ ...prev, source_type: e.target.value }))}
              >
                <option value="entire_library">Entire Media Library</option>
                <option value="collection">Specific Collection</option>
                <option value="new_downloads">Newly Completed Downloads</option>
              </Select>
            </div>

            <div>
              <Label>Destination Storage</Label>
              {connections.length === 0 ? (
                <div className="rounded-lg border border-dashed border-warn/40 bg-warn/5 p-2 text-xs text-warn">
                  No storage connections configured.{' '}
                  <Link href="/settings" className="underline font-semibold">
                    Add S3 or NAS in Settings
                  </Link>
                </div>
              ) : (
                <Select
                  value={form.destination_connection_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, destination_connection_id: e.target.value }))}
                >
                  <option value="" disabled>Select destination...</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.provider_type?.replace('_', ' ').toUpperCase()})
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </div>

          {form.source_type === 'collection' && (
            <div>
              <Label>Select Collection</Label>
              <Select
                value={form.collection_id}
                onChange={(e) => setForm((prev) => ({ ...prev, collection_id: e.target.value }))}
              >
                {collections.length === 0 ? (
                  <option value="">No collections created yet</option>
                ) : (
                  collections.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name} ({col.item_count || 0} items)
                    </option>
                  ))
                )}
              </Select>
            </div>
          )}

          <div>
            <Label>Remote Directory / Key Prefix</Label>
            <Input
              value={form.remote_prefix}
              onChange={(e) => setForm((prev) => ({ ...prev, remote_prefix: e.target.value }))}
              placeholder="backups/mediavault/ or my-prefix/"
            />
            <p className="mt-1 text-[11px] text-t3">
              Prepended to uploaded files on the remote storage target (e.g. S3 bucket key prefix or SFTP subfolder).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Recurrence</Label>
              <Select
                value={form.recurrence_type}
                onChange={(e) => setForm((prev) => ({ ...prev, recurrence_type: e.target.value }))}
              >
                <option value="daily">Daily Schedule</option>
                <option value="weekly">Weekly Schedule</option>
                <option value="interval">Custom Interval</option>
                <option value="once">One-Time Run</option>
              </Select>
            </div>

            <div>
              {form.recurrence_type === 'daily' && (
                <div>
                  <Label>Execution Time (HH:MM)</Label>
                  <Input
                    type="time"
                    value={form.daily_time}
                    onChange={(e) => setForm((prev) => ({ ...prev, daily_time: e.target.value }))}
                  />
                </div>
              )}

              {form.recurrence_type === 'weekly' && (
                <div>
                  <Label>Day of Week</Label>
                  <Select
                    value={form.weekly_day}
                    onChange={(e) => setForm((prev) => ({ ...prev, weekly_day: Number(e.target.value) }))}
                  >
                    <option value={0}>Sunday</option>
                    <option value={1}>Monday</option>
                    <option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option>
                    <option value={4}>Thursday</option>
                    <option value={5}>Friday</option>
                    <option value={6}>Saturday</option>
                  </Select>
                </div>
              )}

              {form.recurrence_type === 'interval' && (
                <div>
                  <Label>Interval (Minutes)</Label>
                  <Input
                    type="number"
                    min="5"
                    max="10080"
                    step="5"
                    value={form.interval_minutes}
                    onChange={(e) => setForm((prev) => ({ ...prev, interval_minutes: Number(e.target.value) }))}
                  />
                </div>
              )}

              {form.recurrence_type === 'once' && (
                <div className="pt-2 text-xs text-t3">
                  Runs once at the next scheduled trigger or immediately upon "Run Now".
                </div>
              )}
            </div>
          </div>

          <div>
            <Label>Deduplication Policy</Label>
            <Select
              value={form.dedup_policy}
              onChange={(e) => setForm((prev) => ({ ...prev, dedup_policy: e.target.value }))}
            >
              <option value="skip">Skip if verified unchanged (Size + SHA256 / Mtime)</option>
              <option value="replace">Overwrite remote file unconditionally</option>
              <option value="avoid">Avoid overwrite (rename conflicting remote key)</option>
            </Select>
            <p className="mt-1 text-[11px] text-t3">
              Ensures bandwidth isn't wasted re-uploading identical files across repeated backup runs.
            </p>
          </div>

          <div className="space-y-2 pt-2 border-t border-line">
            <Toggle
              checked={form.enabled}
              onChange={(v) => setForm((prev) => ({ ...prev, enabled: v }))}
              label="Schedule Active / Enabled"
              description="Automatically queue backup runs when scheduled time arrives."
            />

            <Toggle
              checked={form.include_new_downloads}
              onChange={(v) => setForm((prev) => ({ ...prev, include_new_downloads: v }))}
              label="Include Newly Completed Downloads"
              description="Automatically detects and backs up fresh downloads completed after the previous run."
            />
          </div>
        </div>
      </AnimatedDialog>

      {/* Per-Item Run Details Modal */}
      <AnimatedDialog
        open={!!activeRunItemModal}
        onClose={() => setActiveRunItemModal(null)}
        title={`Backup Details: ${activeRunItemModal?.run?.schedule_name || 'Run Audit'}`}
        width={720}
        footer={
          <div className="flex w-full items-center justify-end">
            <Button size="sm" onClick={() => setActiveRunItemModal(null)}>
              Close
            </Button>
          </div>
        }
      >
        {activeRunItemModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-surface-2/40 p-3 text-xs">
              <div>
                <p className="text-t3">Started</p>
                <p className="font-semibold text-t1 mt-0.5">{formatDate(activeRunItemModal.run.started_at)}</p>
              </div>
              <div>
                <p className="text-t3">Finished</p>
                <p className="font-semibold text-t1 mt-0.5">{formatDate(activeRunItemModal.run.finished_at)}</p>
              </div>
              <div>
                <p className="text-t3">Total Volume</p>
                <p className="font-semibold text-t1 mt-0.5">{formatBytes(activeRunItemModal.run.bytes_transferred || 0)}</p>
              </div>
            </div>

            {activeRunItemModal.run.error_summary && (
              <div className="rounded-xl border border-err/30 bg-err/10 p-3 text-xs text-err">
                <span className="font-semibold">Error Summary: </span>
                {activeRunItemModal.run.error_summary}
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-t1 mb-2">
                Processed Items ({activeRunItemModal.items?.length || 0})
              </p>
              {activeRunItemModal.items?.length === 0 ? (
                <div className="py-6 text-center text-xs text-t3 border border-dashed border-line rounded-lg">
                  No individual file entries recorded for this execution.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {activeRunItemModal.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/20 p-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-t1 truncate" title={item.source_path}>
                          {item.source_path.split(/[/\\]/).pop()}
                        </p>
                        <p className="font-mono text-[11px] text-t3 truncate" title={item.remote_path}>
                          → {item.remote_path}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[11px] text-t2">
                          {formatBytes(item.bytes_transferred || 0)}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            item.status === 'completed'
                              ? 'border-ok/30 bg-ok/10 text-ok text-[10px]'
                              : item.status === 'skipped'
                              ? 'border-line bg-surface-2 text-t3 text-[10px]'
                              : 'border-err/30 bg-err/10 text-err text-[10px]'
                          }
                        >
                          {item.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </AnimatedDialog>
    </div>
  );
}

'use client';

import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { History as HistoryIcon, FolderOpen, Copy, Search } from 'lucide-react';
import { api, onEvent } from '@/lib/ipc.js';
import { formatBytesDone, formatDate } from '@/lib/format.js';
import { Card, Input, Select, StatusBadge, EmptyState, Button } from '@/components/ui.jsx';

export default function HistoryPage() {
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.jobs.list().then(setJobs).catch(() => {});
    return onEvent('jobs:updated', setJobs);
  }, []);

  const finished = useMemo(() => {
    let list = jobs.filter((j) => ['completed', 'failed', 'cancelled'].includes(j.status));
    if (filter !== 'all') list = list.filter((j) => j.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((j) => (j.title || '').toLowerCase().includes(q) || j.url.toLowerCase().includes(q));
    }
    return list;
  }, [jobs, filter, search]);

  async function reveal(path) {
    try {
      await api.reveal(path);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function copyPath(path) {
    try {
      await navigator.clipboard.writeText(path);
      toast.success('Path copied');
    } catch {
      toast.error('Clipboard unavailable');
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="overline">Manage</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">History</h1>
        <p className="mt-1 text-sm text-t2">Every finished job, persisted in local SQLite. Nothing is fabricated.</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-t3" style={{ width: 14, height: 14 }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or URL…" className="pl-9" aria-label="Search history" />
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40" aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <span className="text-xs tabular-nums text-t3">{finished.length} record(s)</span>
      </div>

      {finished.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No history yet" hint="Finished downloads appear here with their source, size, and result file." />
      ) : (
        <Card>
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-surface text-[11px] uppercase tracking-wider text-t3 shadow-[0_1px_0_var(--mv-border)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Title</th>
                  <th className="px-3 py-3 font-medium">Platform</th>
                  <th className="px-3 py-3 font-medium">Size</th>
                  <th className="px-3 py-3 font-medium">Finished</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {finished.map((j) => (
                  <tr key={j.id} className="border-t border-line transition-colors hover:bg-surface-2/40">
                    <td className="px-5 py-3">
                      <StatusBadge status={j.status} />
                    </td>
                    <td className="max-w-72 px-3 py-3">
                      <p className="truncate text-[13px] text-t1" title={j.url}>
                        {j.title || j.url}
                      </p>
                      <p className="truncate text-[11px] text-t3">{j.url}</p>
                      {j.error && (
                        <p className="mt-0.5 truncate text-[11px] text-err" title={j.error}>
                          {j.error}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs capitalize text-t2">{j.provider || '—'}</td>
                    <td className="px-3 py-3 text-xs tabular-nums text-t2">{j.bytesDone ? formatBytesDone(j) : '—'}</td>
                    <td className="px-3 py-3 text-xs text-t3">{formatDate(j.finishedAt)}</td>
                    <td className="px-3 py-3">
                      {j.resultPath && (
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="sm" onClick={() => reveal(j.resultPath)} title="Show in folder" aria-label="Show in folder">
                            <FolderOpen style={{ width: 14, height: 14 }} />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => copyPath(j.resultPath)} title="Copy path" aria-label="Copy path">
                            <Copy style={{ width: 14, height: 14 }} />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { ClipboardList, FileUp, Loader2, ListOrdered, Download } from 'lucide-react';
import { api, onEvent } from '@/lib/ipc.js';
import { Button, Card, CardHeader, Input, Label, Textarea, StatusBadge } from '@/components/ui.jsx';

export default function BatchPage() {
  const [text, setText] = useState('');
  const [results, setResults] = useState(null);
  const [validating, setValidating] = useState(false);
  const [destDir, setDestDir] = useState('');
  const [batchJobs, setBatchJobs] = useState([]);
  const [starting, setStarting] = useState(false);

  useEffect(() => onEvent('jobs:updated', (jobs) => setBatchJobs(jobs)), []);

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const counts = results
    ? {
        ok: results.results.filter((r) => r.ok).length,
        dup: results.results.filter((r) => r.duplicate).length,
        bad: results.results.filter((r) => !r.ok && !r.duplicate).length
      }
    : null;

  async function validate() {
    if (!lines.length) return;
    setValidating(true);
    setResults(null);
    try {
      const res = await api.batchValidate(lines);
      setResults(res);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setValidating(false);
    }
  }

  async function importFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText(content);
    toast.info(`Imported ${content.split(/\r?\n/).filter((l) => l.trim()).length} lines`);
    e.target.value = '';
  }

  async function pickDir() {
    const { path } = await api.selectDirectory();
    if (path) setDestDir(path);
  }

  async function startBatch() {
    if (!results) return;
    const ok = results.results.filter((r) => r.ok);
    if (!ok.length) return;
    setStarting(true);
    try {
      const collectionId = `batch-${Date.now()}`;
      for (const r of ok) {
        await api.jobs.start({
          url: r.url,
          provider: r.provider,
          kind: r.direct ? 'file' : 'media',
          title: r.url,
          format: 'best available',
          destDir: destDir || undefined,
          collectionId,
          extra: null
        });
      }
      toast.success(`Queued ${ok.length} downloads`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setStarting(false);
    }
  }

  const batchIds = new Set(batchJobs.filter((j) => j.collectionId?.startsWith('batch-')).map((j) => j.collectionId));
  const batchList = batchJobs.filter((j) => batchIds.has(j.collectionId));
  const batchCounts = {
    completed: batchList.filter((j) => j.status === 'completed').length,
    failed: batchList.filter((j) => j.status === 'failed').length,
    pending: batchList.filter((j) => ['waiting', 'downloading', 'processing'].includes(j.status)).length
  };

  function exportReport() {
    const rows = [
      ['url', 'status', 'title', 'provider', 'bytes', 'error'],
      ...results.results.map((r) => [r.url, r.ok ? 'valid' : 'invalid', '', r.providerName || '', '', r.error || ''])
    ];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mediavault-batch-report-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="overline">Download</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Batch Downloads</h1>
        <p className="mt-1 text-sm text-t2">Paste multiple URLs (one per line) or import a text file.</p>
      </header>

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="text-xs tabular-nums text-t3">{lines.length} URL(s) entered</span>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-accent-text transition-colors hover:brightness-125">
            <FileUp style={{ width: 13, height: 13 }} /> Import .txt
            <input type="file" accept=".txt,.csv" className="hidden" onChange={importFile} />
          </label>
        </div>
        <div className="p-4">
          <Textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'https://www.youtube.com/watch?v=…\nhttps://example.com/photo.jpg\n…'}
            aria-label="URL list"
          />
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={validate} disabled={validating || !lines.length}>
              {validating ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : <ClipboardList style={{ width: 15, height: 15 }} />}
              Validate URLs
            </Button>
            {results && (
              <span className="text-xs tabular-nums text-t3">
                <span className="text-ok">{counts.ok} valid</span> · <span className="text-warn">{counts.dup} duplicates</span> ·{' '}
                <span className="text-err">{counts.bad} invalid</span>
              </span>
            )}
          </div>
        </div>
      </Card>

      {results && (
        <Card>
          <CardHeader
            title="Validation results"
            subtitle="Each URL is checked against the provider registry and network safety rules"
            actions={
              <Button size="sm" variant="secondary" onClick={exportReport}>
                Export report (CSV)
              </Button>
            }
          />
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-surface text-[11px] uppercase tracking-wider text-t3 shadow-[0_1px_0_var(--mv-border)]">
                <tr>
                  <th className="px-5 py-2.5 font-medium">URL</th>
                  <th className="px-3 py-2.5 font-medium">Platform</th>
                  <th className="px-3 py-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {results.results.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="max-w-96 truncate px-5 py-2 text-t2" title={r.url}>
                      {r.url}
                    </td>
                    <td className="px-3 py-2 text-xs capitalize text-t2">{r.providerName || '—'}</td>
                    <td className="px-3 py-2">
                      {r.ok ? (
                        <span className="text-xs font-medium text-ok">valid{r.direct ? ' (direct file)' : ''}</span>
                      ) : (
                        <span className="text-xs text-err" title={r.error}>
                          {r.duplicate ? 'duplicate' : r.error}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t border-line bg-bg-elev/40 px-5 py-3.5">
            <div className="min-w-[260px] flex-1">
              <Label className="mb-1">Destination (optional)</Label>
              <div className="flex gap-1.5">
                <Input value={destDir} onChange={(e) => setDestDir(e.target.value)} placeholder="default download folder" />
                <Button variant="secondary" onClick={pickDir}>
                  Browse
                </Button>
              </div>
            </div>
            <Button onClick={startBatch} disabled={starting || !counts.ok}>
              <Download style={{ width: 15, height: 15 }} />
              Start batch ({counts.ok})
            </Button>
          </div>
        </Card>
      )}

      {batchList.length > 0 && (
        <Card>
          <CardHeader
            title="Batch progress"
            subtitle={`completed ${batchCounts.completed} · failed ${batchCounts.failed} · in progress ${batchCounts.pending}`}
            icon={ListOrdered}
          />
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {batchList.map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-5 py-2">
                <StatusBadge status={j.status} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-t1">{j.title}</span>
                {j.error && (
                  <span className="max-w-52 truncate text-[11px] text-err" title={j.error}>
                    {j.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

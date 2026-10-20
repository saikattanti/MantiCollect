'use client';

import { useEffect, useState } from 'react';
import { Globe, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/ipc.js';
import { Card, CardHeader, CapBadge, Spinner } from '@/components/ui.jsx';

const OPERATIONS = [
  ['metadata', 'Metadata'],
  ['video', 'Video'],
  ['audio', 'Audio'],
  ['images', 'Images'],
  ['collections', 'Collections'],
  ['account_export', 'Account export']
];

export default function PlatformsPage() {
  const [list, setList] = useState(null);

  useEffect(() => {
    api.platforms().then(setList).catch(() => setList([]));
  }, []);

  if (!list) {
    return (
      <div className="flex items-center gap-3 py-20 text-sm text-t3">
        <Spinner /> Loading capability matrix from the provider registry…
      </div>
    );
  }

  const rows = [...list].sort((a, b) => (a.id === 'generic' ? 1 : b.id === 'generic' ? -1 : a.name.localeCompare(b.name)));

  return (
    <div className="space-y-5">
      <header>
        <p className="overline">System</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Supported Platforms</h1>
        <p className="mt-1 max-w-2xl text-sm text-t2">
          Generated from the live provider registry — it reflects what the integrations actually implement.{' '}
          <span className="text-info">Auth required</span> means the operation only works with an explicit, user-provided cookies.txt from your own account.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs text-t3">
        <span className="overline mr-1">Legend</span>
        <CapBadge value="supported" />
        <CapBadge value="partial" />
        <CapBadge value="requires_auth" />
        <CapBadge value="unsupported" />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-t3">
              <tr>
                <th className="px-5 py-3 font-medium">Platform</th>
                {OPERATIONS.map(([k, label]) => (
                  <th key={k} className="px-3 py-3 font-medium">
                    {label}
                  </th>
                ))}
                <th className="px-3 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-line align-top transition-colors hover:bg-surface-2/30">
                  <td className="px-5 py-3">
                    <p className="text-[13px] font-medium text-t1">{p.name}</p>
                    <p className="text-[11px] text-t3">{p.host}</p>
                  </td>
                  {OPERATIONS.map(([k]) => (
                    <td key={k} className="px-3 py-3">
                      <CapBadge value={p.capabilities[k] || 'unsupported'} />
                    </td>
                  ))}
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                        p.testStatus === 'tested' ? 'border-ok/30 bg-ok/10 text-ok' : 'border-line bg-surface-2/50 text-t3'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${p.testStatus === 'tested' ? 'bg-ok' : 'bg-t3'}`} />
                      {p.testStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {rows
          .filter((p) => (p.notes && p.notes.length) || (p.auth && p.auth.details))
          .map((p) => (
            <Card key={`notes-${p.id}`} className="p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-accent-soft">
                  <Globe className="text-accent-text" style={{ width: 13, height: 13 }} />
                </div>
                <p className="text-[13px] font-medium text-t1">{p.name}</p>
              </div>
              {p.auth?.details && (
                <p className="mt-2.5 flex items-start gap-2 text-xs leading-relaxed text-t3">
                  <ShieldCheck className="mt-0.5 shrink-0 text-info" style={{ width: 13, height: 13 }} />
                  {p.auth.details}
                </p>
              )}
              {(p.notes || []).map((n, i) => (
                <p key={i} className="mt-1.5 text-xs leading-relaxed text-t3">
                  · {n}
                </p>
              ))}
            </Card>
          ))}
      </div>
    </div>
  );
}

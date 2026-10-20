'use client';

import { Suspense } from 'react';
import { Spinner } from '@/components/ui.jsx';
import ProbeView from '@/components/ProbeView.jsx';

export default function CollectionsPage() {
  return (
    <div className="space-y-5">
      <header>
        <p className="overline">Download</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Collections</h1>
        <p className="mt-1 max-w-2xl text-sm text-t2">
          Paste a playlist, album, board, or channel link. MediaVault lists the items the source actually exposes, lets you pick individual items or
          select all, and downloads each as an independent job — one failure never cancels the rest.
        </p>
      </header>
      <Suspense
        fallback={
          <div className="flex items-center gap-3 py-10 text-sm text-t3">
            <Spinner /> Loading…
          </div>
        }
      >
        <ProbeView defaultCollectionMode />
      </Suspense>
    </div>
  );
}

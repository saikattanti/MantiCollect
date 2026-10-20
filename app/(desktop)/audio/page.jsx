'use client';

import { Suspense } from 'react';
import { Spinner } from '@/components/ui.jsx';
import ProbeView from '@/components/ProbeView.jsx';

export default function AudioPage() {
  return (
    <div className="space-y-5">
      <header>
        <p className="overline">Download</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Audio Downloader</h1>
        <p className="mt-1 text-sm text-t2">
          Audio-first view. Distinguishes original audio streams (no re-encode) from extracted/converted audio — conversion never improves source quality.
        </p>
      </header>
      <Suspense
        fallback={
          <div className="flex items-center gap-3 py-10 text-sm text-t3">
            <Spinner /> Loading…
          </div>
        }
      >
        <ProbeView focusKind="audio" />
      </Suspense>
    </div>
  );
}

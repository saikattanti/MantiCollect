'use client';

import { Suspense } from 'react';
import { Spinner } from '@/components/ui.jsx';
import ProbeView from '@/components/ProbeView.jsx';

export default function ImagePage() {
  return (
    <div className="space-y-5">
      <header>
        <p className="overline">Download</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Image Downloader</h1>
        <p className="mt-1 text-sm text-t2">
          Image-first view. Direct image links and posts/albums that expose images. Direct downloads work for any publicly reachable media file.
        </p>
      </header>
      <Suspense
        fallback={
          <div className="flex items-center gap-3 py-10 text-sm text-t3">
            <Spinner /> Loading…
          </div>
        }
      >
        <ProbeView focusKind="image" />
      </Suspense>
    </div>
  );
}

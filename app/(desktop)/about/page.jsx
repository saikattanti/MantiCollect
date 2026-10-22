'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/ipc.js';
import { Card, CardHeader } from '@/components/ui.jsx';

export default function AboutPage() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    api.info().then(setInfo).catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      {/* Brand Hero */}
      <div className="glass flex flex-col sm:flex-row items-center gap-6 rounded-2xl border border-line-strong p-6 shadow-sm">
        <div className="flex h-24 w-48 shrink-0 items-center justify-center p-2">
          <img
            src="/MantiCollect-full-logo-tr.png"
            alt="MantiCollect — A Mantitup Product"
            className="max-h-24 max-w-full object-contain"
          />
        </div>
        <div className="space-y-1.5 text-center sm:text-left">
          <p className="overline">Desktop Application</p>
          <h1 className="text-xl font-bold tracking-tight text-t1">
            MantiCollect
          </h1>
          <p className="text-sm font-medium text-accent">
            A Mantitup Product
          </p>
          <p className="text-xs text-t3">
            v{info?.version || '0.1.0'} &bull; Local-First Universal Media Downloader &amp; Digital Collector for Windows
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="What this app does" />
          <div className="space-y-3 p-5 text-sm leading-relaxed text-t2">
            <p>
              MantiCollect downloads supported media from a wide range of websites using a URL. It identifies the platform through a modular provider
              registry, shows the formats the source actually reports, and downloads through a persistent local queue.
            </p>
            <p>
              Everything stays on your machine: settings, history, and files are stored locally (SQLite + filesystem). There is no cloud service, no
              mandatory account, and no telemetry.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Architecture" />
          <div className="space-y-3 p-5 text-sm leading-relaxed text-t2">
            <p>
              <span className="font-medium text-t1">Electron</span> (context isolation, sandboxed renderer, whitelisted IPC, Mica window material)
              hosts a <span className="font-medium text-t1">Next.js App Router</span> interface (static export — no server needed). The main process
              runs the media engine: provider adapters (direct downloads + yt-dlp-backed platforms), a persistent SQLite job queue, and FFmpeg/FFprobe
              for merging and conversion.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Legal & ethical use" />
          <div className="p-5 text-sm leading-relaxed text-t2">
            <p>
              Only download media you have the right to save: your own content, publicly available media, or content you are licensed to use. Respect
              platform terms of service, copyright, and privacy laws. MantiCollect does not bypass paywalls, DRM, or private-account permissions, and it
              does not silently use browser cookies — any authentication is explicit and user-provided.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Third-party components" />
          <div className="p-5 text-xs leading-relaxed text-t3">
            <p>
              yt-dlp (MIT) — media extraction. FFmpeg/FFprobe (GPL builds) — media processing. Electron, Next.js, React, Tailwind CSS,
              better-sqlite3, archiver, Lucide, Framer Motion, Radix UI, Sonner.
            </p>
            <p className="mt-2">
              Binary licensing: the FFmpeg static build is GPL — fine for personal local use; redistribution of the packaged binaries would carry GPL
              obligations. yt-dlp is MIT.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

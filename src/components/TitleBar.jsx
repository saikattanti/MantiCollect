import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Link2, X, ClipboardPaste, Settings as SettingsIcon, Loader } from 'lucide-react';
import { api, onEvent } from '../lib/ipc.js';

/**
 * Custom title bar (frameless window with native min/max/close via
 * titleBarStyle: 'hidden'). Drag region covers the bar; interactive
 * elements are no-drag. The right side reserves space for the native
 * window controls.
 */
export default function TitleBar() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => {
    api.jobs
      .list()
      .then((jobs) => setActiveCount(jobs.filter((j) => ['waiting', 'downloading', 'processing', 'fetching_metadata'].includes(j.status)).length))
      .catch(() => {});
    return onEvent('jobs:updated', (jobs) =>
      setActiveCount(jobs.filter((j) => ['waiting', 'downloading', 'processing', 'fetching_metadata'].includes(j.status)).length)
    );
  }, []);

  function submit() {
    const v = url.trim();
    if (!v) return;
    router.push(`/universal?url=${encodeURIComponent(v)}`);
    setUrl('');
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <header className="glass z-30 flex h-11 shrink-0 items-center gap-3 rounded-none border-x-0 border-t-0 px-4 select-none drag">
      {/* brand */}
      <div className="no-drag flex items-center gap-2.5">
        <div className="glossy flex h-[22px] w-[22px] items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-2 shadow-xs ring-1 ring-white/10">
          <Download className="text-white" style={{ width: 12, height: 12 }} />
        </div>
        <span className="text-[13px] font-semibold tracking-tight text-t1">MediaVault</span>
      </div>

      {/* universal quick input - Command Palette ergonomics */}
      <div className="no-drag mx-2 flex max-w-xl flex-1 items-center">
        <div className="relative flex-1 group">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-t3 transition-colors group-focus-within:text-accent" style={{ width: 14, height: 14 }} />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Paste a media URL to download… (Enter to analyze)"
            aria-label="Universal URL input"
            className="h-8 w-full rounded-lg border border-line-strong bg-surface-2/40 pl-9 pr-20 text-[13px] text-t1 placeholder:text-t3/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] transition-all outline-none focus:border-accent/70 focus:bg-surface focus:ring-2 focus:ring-accent/25"
          />
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {url ? (
              <>
                <button
                  onClick={submit}
                  title="Press Enter to analyze"
                  aria-label="Analyze URL"
                  className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-text transition-colors hover:bg-accent/25"
                >
                  ↵ Enter
                </button>
                <button
                  onClick={() => setUrl('')}
                  title="Clear"
                  aria-label="Clear URL"
                  className="rounded-md p-1 text-t3 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent hover:bg-surface-2 hover:text-t1"
                >
                  <X style={{ width: 13, height: 13 }} />
                </button>
              </>
            ) : (
              <button
                onClick={paste}
                title="Paste from clipboard"
                aria-label="Paste URL"
                className="rounded-md p-1.5 text-t3 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent hover:bg-surface-2 hover:text-t1"
              >
                <ClipboardPaste style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* right cluster */}
      <div className="no-drag ml-auto flex items-center gap-1.5">
        {activeCount > 0 && (
          <button
            onClick={() => router.push('/queue')}
            className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-text shadow-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 hover:bg-accent/20"
            title="Open download queue"
          >
            <Loader className="animate-spin" style={{ width: 12, height: 12 }} />
            <span>{activeCount} active</span>
          </button>
        )}
        <button
          onClick={() => router.push('/settings')}
          title="Settings"
          aria-label="Settings"
          className="rounded-lg p-2 text-t3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 hover:bg-surface-2/70 hover:text-t1"
        >
          <SettingsIcon style={{ width: 16, height: 16 }} />
        </button>
        {/* reserve space for native window controls */}
        <div className="w-[132px]" aria-hidden />
      </div>
    </header>
  );
}

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Download } from 'lucide-react';
import { api, onEvent } from '../lib/ipc.js';
import { formatSpeed, formatEta } from '../lib/format.js';
import { ProgressBar } from './ui.jsx';
import Thumb from './Thumb.jsx';

const ACTIVE = ['waiting', 'downloading', 'processing', 'fetching_metadata'];

/**
 * Global floating queue dock — real active downloads stay visible while
 * navigating anywhere. Progress comes from live backend events; the bar
 * itself carries no blur so frequent updates stay cheap.
 */
export default function FloatingQueue() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    api.jobs.list().then(setJobs).catch(() => {});
    return onEvent('jobs:updated', setJobs);
  }, []);

  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  if (!active.length) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        className="glass fixed bottom-5 right-5 z-40 w-[320px] overflow-hidden rounded-2xl shadow-xl border border-line-strong"
      >
        <button
          onClick={() => router.push('/queue')}
          className="flex w-full items-center justify-between px-4 pt-3.5 pb-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent"
          aria-label="Open download queue"
        >
          <span className="overline">
            Active downloads <span className="ml-1 text-accent-text tabular-nums">{active.length}</span>
          </span>
          <ArrowUpRight className="text-t3" style={{ width: 14, height: 14 }} />
        </button>
        <div className="px-4 pb-1 pt-2.5">
          {active.slice(0, 3).map((j) => {
            const speed = j.currentSpeed || j.speed;
            const hasTotal = j.bytesTotal > 0 || j.totalBytes > 0;
            return (
              <div key={j.id} className="mb-2.5 last:mb-0">
                <div className="mb-1.5 flex items-center gap-2.5">
                  {j.thumbnail ? (
                    <Thumb src={j.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded-md" />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2">
                      <Download className="text-t3" style={{ width: 13, height: 13 }} />
                    </div>
                  )}
                  <p className="min-w-0 flex-1 truncate text-xs font-medium text-t1">{j.title || j.url}</p>
                  {j.status === 'downloading' && (
                    <span className="shrink-0 text-[10px] tabular-nums text-t3">
                      {speed > 0 && `${formatSpeed(speed)} `}
                      {hasTotal ? `${Math.round((j.progress || 0) * 100)}%` : ''}
                    </span>
                  )}
                </div>
                <ProgressBar
                  value={j.progress}
                  active={j.status === 'downloading'}
                  indeterminate={j.status === 'waiting' || j.status === 'fetching_metadata' || !hasTotal}
                />
              </div>
            );
          })}
        </div>
        {active.length > 3 && (
          <button
            onClick={() => router.push('/queue')}
            className="w-full border-t border-line px-4 py-2 text-left text-[11px] text-t3 transition-colors hover:bg-surface-2/60 hover:text-t1"
          >
            +{active.length - 3} more — open queue
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

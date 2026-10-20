'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import TitleBar from '@/components/TitleBar.jsx';
import Sidebar from '@/components/Sidebar.jsx';
import FloatingQueue from '@/components/FloatingQueue.jsx';
import { AmbientBackground } from '@/components/ui.jsx';
import { useTheme } from '@/lib/theme.jsx';
import { onEvent, api } from '@/lib/ipc.js';

export default function DesktopLayout({ children }) {
  // Normalize the raw pathname (static exports can expose "/x.html").
  const pathname = usePathname().replace(/\.html$/, '');
  const reduce = useReducedMotion();
  const { resolved } = useTheme();

  useEffect(() => {
    const unsubClip = onEvent('clipboard:detected', (payload) => {
      if (!payload?.url) return;
      toast(`Download link copied: ${payload.url.length > 50 ? payload.url.slice(0, 48) + '…' : payload.url}`, {
        description: payload.providerName ? `Detected ${payload.providerName} media source` : 'Supported download source',
        duration: 8000,
        action: {
          label: 'Download Now',
          onClick: async () => {
            try {
              await api.jobs.start({ url: payload.url });
              toast.success('Download queued');
            } catch (err) {
              toast.error(err.message);
            }
          }
        },
        cancel: {
          label: 'Dismiss',
          onClick: () => {
            api.clipboard.clear().catch(() => {});
          }
        }
      });
    });

    const unsubBrowser = onEvent('browser:download-queued', (payload) => {
      if (!payload) return;
      toast.success(`Download added from browser: ${payload.title || payload.url}`, {
        description: `Job ID: ${payload.id ? payload.id.slice(0, 8) + '…' : 'Queued'}`,
        duration: 4000
      });
    });

    return () => {
      unsubClip?.();
      unsubBrowser?.();
    };
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AmbientBackground />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-7 py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <FloatingQueue />
      <Toaster theme={resolved === 'light' ? 'light' : 'dark'} position="bottom-right" richColors offset={120} />
    </div>
  );
}

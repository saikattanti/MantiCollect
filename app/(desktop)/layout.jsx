'use client';

import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Toaster } from 'sonner';
import TitleBar from '@/components/TitleBar.jsx';
import Sidebar from '@/components/Sidebar.jsx';
import FloatingQueue from '@/components/FloatingQueue.jsx';
import { AmbientBackground } from '@/components/ui.jsx';
import { useTheme } from '@/lib/theme.jsx';

export default function DesktopLayout({ children }) {
  // Normalize the raw pathname (static exports can expose "/x.html").
  const pathname = usePathname().replace(/\.html$/, '');
  const reduce = useReducedMotion();
  const { resolved } = useTheme();

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

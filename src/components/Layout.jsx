import { useLocation } from 'react-router-dom';
import { Outlet } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Toaster } from 'sonner';
import TitleBar from './TitleBar.jsx';
import Sidebar from './Sidebar.jsx';
import FloatingQueue from './FloatingQueue.jsx';
import { AmbientBackground } from './ui.jsx';
import { useTheme } from '../lib/theme.jsx';

export default function Layout() {
  const location = useLocation();
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
                key={location.pathname}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <Outlet />
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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import {
  LayoutDashboard,
  Link2,
  Video,
  Music,
  Image as ImageIcon,
  Share2,
  FolderOpen,
  ListOrdered,
  Loader,
  History,
  Library,
  Globe,
  Settings as SettingsIcon,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  CloudUpload
} from 'lucide-react';
import { api, onEvent } from '../lib/ipc.js';

const GROUPS = [
  {
    label: null,
    items: [{ to: '/', label: 'Overview', icon: LayoutDashboard, end: true }]
  },
  {
    label: 'Download',
    items: [
      { to: '/universal', label: 'Universal', icon: Link2 },
      { to: '/video', label: 'Video', icon: Video },
      { to: '/audio', label: 'Audio', icon: Music },
      { to: '/image', label: 'Images', icon: ImageIcon },
      { to: '/social', label: 'Social Platforms', icon: Share2 },
      { to: '/collections', label: 'Collections', icon: FolderOpen },
      { to: '/batch', label: 'Batch Downloads', icon: ListOrdered }
    ]
  },
  {
    label: 'Manage',
    items: [
      { to: '/queue', label: 'Download Queue', icon: Loader, badge: true },
      { to: '/library', label: 'Library', icon: Library },
      { to: '/backups', label: 'Cloud Backups', icon: CloudUpload },
      { to: '/history', label: 'History', icon: History }
    ]
  },
  {
    label: 'System',
    items: [
      { to: '/platforms', label: 'Platforms', icon: Globe },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
      { to: '/about', label: 'About', icon: Info }
    ]
  }
];

export default function Sidebar() {
  const pathname = usePathname().replace(/\.html$/, '');
  const reduce = useReducedMotion();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('mv-sidebar') === '1';
    } catch {
      return false;
    }
  });
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

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem('mv-sidebar', c ? '0' : '1');
      } catch {}
      return !c;
    });
  }

  return (
    <nav
      className="glass z-20 flex shrink-0 flex-col overflow-hidden rounded-none border-y-0 border-l-0 transition-[width] duration-200 select-none"
      style={{ width: collapsed ? 64 : 224 }}
      aria-label="Primary navigation"
    >
      <div className={`flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 py-3.5 ${collapsed ? 'px-2' : ''}`}>
        {GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && !collapsed && <p className="overline mb-1.5 px-2.5">{group.label}</p>}
            {group.label && collapsed && <div className="mx-2 my-1.5 border-t border-line" aria-hidden />}
            <ul className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon, badge }) => (
                <li key={to} className="relative">
                  {pathname === to && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-lg border border-accent/25 bg-accent-soft shadow-xs"
                      transition={reduce ? { duration: 0 } : { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                      aria-hidden
                    >
                      {!collapsed && (
                        <span className="absolute inset-y-2 left-0 w-[2.5px] rounded-full bg-gradient-to-b from-accent to-accent-2" />
                      )}
                    </motion.span>
                  )}
                  <Link
                    href={to}
                    title={collapsed ? label : undefined}
                    className={`relative z-10 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                      collapsed ? 'justify-center' : ''
                    } ${
                      pathname === to
                        ? 'font-medium text-t1'
                        : 'text-t2 hover:bg-surface-2/70 hover:text-t1'
                    }`}
                  >
                    <Icon className="shrink-0 transition-transform duration-150 group-hover:scale-105" style={{ width: 16, height: 16 }} />
                    {!collapsed && <span className="flex-1 truncate tracking-[-0.01em]">{label}</span>}
                    {badge &&
                      (collapsed ? (
                        activeCount > 0 && (
                          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--mv-accent)] pulse-dot" aria-hidden />
                        )
                      ) : (
                        activeCount > 0 && (
                          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent-text ring-1 ring-accent/30">
                            {activeCount}
                          </span>
                        )
                      ))}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-3">
        <button
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-t3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 hover:bg-surface-2/70 hover:text-t1 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          {collapsed ? <PanelLeftOpen style={{ width: 15, height: 15 }} /> : <PanelLeftClose style={{ width: 15, height: 15 }} />}
          {!collapsed && <span>Collapse</span>}
        </button>
        {!collapsed && (
          <p className="mt-1.5 flex items-center gap-1.5 px-2.5 text-[10px] text-t3">
            <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px_var(--mv-ok)]" aria-hidden />
            Local-first · zero telemetry
          </p>
        )}
      </div>
    </nav>
  );
}

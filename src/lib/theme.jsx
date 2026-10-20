'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './ipc.js';

const ThemeCtx = createContext({ theme: 'dark', resolved: 'dark', setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const t = localStorage.getItem('mv-theme');
      return t === 'light' || t === 'dark' || t === 'system' ? t : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [systemDark, setSystemDark] = useState(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return true; // server render / no window
    }
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.classList.toggle('dark', resolved === 'dark');
    api.window.setTheme(resolved).catch(() => {});
  }, [resolved]);

  const setTheme = useCallback((t) => {
    if (!['dark', 'light', 'system'].includes(t)) return;
    try {
      localStorage.setItem('mv-theme', t);
    } catch {}
    setThemeState(t);
  }, []);

  return <ThemeCtx.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

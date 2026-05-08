import { useEffect, useState, useCallback } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'ui_theme_v1';

function load(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* noop */ }
  return 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(load);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem(KEY, theme); } catch { /* noop */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme(t => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, setTheme, toggle };
}

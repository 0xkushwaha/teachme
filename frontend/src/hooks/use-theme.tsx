'use client';
import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('system');
  useEffect(() => {
    try {
      setThemeState((localStorage.getItem('tm-theme') as Theme) ?? 'system');
    } catch {}
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem('tm-theme', t);
    } catch {}
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, []);
  return { theme, setTheme };
}

/** Inline script applied before paint to avoid a theme flash. */
export const themeScript = `try{var t=localStorage.getItem('tm-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

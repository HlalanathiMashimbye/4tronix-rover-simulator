'use client';

/**
 * Theme Context Provider
 *
 * Light/dark mode, defaulting to the OS preference and persisted once a
 * learner picks one explicitly. The actual decision of which theme to start
 * with happens in a beforeInteractive inline script (see layout.tsx) that
 * runs before hydration and sets data-theme on <html> directly - this
 * context reads that already-correct value on mount rather than re-deriving
 * it, so there is no hydration mismatch and no flash of the wrong theme.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 'dark' matches :root's fallback value in globals.css - only relevant for
  // the instant before the effect below reads what the inline script already
  // set. Never rendered: the script runs before this component ever mounts.
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the value the beforeInteractive script already applied, not re-deriving it
    if (current === 'light' || current === 'dark') setTheme(current);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable - the toggle still works for this session
    }
    setTheme(next);
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

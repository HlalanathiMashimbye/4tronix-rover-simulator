'use client';

/**
 * Search and filter state, lifted out of the feed so the navbar can own the UI.
 *
 * The control lives in the navbar but the DATA lives on the page - only the
 * feed knows how many missions are completed, or which are favourites. So the
 * page publishes its filters here and the navbar renders whatever it finds.
 *
 * That inversion is also what makes the bar disappear on its own. There is no
 * per-route allowlist to keep in sync: a page that never registers filters
 * (Create Mission, a mission detail page) leaves the registry empty and the
 * navbar renders nothing. Adding a searchable page later needs no navbar
 * change.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SearchFilter {
  key: string;
  label: string;
  count: number;
  icon: LucideIcon;
}

/**
 * Which control the learner last touched. The feed's entrance stagger replays
 * on a filter change but must NOT replay on every keystroke, and once the
 * query input moved into the navbar the page could no longer tell the two
 * apart from the values alone.
 */
type LastChange = 'query' | 'filter' | null;

interface SearchContextValue {
  query: string;
  setQuery: (q: string) => void;
  activeFilter: string;
  setActiveFilter: (k: string) => void;
  filters: SearchFilter[];
  setFilters: (f: SearchFilter[]) => void;
  lastChange: LastChange;
}

const SearchContext = createContext<SearchContextValue | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQueryState] = useState('');
  const [activeFilter, setActiveFilterState] = useState('all');
  const [filters, setFilters] = useState<SearchFilter[]>([]);
  const [lastChange, setLastChange] = useState<LastChange>(null);

  const setQuery = useCallback((q: string) => {
    setLastChange('query');
    setQueryState(q);
  }, []);

  const setActiveFilter = useCallback((k: string) => {
    setLastChange('filter');
    setActiveFilterState(k);
  }, []);

  const value = useMemo(
    () => ({ query, setQuery, activeFilter, setActiveFilter, filters, setFilters, lastChange }),
    [query, setQuery, activeFilter, setActiveFilter, filters, lastChange],
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearch must be used within a SearchProvider');
  return ctx;
}

/**
 * Publish this page's filters to the navbar, and withdraw them on unmount so
 * the bar disappears when navigating to a page without searchable content.
 *
 * Keyed on the filter keys and counts rather than the array itself: callers
 * build a fresh array every render, so depending on its identity would set
 * state on every render and loop forever.
 */
export function useRegisterSearchFilters(filters: SearchFilter[]) {
  const { setFilters } = useSearch();
  const signature = filters.map((f) => `${f.key}:${f.count}`).join('|');

  useEffect(() => {
    setFilters(filters);
    return () => setFilters([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above: identity would loop, the signature is the real dependency
  }, [signature, setFilters]);
}

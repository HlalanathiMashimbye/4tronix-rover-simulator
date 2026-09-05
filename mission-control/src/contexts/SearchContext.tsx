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
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';

import {
  DEFAULT_MISSION_SORT,
  isMissionSort,
  type MissionSort,
} from '@/core/domain/services/missionSort';

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
  /** How the current page's list is ordered. */
  sort: MissionSort;
  setSort: (s: MissionSort) => void;
  /** Whether this page sorts at all, so the navbar knows to offer it. */
  sortable: boolean;
  setSortable: (on: boolean) => void;
}

const SearchContext = createContext<SearchContextValue | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQueryState] = useState('');
  const [activeFilter, setActiveFilterState] = useState('all');
  const [filters, setFilters] = useState<SearchFilter[]>([]);
  const [lastChange, setLastChange] = useState<LastChange>(null);
  const [sort, setSortState] = useState<MissionSort>(DEFAULT_MISSION_SORT);
  const [sortable, setSortable] = useState(false);
  const pathname = usePathname();

  const setQuery = useCallback((q: string) => {
    setLastChange('query');
    setQueryState(q);
  }, []);

  const setActiveFilter = useCallback((k: string) => {
    setLastChange('filter');
    setActiveFilterState(k);
  }, []);

  const setSort = useCallback((next: MissionSort) => {
    setLastChange('filter');
    setSortState(isMissionSort(next) ? next : DEFAULT_MISSION_SORT);
  }, []);

  /**
   * Start every page with a clean search.
   *
   * This state is app-wide because the controls live in the navbar, and it
   * used to survive navigation: going from the operator console to the site
   * carried the typed query AND the selected filter with it. The filter keys
   * are not shared between pages, so arriving at the feed still holding the
   * console's "Done" or "Needs review" left it filtering on a key the feed has
   * never heard of, and the learner saw an empty page with no explanation and
   * no visible filter to clear.
   *
   * Reset on the pathname rather than on unmount of any one page, because the
   * provider outlives every page and no page can know what comes after it.
   */
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    // Adjusted during render, not in an effect. An effect runs AFTER the new
    // page has rendered, so the feed would paint one frame filtered by the
    // console's stale key - an empty list that then fills in. Resetting here
    // means the new page's first render already sees a clean search. This is
    // React's documented pattern for resetting state when a prop changes.
    setLastPath(pathname);
    setQueryState('');
    setActiveFilterState('all');
    setSortState(DEFAULT_MISSION_SORT);
    setLastChange(null);
  }

  const value = useMemo(
    () => ({
      query, setQuery, activeFilter, setActiveFilter, filters, setFilters,
      lastChange, sort, setSort, sortable, setSortable,
    }),
    [query, setQuery, activeFilter, setActiveFilter, filters, lastChange, sort, setSort, sortable],
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

/**
 * Declare that this page's list can be reordered, so the navbar offers the
 * control. Withdrawn on unmount for the same reason the filters are: a page
 * that does not sort must not show a sort control that does nothing.
 */
export function useRegisterSort() {
  const { setSortable } = useSearch();

  useEffect(() => {
    setSortable(true);
    return () => setSortable(false);
  }, [setSortable]);
}

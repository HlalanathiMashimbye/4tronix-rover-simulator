'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { Plus, Rocket, Star, Grid2x2, CircleCheckBig, Hourglass } from 'lucide-react';
import { browserMissionRepository } from '@/infrastructure/container.browser';
import { Mission } from '@/core/domain/entities/Mission';
import { MissionCursor } from '@/core/domain/repositories/IMissionRepository';
import { getDiscoveryStatus, type DiscoveryStatus } from '@/core/domain/services/discoveryStatus';
import { useFavorites } from '@/hooks/useFavorites';
import { MissionCard } from '@/components/MissionCard/MissionCard';
import { StaggeredEntrance } from '@/components/ui/StaggeredEntrance';
import { useSearch, useRegisterSearchFilters } from '@/contexts/SearchContext';
import { useRegisterSort } from '@/contexts/SearchContext';
import { sortMissions } from '@/core/domain/services/missionSort';

type StatusFilter = 'all' | 'favorites' | DiscoveryStatus;

const STATUS_FILTERS: StatusFilter[] = ['all', 'favorites', 'Completed', 'Pending'];

function isStatusFilter(value: string): value is StatusFilter {
  return (STATUS_FILTERS as string[]).includes(value);
}

/**
 * Missions per page. Each page costs FEED_SIZE + 1 Firestore reads (the extra
 * one detects whether another page exists without a separate count query), so
 * this is pay-as-you-scroll rather than paying up front for rows nobody sees.
 */
const FEED_SIZE = 24;

/**
 * How many extra pages one "keep looking" walks before stopping.
 *
 * 20 pages is roughly 500 missions, several times the whole archive as it
 * stands. It exists so a search cannot turn into an unbounded read bill on a
 * collection that only ever grows.
 */
const ARCHIVE_SEARCH_PAGES = 20;

/** The one definition of what the search box matches. */
function matchesQuery(missions: Mission[], query: string): Mission[] {
  const q = query.trim().toLowerCase();
  if (!q) return missions;
  return missions.filter(
    (m) => (m.name ?? '').toLowerCase().includes(q) || m.code.toLowerCase().includes(q),
  );
}

interface MissionFeedProps {
  /**
   * Fired once a "Show more missions" click has actually loaded a further
   * page. Only the Progressive Challenges workspace supplies this - it is
   * how Challenge 1's "browse further" step observes the real load-more
   * button being used, without SearchContext needing to know that page-2
   * checklist exists.
   */
  onLoadMore?: () => void;
  /**
   * Reports whether a further page exists, every time that becomes known
   * (initial load, and after each load-more). Only the Progressive
   * Challenges workspace supplies this - it is how Challenge 1's "browse
   * further" step can also complete on a database with 24 or fewer
   * missions, where the "Show more missions" button never renders at all
   * because there is nothing further to fetch.
   */
  onFeedState?: (state: { hasMore: boolean }) => void;
}

/**
 * The mission discovery feed: search, status filters, and a page of cards.
 *
 * Extracted from app/page.tsx so the SAME component renders both the real
 * home page and Challenge 1's embedded-platform workspace panel - the
 * Progressive Challenges brief asks for the real platform, not a lookalike.
 */
export function MissionFeed({ onLoadMore, onFeedState }: MissionFeedProps) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [cursor, setCursor] = useState<MissionCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchingArchive, setSearchingArchive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Search and filter state lives in SearchContext because the controls now
  // live in the navbar; this page still owns the DATA they filter.
  const { query, setQuery, activeFilter, setActiveFilter, lastChange, sort } = useSearch();
  useRegisterSort();
  /**
   * Validated, not cast.
   *
   * This was `activeFilter as StatusFilter`, and the filter keys are not
   * shared between pages: the operator console registers 'done' and 'review',
   * which are not StatusFilter values at all. Carrying one of those over from
   * the console left this line asserting a type the value did not have, and
   * the feed then filtered on a key nothing matches - an empty page, with no
   * filter visible to clear because the console's chips had unregistered
   * themselves on the way out.
   *
   * SearchContext now resets on navigation, so this should not arise. It is
   * validated anyway: a cast that is only correct because of something another
   * file does is the kind that comes back.
   */
  const statusFilter: StatusFilter = isStatusFilter(activeFilter) ? activeFilter : 'all';
  const { favorites, isFavorite } = useFavorites();
  const reduceMotion = useReducedMotion();
  // Cards remounting purely because a live search narrowed the list should not
  // replay the entrance stagger - that fires on every keystroke, well past the
  // "occasional" tier the effect is meant for. A filter click SHOULD replay it.
  // Derived from which control was last touched rather than set by hand, since
  // the controls now live in the navbar and no longer share a handler here.
  const skipEntrance = lastChange === 'query';

  useEffect(() => {
    const loadMissions = async () => {
      const timeoutId = setTimeout(() => {
        console.warn('[MissionFeed] Mission loading is taking longer than expected (>10s)');
      }, 10000);

      try {
        const repository = browserMissionRepository();
        // findRecent reads one page. findAll fetched 100 documents to render 24
        // and then ran a COUNT aggregation per queued mission for positions
        // this page never displays - roughly 125 reads per view, and why the
        // feed sat on a spinner for ~30 seconds.
        const page = await repository.findRecent(FEED_SIZE);

        setMissions(page.missions);
        setCursor(page.nextCursor);
        setError(null);
        onFeedState?.({ hasMore: page.nextCursor !== null });
      } catch (err) {
        console.error('[MissionFeed] Failed to load missions:', err);
        let errorMessage = 'Failed to load missions. ';

        if (err instanceof Error) {
          errorMessage += err.message;
          if (err.message.includes('Missing or insufficient permissions')) {
            errorMessage = 'Database permissions error. Please check Firestore security rules.';
          } else if (err.message.includes('projectId')) {
            errorMessage = 'Firebase is not configured. Please set up environment variables.';
          } else if (err.message.includes('network') || err.message.includes('fetch')) {
            errorMessage = 'Network error. Please check your internet connection.';
          }
        } else {
          errorMessage += 'Unknown error occurred.';
        }

        setError(errorMessage);
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    };

    loadMissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount; onFeedState is only ever called through its stable setState closure, so an older reference behaves identically to a newer one
  }, []);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const repository = browserMissionRepository();
      const page = await repository.findRecent(FEED_SIZE, cursor);

      // Guard against a mission appearing twice if one was inserted between
      // pages: the cursor is stable, but a re-render could still double up.
      setMissions((current) => {
        const seen = new Set(current.map((m) => m.id));
        return [...current, ...page.missions.filter((m) => !seen.has(m.id))];
      });
      setCursor(page.nextCursor);
      onFeedState?.({ hasMore: page.nextCursor !== null });
      onLoadMore?.();
    } catch (err) {
      console.error('[MissionFeed] Failed to load more missions:', err);
      setError('Could not load more missions. Check your connection and try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  /**
   * Keep fetching pages until the current search finds something.
   *
   * WHY THIS HAS TO EXIST. The filter below runs over the missions already
   * loaded, which is 24 on arrival. Everything older was simply unfindable:
   * searching for a mission from last month returned "No missions match", and
   * the child was told their own work did not exist. It got worse every week,
   * because every new submission pushed another mission out of the window -
   * which is precisely the thing this story is named after.
   *
   * Driven by an explicit tap rather than by typing. Firestore bills per
   * document, so walking the archive on every keystroke would put a real cost
   * on an idle habit. On a deliberate "keep looking" it is bounded and worth it.
   *
   * CAPPED, and the cap is admitted to the learner rather than hidden. Without
   * a search index this is a linear walk, so at some archive size the honest
   * answer is "I looked through this much and stopped". Better than paging
   * forever, and far better than the confident lie it replaces.
   */
  const searchArchive = async () => {
    if (searchingArchive) return;
    setSearchingArchive(true);
    setError(null);

    try {
      const repository = browserMissionRepository();
      let nextCursor = cursor;
      let pagesFetched = 0;
      let pool: Mission[] = missions;

      while (nextCursor && pagesFetched < ARCHIVE_SEARCH_PAGES) {
        const page = await repository.findRecent(FEED_SIZE, nextCursor);
        pagesFetched += 1;

        const seen = new Set(pool.map((m) => m.id));
        pool = [...pool, ...page.missions.filter((m) => !seen.has(m.id))];
        nextCursor = page.nextCursor;

        setMissions(pool);
        setCursor(nextCursor);

        if (matchesQuery(pool, query).length > 0) break;
      }
    } catch (err) {
      console.error('[MissionFeed] Archive search failed:', err);
      setError('Could not search older missions. Check your connection and try again.');
    } finally {
      setSearchingArchive(false);
    }
  };

  const counts = useMemo(() => {
    let completed = 0;
    for (const m of missions) {
      if (getDiscoveryStatus(m.status) === 'Completed') completed += 1;
    }
    return { all: missions.length, Completed: completed, Pending: missions.length - completed };
  }, [missions]);

  const filtered = useMemo(() => {
    const named = matchesQuery(missions, query);
    return named.filter((m) => {
      if (statusFilter === 'favorites' && !isFavorite(m.id)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'favorites' && getDiscoveryStatus(m.status) !== statusFilter) return false;
      return true;
    });
  }, [missions, query, statusFilter, isFavorite]);

  // Ordered with the same rule the operator console uses, so "most recent"
  // means the same thing on both. Applied to what has loaded: the feed pages
  // from the server newest-first, so a different ordering reorders the pages
  // fetched so far rather than reaching back for older ones.
  const ordered = useMemo(() => sortMissions(filtered, sort), [filtered, sort]);

  const filters: { key: StatusFilter; label: string; count: number; icon: typeof Star }[] = [
    { key: 'all', label: 'All missions', count: counts.all, icon: Grid2x2 },
    { key: 'favorites', label: 'Favorite missions', count: favorites.length, icon: Star },
    { key: 'Completed', label: 'Completed missions', count: counts.Completed, icon: CircleCheckBig },
    { key: 'Pending', label: 'Pending missions', count: counts.Pending, icon: Hourglass },
  ];

  // Published to the navbar, which renders the search field and these chips.
  // Withdrawn on unmount, so the bar disappears on pages without a feed.
  useRegisterSearchFilters(filters);

  return (
    <section className="mx-auto min-h-0 w-full max-w-page flex-1 overflow-y-auto scroll-panel pt-4 pb-5">
      {loading ? (
        <div className="flex justify-center py-24">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-border border-t-primary" />
        </div>
      ) : error ? (
        <div className="mx-auto mt-10 max-w-2xl rounded-3xl border border-destructive/40 bg-destructive/10 p-8 text-center clay">
          <h3 className="font-display text-lg font-bold text-destructive">Unable to load missions</h3>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="clay clay-press mt-6 inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-2.5 font-display text-sm font-bold text-primary-foreground"
          >
            Retry
          </button>
        </div>
      ) : missions.length === 0 ? (
        <EmptyState
          title="No missions yet"
          subtitle="Be the first to send a rover across Mars."
          cta
        />
      ) : ordered.length === 0 ? (
        /* "No missions match" was a lie whenever older pages existed. The
           feed had only looked at the 24 it happened to have loaded, and
           every new submission pushed one more mission out of reach, so a
           child searching for their own work was told it did not exist.
           Say what was actually searched, and offer to search further. */
        <EmptyState
          title={cursor && query ? 'Not in the missions loaded so far' : 'No missions match'}
          subtitle={
            cursor && query
              ? `Searched the ${missions.length} most recent missions. Older ones have not been looked at yet.`
              : 'Try a different name, code, or filter.'
          }
          onSearchArchive={cursor && query ? searchArchive : undefined}
          searching={searchingArchive}
          onClear={() => {
            // Clears the navbar's controls; setActiveFilter marks this as a
            // filter change, so the stagger replays on the restored list.
            setQuery('');
            setActiveFilter('all');
          }}
        />
      ) : (
        <div className="grid gap-3 pt-1 grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))]">
          {ordered.map((mission, index) => (
            <StaggeredEntrance
              key={mission.id}
              index={index}
              skipEntrance={skipEntrance}
              reduceMotion={reduceMotion}
            >
              <MissionCard mission={mission} />
            </StaggeredEntrance>
          ))}
        </div>
      )}

      {/* Only when another page exists, and never while a filter or search is
          narrowing the view - "load more" there would look like it failed,
          since the next page may contain nothing matching. */}
      {cursor && !query && statusFilter === 'all' && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="clay clay-press min-h-11 rounded-xl border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Show more missions'}
          </button>
        </div>
      )}
    </section>
  );
}

function EmptyState({
  title,
  subtitle,
  cta,
  onClear,
  onSearchArchive,
  searching,
}: {
  title: string;
  subtitle: string;
  cta?: boolean;
  onClear?: () => void;
  onSearchArchive?: () => void;
  searching?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card/60 clay">
        <Rocket className="h-8 w-8 text-primary" />
      </div>
      <p className="mt-5 font-display text-xl font-bold text-foreground">{title}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
      {cta && (
        <Link
          href="/mission"
          className="clay clay-press mt-6 inline-flex items-center gap-2 rounded-2xl bg-gradient-mars px-5 py-2.5 font-display text-sm font-bold text-primary-foreground"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Create Mission
        </Link>
      )}
      {onSearchArchive && (
        <button
          onClick={onSearchArchive}
          disabled={searching}
          className="clay clay-press mt-6 inline-flex items-center gap-2 rounded-2xl bg-gradient-mars px-5 py-2.5 font-display text-sm font-bold text-primary-foreground disabled:opacity-60"
        >
          {searching ? 'Looking through older missions…' : 'Search older missions'}
        </button>
      )}
      {onClear && (
        <button
          onClick={onClear}
          className="clay-press mt-6 rounded-2xl border border-border bg-card/50 px-5 py-2.5 text-sm font-semibold text-foreground"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

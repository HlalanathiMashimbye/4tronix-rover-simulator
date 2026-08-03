'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { Plus, Rocket, Star, Grid2x2, CircleCheckBig, Hourglass } from 'lucide-react';
import { Mission } from '@/core/domain/entities/Mission';
import { MissionCursor } from '@/core/domain/repositories/IMissionRepository';
import { getFirestoreClient } from '@/lib/firebase';
import { FirestoreMissionRepository } from '@/infrastructure/persistence/FirestoreMissionRepository';
import { getDiscoveryStatus, type DiscoveryStatus } from '@/lib/discoveryStatus';
import { useFavorites } from '@/lib/useFavorites';
import { MissionCard } from '@/components/MissionCard/MissionCard';
import { StaggeredEntrance } from '@/components/ui/StaggeredEntrance';
import { useSearch, useRegisterSearchFilters } from '@/contexts/SearchContext';

type StatusFilter = 'all' | 'favorites' | DiscoveryStatus;

/**
 * Missions per page. Each page costs FEED_SIZE + 1 Firestore reads (the extra
 * one detects whether another page exists without a separate count query), so
 * this is pay-as-you-scroll rather than paying up front for rows nobody sees.
 */
const FEED_SIZE = 24;

export default function LandingPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [cursor, setCursor] = useState<MissionCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Search and filter state lives in SearchContext because the controls now
  // live in the navbar; this page still owns the DATA they filter.
  const { query, setQuery, activeFilter, setActiveFilter, lastChange } = useSearch();
  const statusFilter = activeFilter as StatusFilter;
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
        console.warn('[Landing] Mission loading is taking longer than expected (>10s)');
      }, 10000);

      try {
        const repository = new FirestoreMissionRepository(getFirestoreClient());
        // findRecent reads one page. findAll fetched 100 documents to render 24
        // and then ran a COUNT aggregation per queued mission for positions
        // this page never displays - roughly 125 reads per view, and why the
        // feed sat on a spinner for ~30 seconds.
        const page = await repository.findRecent(FEED_SIZE);

        setMissions(page.missions);
        setCursor(page.nextCursor);
        setError(null);
      } catch (err) {
        console.error('[Landing] Failed to load missions:', err);
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
  }, []);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const repository = new FirestoreMissionRepository(getFirestoreClient());
      const page = await repository.findRecent(FEED_SIZE, cursor);

      // Guard against a mission appearing twice if one was inserted between
      // pages: the cursor is stable, but a re-render could still double up.
      setMissions((current) => {
        const seen = new Set(current.map((m) => m.id));
        return [...current, ...page.missions.filter((m) => !seen.has(m.id))];
      });
      setCursor(page.nextCursor);
    } catch (err) {
      console.error('[Landing] Failed to load more missions:', err);
      setError('Could not load more missions. Check your connection and try again.');
    } finally {
      setLoadingMore(false);
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
    const q = query.trim().toLowerCase();
    return missions.filter((m) => {
      if (statusFilter === 'favorites' && !isFavorite(m.id)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'favorites' && getDiscoveryStatus(m.status) !== statusFilter) return false;
      if (!q) return true;
      return (m.name ?? '').toLowerCase().includes(q) || m.code.toLowerCase().includes(q);
    });
  }, [missions, query, statusFilter, isFavorite]);

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
    <main className="relative flex h-[calc(100vh-64px)] flex-col overflow-hidden px-4 sm:px-6">
      {/* Feed: the only thing that scrolls */}
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
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No missions match"
            subtitle="Try a different name, code, or filter."
            onClear={() => {
              // Clears the navbar's controls; setActiveFilter marks this as a
              // filter change, so the stagger replays on the restored list.
              setQuery('');
              setActiveFilter('all');
            }}
          />
        ) : (
          <div className="grid gap-3 pt-1 grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))]">
            {filtered.map((mission, index) => (
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
    </main>
  );
}

function EmptyState({
  title,
  subtitle,
  cta,
  onClear,
}: {
  title: string;
  subtitle: string;
  cta?: boolean;
  onClear?: () => void;
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

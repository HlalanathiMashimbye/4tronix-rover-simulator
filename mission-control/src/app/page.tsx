'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { Search, X, Plus, Rocket, Star } from 'lucide-react';
import { Mission } from '@/core/domain/entities/Mission';
import { MissionCursor } from '@/core/domain/repositories/IMissionRepository';
import { getFirestoreClient } from '@/lib/firebase';
import { FirestoreMissionRepository } from '@/infrastructure/persistence/FirestoreMissionRepository';
import { getDiscoveryStatus, type DiscoveryStatus } from '@/lib/discoveryStatus';
import { useFavorites } from '@/lib/useFavorites';
import { MissionCard } from '@/components/MissionCard/MissionCard';
import { ActivePillBackground } from '@/components/ui/ActivePillBackground';
import { StaggeredEntrance } from '@/components/ui/StaggeredEntrance';

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
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const { favorites, isFavorite } = useFavorites();
  const reduceMotion = useReducedMotion();
  // Cards remounting purely because a live search narrowed/widened the list
  // should not replay the entrance stagger - that recomputes on every
  // keystroke, well past the "occasional" tier the effect is meant for. Set
  // alongside setQuery/setStatusFilter in the same handler so React batches
  // both into the one re-render the stagger actually reads.
  const [skipEntrance, setSkipEntrance] = useState(false);

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

  const filters: { key: StatusFilter; label: string; count: number; icon?: typeof Star }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'favorites', label: 'Favorites', count: favorites.length, icon: Star },
    { key: 'Completed', label: 'Completed', count: counts.Completed },
    { key: 'Pending', label: 'Pending', count: counts.Pending },
  ];

  return (
    <main className="relative flex h-[calc(100vh-64px)] flex-col overflow-hidden px-4 sm:px-6">
      {/* Header (the Create Mission action lives in the navbar) */}
      <header className="mx-auto w-full max-w-page shrink-0 pt-4 pb-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Mission <span className="text-gradient-mars">Feed</span>
        </h1>
        <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
          Watch real rovers run the code kids wrote on Mars.
        </p>
      </header>

      {/* Toolbar: search + status filters */}
      <div className="mx-auto flex w-full max-w-page shrink-0 flex-col gap-2.5 pb-3 md:flex-row md:items-center">
        <div className="relative md:max-w-xs md:flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setSkipEntrance(true);
              setQuery(e.target.value);
            }}
            placeholder="Search missions"
            aria-label="Search missions by name or code"
            className="w-full rounded-full border border-border/60 bg-card/60 py-2.5 pl-10 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
          />
          {query && (
            <button
              onClick={() => {
                setSkipEntrance(true);
                setQuery('');
              }}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2" role="group" aria-label="Filter missions by status">
          {filters.map((f) => {
            const active = statusFilter === f.key;
            const Icon = f.icon;
            return (
              <button
                key={f.key}
                onClick={() => {
                  setSkipEntrance(false);
                  setStatusFilter(f.key);
                }}
                aria-pressed={active}
                className={`relative isolate inline-flex items-center gap-1.5 overflow-hidden rounded-full px-3.5 py-2 text-sm font-bold transition-colors ${
                  active
                    ? 'text-primary-foreground'
                    : 'border border-border/70 bg-card/50 text-muted-foreground hover:text-foreground'
                }`}
              >
                {active && (
                  <ActivePillBackground layoutId="feed-filter-pill" className="rounded-full bg-gradient-mars" reduceMotion={reduceMotion} />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {f.label}
                  <span
                    className={`rounded-full px-1.5 text-xs tabular-nums ${
                      active ? 'bg-black/20 text-primary-foreground' : 'bg-background/60 text-muted-foreground'
                    }`}
                  >
                    {f.count}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed: the only thing that scrolls */}
      <section className="mx-auto min-h-0 w-full max-w-page flex-1 overflow-y-auto scroll-panel pb-5">
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
              setSkipEntrance(false);
              setQuery('');
              setStatusFilter('all');
            }}
          />
        ) : (
          <div className="grid gap-5 pt-1 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
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

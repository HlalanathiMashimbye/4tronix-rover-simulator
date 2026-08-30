'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { Rocket, Plus, Star, Grid2x2, CircleCheckBig, Hourglass } from 'lucide-react';
import { getLearnerID } from '@/lib/getLearnerID';
import {
  subscribeMissionsByLearnerId,
  subscribeMissionsByLearnerEmail,
} from '@/lib/services/missionQueryService';
import { Mission } from '@/core/domain/entities/Mission';
import { MissionCard } from '@/components/MissionCard/MissionCard';
import { MobileSearch } from '@/components/layout/MobileSearch';
import { StaggeredEntrance } from '@/components/ui/StaggeredEntrance';
import { useLearner } from '@/contexts/LearnerContext';
import { useSearch, useRegisterSearchFilters } from '@/contexts/SearchContext';
import { getDiscoveryStatus } from '@/lib/discoveryStatus';
import { useFavorites } from '@/lib/useFavorites';

export function MissionHistory() {
  const { learnerEmail, openEmailPrompt } = useLearner();
  const reduceMotion = useReducedMotion();
  // Same navbar control as the feed, deliberately: identical chips in the same
  // place doing the same thing beats a second, subtly different filter set.
  const { query, activeFilter, lastChange } = useSearch();
  const { favorites, isFavorite } = useFavorites();
  const skipEntrance = lastChange === 'query';

  // Missions for this browser (by learner id) and, if an email is set, missions
  // submitted under that email on any device. We keep them separate and merge
  // so a learner sees their full history regardless of which one a mission was
  // stamped with.
  const [byId, setById] = useState<Mission[]>([]);
  const [byEmail, setByEmail] = useState<Mission[]>([]);
  const [idLoaded, setIdLoaded] = useState(false);
  const [emailLoaded, setEmailLoaded] = useState(false);

  useEffect(() => {
    // Async now: the id is hashed before querying, because missions carry only
    // learnerRef. Same teardown guard as the email subscription below - the
    // effect can be torn down before the hash resolves, which would otherwise
    // leak a live listener.
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    subscribeMissionsByLearnerId(getLearnerID(), (missions) => {
      setById(missions);
      setIdLoaded(true);
    })
      .then((unsub) => {
        if (cancelled) {
          unsub();
          return;
        }
        unsubscribe = unsub;
      })
      .catch((error) => {
        console.error('Failed to initialize mission history:', error);
        setIdLoaded(true);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!learnerEmail) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no email set, so this source is trivially settled
      setByEmail([]);
      setEmailLoaded(true);
      return;
    }
    setEmailLoaded(false);

    // Hashing the address is async, so the subscription is established after an
    // await. Guard against the effect being torn down (or the email changing)
    // before it resolves, which would otherwise leak a live listener.
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    subscribeMissionsByLearnerEmail(learnerEmail, (missions) => {
      setByEmail(missions);
      setEmailLoaded(true);
    })
      .then((unsub) => {
        if (cancelled) {
          unsub();
          return;
        }
        unsubscribe = unsub;
      })
      .catch((error) => {
        console.error('Failed to subscribe to missions by email:', error);
        setByEmail([]);
        setEmailLoaded(true);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [learnerEmail]);

  const missions = useMemo(() => {
    const merged = new Map<string, Mission>();
    for (const mission of [...byId, ...byEmail]) {
      merged.set(mission.id, mission);
    }
    return Array.from(merged.values()).sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }, [byId, byEmail]);

  const counts = useMemo(() => {
    let completed = 0;
    for (const m of missions) {
      if (getDiscoveryStatus(m.status) === 'Completed') completed += 1;
    }
    return { all: missions.length, Completed: completed, Pending: missions.length - completed };
  }, [missions]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return missions.filter((m) => {
      if (activeFilter === 'favorites' && !isFavorite(m.id)) return false;
      if (activeFilter !== 'all' && activeFilter !== 'favorites'
          && getDiscoveryStatus(m.status) !== activeFilter) return false;
      if (!q) return true;
      return (m.name ?? '').toLowerCase().includes(q) || m.code.toLowerCase().includes(q);
    });
  }, [missions, query, activeFilter, isFavorite]);

  // Counts are this page's own, so the chips describe the learner's history
  // rather than the public feed. Withdrawn on unmount by the hook.
  useRegisterSearchFilters(
    useMemo(
      () => [
        { key: 'all', label: 'All missions', count: counts.all, icon: Grid2x2 },
        { key: 'favorites', label: 'Favorite missions', count: favorites.length, icon: Star },
        { key: 'Completed', label: 'Completed missions', count: counts.Completed, icon: CircleCheckBig },
        { key: 'Pending', label: 'Pending missions', count: counts.Pending, icon: Hourglass },
      ],
      [counts, favorites.length],
    ),
  );

  const isLoading = !idLoaded || !emailLoaded;

  // Banner: prompt for an email when none is set, or show which email is in use.
  const emailBanner = learnerEmail ? (
    <div className="flex shrink-0 items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card/50 px-5 py-3 text-sm">
      <p className="min-w-0 text-muted-foreground">
        Showing missions for{' '}
        <span className="font-semibold text-foreground">{learnerEmail}</span> (synced across your devices).
      </p>
      <button
        onClick={openEmailPrompt}
        className="clay-press shrink-0 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-foreground"
      >
        Change
      </button>
    </div>
  ) : (
    <div className="flex shrink-0 items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-primary/10 px-5 py-3 text-sm">
      <p className="min-w-0 text-foreground">
        Add your email to see your missions on any device.
      </p>
      <button
        onClick={openEmailPrompt}
        className="clay clay-press shrink-0 rounded-full bg-gradient-mars px-3.5 py-1.5 text-xs font-bold text-primary-foreground"
      >
        Add email
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {emailBanner}
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/30 p-8 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Loading your missions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {emailBanner}

      {/* Phone-only: the navbar's search is hidden below md, so this page had
          no way to search or filter a learner's own history there. */}
      <MobileSearch />

      {missions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card/60 clay">
            <Rocket className="h-8 w-8 text-primary" />
          </div>
          <p className="mt-5 font-display text-xl font-bold text-foreground">No missions yet</p>
          <p className="mt-1.5 text-sm text-muted-foreground">Build your first mission and it will show up here.</p>
          <Link
            href="/mission"
            className="clay clay-press mt-6 inline-flex items-center gap-2 rounded-2xl bg-gradient-mars px-5 py-2.5 font-display text-sm font-bold text-primary-foreground"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Create Mission
          </Link>
        </div>
      ) : visible.length === 0 ? (
        // Distinct from "No missions yet" above: the learner HAS missions, the
        // navbar's search or filter just excluded all of them. Telling them to
        // build their first mission here would be wrong and a bit insulting.
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card/60 clay">
            <Rocket className="h-8 w-8 text-primary" />
          </div>
          <p className="mt-5 font-display text-xl font-bold text-foreground">No missions match</p>
          <p className="mt-1.5 text-sm text-muted-foreground">Try a different name, code, or filter.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto scroll-panel pb-1">
          <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
            {visible.map((mission, index) => (
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
        </div>
      )}
    </div>
  );
}

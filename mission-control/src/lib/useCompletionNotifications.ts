'use client';

/**
 * The notification bell's data.
 *
 * Shows completed missions from the whole yard, not just the current learner's:
 * a learner's own results reach them by email, and there is no login here, so
 * "scoped to me" would leave the bell permanently empty for most people.
 *
 * Read cost is one Firestore listener over a handful of documents (see
 * COMPLETION_FEED_LIMIT), attached once per session because the Navbar mounts
 * in the root layout and survives client-side navigation. After it attaches,
 * only an actual completion costs anything.
 *
 * What counts as unread lives in localStorage, not Firestore: it is a property
 * of this browser, nobody else needs it, and writing it server-side would mean
 * a document per visitor for something worth nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Mission } from '@/core/domain/entities/Mission';
import { subscribeRecentCompletions } from '@/lib/services/missionQueryService';

const SEEN_KEY = 'mars-rover-notifications-seen';
const DISMISSED_KEY = 'mars-rover-notifications-dismissed';

/** Cap on remembered dismissals, so this cannot grow forever. */
const DISMISSED_LIMIT = 50;

export interface CompletionNotification {
  id: string;
  missionName: string;
  completedAt: string;
}

/**
 * Which completions count as unread. Pure, and exported for its own test:
 * this is the whole rule the bell runs on, and it is easy to get subtly wrong
 * in ways that either nag forever or never light up at all.
 */
export function selectUnread(
  completions: Mission[],
  seenAt: string | null,
  dismissed: string[]
): CompletionNotification[] {
  if (!seenAt) return [];
  return completions
    .filter((m) => {
      if (dismissed.includes(m.id)) return false;
      // String comparison is safe here and cheaper than parsing: these are ISO
      // timestamps, which sort lexicographically in the same order as in time.
      return typeof m.completedAt === 'string' && m.completedAt > seenAt;
    })
    .map((m) => ({
      id: m.id,
      missionName: m.name?.trim() || 'Untitled mission',
      completedAt: m.completedAt as string,
    }));
}

function readDismissed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function useCompletionNotifications() {
  const [completions, setCompletions] = useState<Mission[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  // Hydrate from localStorage after mount: it does not exist during SSR, and
  // reading it in render would make the server and client disagree.
  useEffect(() => {
    let stored = null;
    try {
      stored = localStorage.getItem(SEEN_KEY);
      // First visit: treat everything that already happened as seen. Opening
      // the site for the first time and finding a dot waiting is noise about
      // runs the learner was never part of.
      if (!stored) {
        stored = new Date().toISOString();
        localStorage.setItem(SEEN_KEY, stored);
      }
    } catch {
      // Private mode or storage disabled: the bell still works for this
      // session, it just forgets between visits.
      stored = new Date().toISOString();
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
    setSeenAt(stored);
    setDismissed(readDismissed());
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeRecentCompletions(setCompletions);
    return () => unsubscribe();
  }, []);

  // Until the seen marker has hydrated, selectUnread reports nothing, so the
  // dot cannot flash for a frame on every page load.
  const unread = useMemo(
    () => selectUnread(completions, seenAt, dismissed),
    [completions, dismissed, seenAt]
  );

  /** Auto-clear: opening the panel is reading them. */
  const markAllSeen = useCallback(() => {
    const now = new Date().toISOString();
    setSeenAt(now);
    try {
      localStorage.setItem(SEEN_KEY, now);
    } catch {
      // Nothing to do; the in-memory marker still clears the dot.
    }
  }, []);

  /** The manual escape hatch, for when a mission stays put after being read. */
  const dismiss = useCallback((missionId: string) => {
    setDismissed((prev) => {
      if (prev.includes(missionId)) return prev;
      const next = [...prev, missionId].slice(-DISMISSED_LIMIT);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      } catch {
        // As above: this session still hides it.
      }
      return next;
    });
  }, []);

  return { unread, hasUnread: unread.length > 0, markAllSeen, dismiss };
}

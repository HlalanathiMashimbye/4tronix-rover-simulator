/**
 * What this learner has actually done on the platform: which pages they have
 * opened, and whether they have ever sent a mission.
 *
 * WHY THIS EXISTS. Level 1 challenges ask a learner to do things that happen
 * on OTHER pages - open History, send a mission from Create Mission. The
 * challenge workspace unmounts the moment they navigate away, so component
 * state cannot answer "did they do it"; by the time the check runs again, the
 * evidence is gone. This is the record that survives the round trip.
 *
 * localStorage, not sessionStorage: a learner sent to Create Mission may well
 * finish the mission, close the tab and come back tomorrow. Unlike
 * challengeHandoff.ts - a one-shot payload for the navigation happening right
 * now, which is read-and-cleared precisely so it cannot reapply later - these
 * are facts about the learner that stay true.
 *
 * Keyed by learner. The yard is used on shared classroom machines, so an
 * unkeyed record would hand the next child the previous one's ticks.
 *
 * Device-local, unlike challenge completions themselves, which are in
 * Firestore so they follow a learner across devices. That asymmetry is
 * deliberate and not worth a write per page view: the worst case is a learner
 * who explored History on a tablet has to open it once more on a laptop, and
 * the fix costs a Firestore round trip on every navigation.
 */

import { getLearnerID } from './getLearnerID';

const STORAGE_PREFIX = 'rover-platform-milestones';

interface Milestones {
  /** Pathnames the learner has opened, normalised (no trailing slash, no query). */
  visitedRoutes: string[];
  /** Whether a mission has ever been successfully sent to the queue. */
  missionCreated: boolean;
}

const EMPTY: Milestones = { visitedRoutes: [], missionCreated: false };

function storageKey(): string {
  return `${STORAGE_PREFIX}:${getLearnerID()}`;
}

/**
 * Trailing slashes and query strings are noise here - '/history?from=nav' and
 * '/history/' are the same page to a learner, and a challenge that asked for
 * one spelling would fail on the other.
 */
export function normaliseRoute(pathname: string): string {
  const path = pathname.split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

export function readMilestones(): Milestones {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Milestones>;
    return {
      visitedRoutes: Array.isArray(parsed.visitedRoutes) ? parsed.visitedRoutes : [],
      missionCreated: parsed.missionCreated === true,
    };
  } catch {
    // Unavailable or corrupt: the learner simply has no recorded milestones,
    // which fails a check closed rather than open.
    return EMPTY;
  }
}

function write(next: Milestones): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(next));
  } catch {
    // Private browsing, quota, storage disabled. Recording a milestone is a
    // convenience for the challenge track; nothing else depends on it, so a
    // failed write must not break the page the learner is actually on.
  }
}

export function recordRouteVisit(pathname: string): void {
  const route = normaliseRoute(pathname);
  const current = readMilestones();
  if (current.visitedRoutes.includes(route)) return;
  write({ ...current, visitedRoutes: [...current.visitedRoutes, route] });
}

export function recordMissionCreated(): void {
  const current = readMilestones();
  if (current.missionCreated) return;
  write({ ...current, missionCreated: true });
}

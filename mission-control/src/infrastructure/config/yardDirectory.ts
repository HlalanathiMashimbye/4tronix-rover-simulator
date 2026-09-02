import 'server-only';

import type { Yard } from '@/core/domain/entities/Yard';
import { adminYardRepository } from '@/infrastructure/container.server';

/**
 * The yard list, read once a minute rather than once a page view.
 *
 * Every learner mission page prints the city its run happened in, so without a
 * cache this collection would be read on every view of every mission. Yards
 * change when somebody opens a venue, which is not often, so a minute of
 * staleness costs nothing and a newly added yard still appears while the admin
 * is still looking at the screen.
 *
 * Same shape as runtimeSettingsStore's cache, and for the same reason: this is
 * data a page needs on every render and an admin changes twice a year.
 */
const CACHE_TTL_MS = 60_000;

let cached: { yards: Yard[]; readAt: number } | undefined;

export async function yardDirectory(): Promise<Yard[]> {
  if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) {
    return cached.yards;
  }

  try {
    const yards = await adminYardRepository().findAll();
    cached = { yards, readAt: Date.now() };
    return yards;
  } catch (error) {
    // A learner's mission page must still render without a location rather
    // than 500 because the yard list was briefly unreadable. Stale is better
    // than nothing, and nothing is better than an error page.
    console.warn('[yards] Could not read the directory:', error);
    return cached?.yards ?? [];
  }
}

/** Test seam, and used after an admin writes so the change is visible at once. */
export function clearYardCache(): void {
  cached = undefined;
}

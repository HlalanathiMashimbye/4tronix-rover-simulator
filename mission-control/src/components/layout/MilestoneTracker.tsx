'use client';

/**
 * Records which pages the learner has opened, for the Level 1 challenges that
 * ask them to go and look at one.
 *
 * Renders nothing. Sits in the root layout for the same reason ChromeHeight
 * does: it needs to observe every page, and there is no page it belongs to.
 *
 * The alternative was recording the visit from inside each page that a
 * challenge happens to name. That spreads one rule across four components and
 * quietly breaks the next time somebody adds a page - the challenge would
 * point at a route that never records itself, and the step would be
 * uncompletable with nothing to show why.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { recordRouteVisit } from '@/infrastructure/browser/platformMilestones';

export function MilestoneTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) recordRouteVisit(pathname);
  }, [pathname]);

  return null;
}

'use client';

import { motion } from 'motion/react';

/**
 * Sliding background for a tab/pill group's active state. Render once,
 * conditionally, inside whichever button is currently active - Motion's
 * layoutId tracks that element's DOM position across renders and animates
 * between them, so the background visibly slides from the old active button
 * to the new one instead of an instant class swap.
 *
 * This fires on a tens-of-times-a-day interaction (filter pills, editor mode
 * tabs), not an occasional one, so it stays fast/subtle rather than a showy
 * spring - and collapses to an instant snap under reduced motion rather than
 * disappearing outright.
 */
export function ActivePillBackground({
  layoutId,
  className = '',
  reduceMotion = false,
}: {
  layoutId: string;
  className?: string;
  // useReducedMotion() returns null until it has determined the user's
  // preference on the client (e.g. during the first server-rendered paint).
  reduceMotion?: boolean | null;
}) {
  return (
    <motion.div
      layoutId={layoutId}
      className={`absolute inset-0 z-0 ${className}`}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', duration: 0.3, bounce: 0.15 }}
    />
  );
}

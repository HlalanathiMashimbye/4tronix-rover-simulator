'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Fades and lifts a grid item in on mount, staggered by its position - for a
 * collection that appears occasionally (page load, a filter change), not one
 * that re-renders on every keystroke. Capped at 8 slots so a long list
 * doesn't leave the last row waiting on an ever-growing delay.
 *
 * skipEntrance suppresses the animation for a specific render pass without
 * touching the mount lifecycle - the caller (page.tsx) sets this while a
 * remount is caused by live search narrowing/widening the list, which is a
 * tens-of-times-a-day interaction the entrance stagger was never meant for.
 */
export function StaggeredEntrance({
  index,
  skipEntrance = false,
  reduceMotion = false,
  children,
}: {
  index: number;
  skipEntrance?: boolean;
  reduceMotion?: boolean | null;
  children: ReactNode;
}) {
  if (skipEntrance) return <>{children}</>;

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduceMotion ? 0.15 : 0.22,
        delay: reduceMotion ? 0 : Math.min(index, 8) * 0.04,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

'use client';

import { useLayoutEffect, useMemo, useState } from 'react';

import { STACK, missionLayout, type MissionLayout } from '@/lib/missionLayout';

/**
 * The layout a mission's page should take, from the size of the box its feed
 * and code share (lib/missionLayout has the rule and why it is JavaScript's).
 *
 * Returns a ref for that box and the answer. The ref is a callback: the box
 * is not on the page until the mission has loaded, and an effect keyed on a
 * ref object would have run once, against nothing.
 *
 * Measured in a layout effect, so the first paint already has the right
 * answer and a laptop does not see the stack for a frame first. Where there
 * is no ResizeObserver (jsdom, some embedded webviews) the box is measured
 * once and the page keeps that.
 */
export function useMissionLayout({
  yardAspect,
  hasVideo,
}: {
  yardAspect: number;
  hasVideo: boolean;
}): [(node: HTMLElement | null) => void, MissionLayout] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<{ width: number; height: number; rem: number } | null>(null);

  useLayoutEffect(() => {
    if (!node) return;
    const read = () => {
      // The layout box, not getBoundingClientRect: the page arrives with a
      // transform on it, and a box read through one is the wrong size.
      const width = node.clientWidth;
      const height = node.clientHeight;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setBox((was) => (was && was.width === width && was.height === height && was.rem === rem ? was : { width, height, rem }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  const layout = useMemo(
    () => (box ? missionLayout({ ...box, yardAspect, hasVideo }) : STACK),
    [box, yardAspect, hasVideo],
  );
  return [setNode, layout];
}

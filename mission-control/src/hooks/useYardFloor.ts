'use client';

import { useEffect, useState } from 'react';

/**
 * The real yard's floor, straightened from photos into the yard's measured
 * frame, north up. Made by yard/docs/yard-measurements/measure_yard.py, which
 * writes it here; regenerate it there rather than editing the image.
 */
export const YARD_FLOOR_URL = '/yards/curiosity/floor.webp';

let loading: Promise<HTMLImageElement> | null = null;
let loaded: HTMLImageElement | null = null;

function loadFloor(): Promise<HTMLImageElement> {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        loaded = image;
        resolve(image);
      };
      image.onerror = () => {
        // Forgotten, so the next simulator to mount tries again: a dropped
        // request should not leave the whole session on plain ground.
        loading = null;
        reject(new Error(`Could not load ${YARD_FLOOR_URL}`));
      };
      image.src = YARD_FLOOR_URL;
    });
  }
  return loading;
}

/**
 * The yard's floor photo (AB#464), or null until it has loaded.
 *
 * ONE LOAD FOR THE WHOLE PAGE. The home feed draws a dozen mission covers, and
 * each fetching and decoding its own copy of a 1400px photo would be a dozen
 * decodes of the same picture.
 *
 * Null is not an error to handle: the simulator draws plain ground until the
 * photo lands, and if it never does (offline, blocked), plain ground is all.
 */
export function useYardFloor(): HTMLImageElement | null {
  const [floor, setFloor] = useState<HTMLImageElement | null>(loaded);

  useEffect(() => {
    if (floor) return;
    let mounted = true;
    loadFloor().then(
      (image) => {
        if (mounted) setFloor(image);
      },
      () => {},
    );
    return () => {
      mounted = false;
    };
  }, [floor]);

  return floor;
}

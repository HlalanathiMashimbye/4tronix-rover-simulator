'use client';

import { useEffect, useState } from 'react';

import { DEFAULT_YARD_ID } from '@/infrastructure/config/yard';

/**
 * Where a yard's floor photo is: its own folder, by the yard's current id.
 * Cape Town's is straightened from photos into the yard's measured frame,
 * north up, by yard/docs/yard-measurements/measure_yard.py, which writes it
 * here; regenerate it there rather than editing the image. A yard without a
 * photo has no file, and is drawn on plain ground.
 */
export function yardFloorUrl(yardId: string): string {
  return `/yards/${encodeURIComponent(yardId)}/floor.webp`;
}

/** Cape Town's, the one photo there is. */
export const YARD_FLOOR_URL = yardFloorUrl(DEFAULT_YARD_ID);

const floors = new Map<string, { loading: Promise<HTMLImageElement> | null; loaded: HTMLImageElement | null }>();

function floorState(yardId: string) {
  let state = floors.get(yardId);
  if (!state) {
    state = { loading: null, loaded: null };
    floors.set(yardId, state);
  }
  return state;
}

function loadFloor(yardId: string): Promise<HTMLImageElement> {
  const state = floorState(yardId);
  if (!state.loading) {
    const url = yardFloorUrl(yardId);
    state.loading = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        state.loaded = image;
        resolve(image);
      };
      image.onerror = () => {
        // Forgotten, so the next simulator to mount tries again: a dropped
        // request should not leave the whole session on plain ground.
        state.loading = null;
        reject(new Error(`Could not load ${url}`));
      };
      image.src = url;
    });
  }
  return state.loading;
}

/**
 * A yard's floor photo (AB#464), or null until it has loaded.
 *
 * ONE LOAD PER YARD FOR THE WHOLE PAGE. The home feed draws a dozen mission
 * covers, and each fetching and decoding its own copy of a 1400px photo would
 * be a dozen decodes of the same picture.
 *
 * Null is not an error to handle: the simulator draws plain ground until the
 * photo lands, and if it never does (offline, blocked, a yard with no photo),
 * plain ground is all.
 */
export function useYardFloor(yardId: string = DEFAULT_YARD_ID): HTMLImageElement | null {
  const [, settled] = useState(0);
  const floor = floorState(yardId).loaded;

  useEffect(() => {
    if (floorState(yardId).loaded) return;
    let mounted = true;
    loadFloor(yardId).then(
      () => {
        if (mounted) settled((n) => n + 1);
      },
      () => {},
    );
    return () => {
      mounted = false;
    };
  }, [yardId]);

  return floor;
}

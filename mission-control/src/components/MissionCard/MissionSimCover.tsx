'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useTheme } from '@/contexts/ThemeContext';
import {
  computeLayout,
  drawSimFrame,
  DARK_SIM_PALETTE,
  LIGHT_SIM_PALETTE,
} from '@/lib/roverSimRender';
import type { TrajectoryPoint } from '@/lib/simulateCommands';

/**
 * A mission's cover: the last frame of its simulation, drawn by the simulator.
 *
 * The cover has to be the same picture as the mission page, so it is drawn by
 * the same code - drawSimFrame, the same palette, the same arena. An earlier
 * version approximated it with an SVG polyline on a grey gradient, which was
 * cheaper and looked like a different product: the mission page shows rust
 * ground, craters, a dashed blue trail and the rover itself, and a cover that
 * shows a grey line is not a thumbnail of it.
 *
 * The frame is the LAST one, which is what makes it a cover rather than a
 * poster: the trail is fully drawn and the rover is parked where the mission
 * ended.
 *
 * Cost in a grid is lower than it looks. drawTerrain caches the painted ground
 * to an offscreen canvas keyed on size and palette, and every card in a grid is
 * the same size - so the first card pays for the terrain and the rest get one
 * drawImage each.
 */
interface MissionSimCoverProps {
  trajectory: TrajectoryPoint[];
}

export function MissionSimCover({ trajectory }: MissionSimCoverProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const palette = theme === 'light' ? LIGHT_SIM_PALETTE : DARK_SIM_PALETTE;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // jsdom has no 2d context, and a browser can refuse one under memory
    // pressure. Either way the card keeps its tile; it is simply empty.
    if (!ctx) return;

    // Measure the canvas and leave its CSS size to CSS, as the simulator does -
    // an inline size only tracks layout as often as the observer fires.
    const w = Math.max(0, canvas.clientWidth);
    const h = Math.max(0, canvas.clientHeight);
    if (w === 0 || h === 0) return;

    // Capped lower than the simulator's 2.5: a grid holds two dozen of these,
    // and a backing store per card at full retina scale is memory spent on a
    // picture 320px wide.
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The final frame: trail complete, rover parked where the mission ended.
    drawSimFrame(ctx, computeLayout(w, h), trajectory, trajectory.length - 1, palette);
  }, [trajectory, palette]);

  useEffect(() => {
    draw();

    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;

    // Cards resize when the grid reflows, and the terrain cache is keyed on
    // size - so a redraw at the new size is also what re-keys it.
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        draw();
      });
    });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 block h-full w-full"
      // Decorative: the card's own text already names the mission and its
      // status, so a screen reader gains nothing from the arena.
      aria-hidden="true"
    />
  );
}

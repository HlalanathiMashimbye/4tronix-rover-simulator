'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { useYardFloor } from '@/hooks/useYardFloor';
import { YardFrame } from '@/components/mission/YardFrame';
import {
  computeLayout,
  drawSimFrame,
  interpolate,
  SIM_FPS,
  DARK_SIM_PALETTE,
  LIGHT_SIM_PALETTE,
} from '@/lib/roverSimRender';
import type { TrajectoryPoint } from '@/lib/simulateCommands';
import type { CommandSource } from '@/lib/roverBlockly';

interface RoverSimulatorProps {
  trajectory: TrajectoryPoint[];
  isPlaying: boolean;
  onReset?: () => void;
  editorMode?: 'manual' | 'blockly' | 'code';
  resetVersion?: number;
  /**
   * Rendered inside this card, under the yard, in a slot of ONE fixed height
   * whatever is in it. The yard is sized from what is left, so the checks
   * appearing, a hint wrapping or Drive's controls replacing Send can never
   * change its size. Leave it out for no slot at all.
   */
  footer?: React.ReactNode;
  /**
   * Drop the card, the header and the padding, and let the arena fill whatever
   * box it is given.
   *
   * For the run player, where the simulator sits in the same frame as the
   * video of a real run. A card inside that frame meant switching between the
   * two runs changed the size of the picture: the video went edge to edge and
   * the simulation came back inset by its own padding, under a header the
   * frame's own chrome already provides. The two runs are the same thing seen
   * two ways, so they get the same shape.
   */
  bare?: boolean;
  /**
   * For bare only: the parent's frame is already the yard's shape (the run
   * player's), so the simulator draws no border of its own inside it.
   */
  frameless?: boolean;
  /**
   * Told which part of the program the playhead is on, so the editor can light
   * it up (AB#450). null when nothing is running: before the first frame,
   * after the last one, and after a reset. A pause keeps the highlight, so a
   * learner can stop on a step and look at what caused it.
   */
  onSourceChange?: (source: CommandSource | null) => void;
  /**
   * The run has been watched to its last frame, by playing or by scrubbing
   * there. This, not pressing Run, is what "You have watched it" means: a
   * learner could otherwise press Run and Send in the same second.
   */
  onFinished?: () => void;
}

export function RoverSimulator({
  trajectory = [],
  isPlaying = false,
  onReset,
  editorMode,
  resetVersion = 0,
  footer,
  bare = false,
  frameless = false,
  onSourceChange,
  onFinished,
}: RoverSimulatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const trajRef = useRef<TrajectoryPoint[]>(trajectory);
  const playheadRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  // The canvas's size. The canvas is the yard's own shape (YardFrame), so the
  // layout from it is the whole yard, edge to edge.
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // Read through a ref so a parent passing a fresh callback each render does
  // not restart the playback loop, whose effect depends on syncHud.
  const onSourceChangeRef = useRef(onSourceChange);
  const onFinishedRef = useRef(onFinished);
  const lastSourceRef = useRef<CommandSource | null>(null);
  useEffect(() => {
    onSourceChangeRef.current = onSourceChange;
    onFinishedRef.current = onFinished;
  });
  const reportSource = useCallback((source: CommandSource | null) => {
    if (source === lastSourceRef.current) return;
    lastSourceRef.current = source;
    onSourceChangeRef.current?.(source);
  }, []);

  // Leaving the screen is the end of the run as far as the code is concerned:
  // a mission page swaps the simulation for a video, and a highlight left on
  // a block by a simulator nobody can see any more reads as still running.
  useEffect(
    () => () => {
      if (lastSourceRef.current !== null) onSourceChangeRef.current?.(null);
    },
    [],
  );

  const { theme } = useTheme();
  const isManual = editorMode === 'manual';
  const [isPaused, setIsPaused] = useState(false);
  const [hud, setHud] = useState({ x: 0, y: 0, heading: 0, frame: 0, total: 0, hitWall: false, hitRock: null as string | null });

  // Keep the latest trajectory available to the rAF loop (which reads it live)
  // without re-subscribing every frame. Runs before the draw effects below.
  useEffect(() => {
    trajRef.current = trajectory;
  });

  // The canvas cannot read CSS custom properties, so the terrain palette is
  // chosen here and passed in. Listed as a dependency so toggling the theme
  // repaints the yard - without it the arena keeps the old ground until the
  // next resize or playback frame happens to redraw it.
  const simPalette = theme === 'light' ? LIGHT_SIM_PALETTE : DARK_SIM_PALETTE;

  // The yard's floor photo, read through a ref and NOT a dependency of
  // drawScene. The effect that starts a fresh run depends on drawScene, so a
  // photo landing mid-run would otherwise rewind the run to its first frame.
  // The effect below repaints once when it arrives instead.
  const floor = useYardFloor();
  const floorRef = useRef(floor);

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    if (w === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const traj = trajRef.current;
    const playhead = isManual ? Math.max(0, traj.length - 1) : playheadRef.current;
    drawSimFrame(ctx, computeLayout(w, h), traj, playhead, simPalette, floorRef.current);
  }, [isManual, simPalette]);

  useEffect(() => {
    floorRef.current = floor;
    drawScene();
  }, [floor, drawScene]);

  // --- Sizing (crisp on HiDPI) --------------------------------------------

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Measure the canvas itself and leave its CSS size to CSS.
    //
    // This used to measure the WRAPPER's border box and write the result back
    // as an inline width and height. That was wrong twice over. The canvas is
    // positioned to inset-0, so it fills the wrapper's PADDING box, two pixels
    // smaller than what was being measured. And an inline size only tracks the
    // layout as often as the ResizeObserver fires, so a missed callback left
    // the canvas smaller than the box it was supposed to cover - which showed
    // as a strip of the wrapper's own colour with square corners, sitting
    // inside a rounded panel.
    //
    // Sized by CSS it covers exactly, always. The only thing that can now lag
    // a frame is the backing-store resolution, which costs sharpness rather
    // than showing a seam.
    const w = Math.max(0, canvas.clientWidth);
    const h = Math.max(0, canvas.clientHeight);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    sizeRef.current = { w, h, dpr };
    drawScene();
  }, [drawScene]);

  useEffect(() => {
    resize();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    // Coalesced to at most once per animation frame - the panel-split slider
    // (MissionWorkspace.tsx) animates its CSS grid track with a transition,
    // which fires this ResizeObserver on every intermediate frame of that
    // transition. Without this, the full canvas resize + scene redraw ran on
    // every one of those frames for the whole drag, not just once per step.
    let rafId: number | null = null;
    const throttledResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        resize();
      });
    };
    const ro = new ResizeObserver(throttledResize);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [resize]);

  // --- HUD + playback ------------------------------------------------------

  const syncHud = useCallback(() => {
    const traj = trajRef.current;
    if (traj.length === 0) {
      setHud({ x: 0, y: 0, heading: 0, frame: 0, total: 0, hitWall: false, hitRock: null });
      reportSource(null);
      return;
    }
    const playhead = isManual ? traj.length - 1 : playheadRef.current;
    // Manual driving has no program to point at.
    reportSource(isManual ? null : traj[Math.round(playhead)]?.source ?? null);
    const st = interpolate(traj, playhead);
    setHud({
      x: st.x,
      y: st.y,
      heading: ((st.heading % 360) + 360) % 360,
      frame: Math.round(playhead) + 1,
      total: traj.length,
      hitWall: !!st.hitWall,
      hitRock: st.hitRock ?? null,
    });
  }, [isManual, reportSource]);

  // A fresh non-manual run starts from the beginning and plays.
  //
  // DECLARED BEFORE THE PLAYBACK LOOP ON PURPOSE. Effects run in declaration
  // order, so this parks the playhead at 0 before the loop below is scheduled.
  // The other way round, the loop starts from the PREVIOUS run's final frame,
  // immediately decides it has already finished, and stops - and then this
  // effect rewinds to 0, leaving the rover frozen at the start.
  useEffect(() => {
    if (isManual) return;
    playheadRef.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restart playback when a new trajectory arrives (external event)
    setIsPaused(false);
    drawScene();
    syncHud();
  }, [trajectory, isManual, drawScene, syncHud]);

  // Continuous rAF only while a non-manual run is actively playing.
  useEffect(() => {
    if (isManual || isPaused || !isPlaying) return;
    if (trajectory.length === 0) return;

    let lastHudFrame = -1;
    const tick = (ts: number) => {
      const last = lastTsRef.current ?? ts;
      const dt = (ts - last) / 1000;
      lastTsRef.current = ts;

      const len = trajRef.current.length;
      let p = playheadRef.current + dt * SIM_FPS;
      if (p >= len - 1) p = len - 1;
      playheadRef.current = p;

      drawScene();
      const f = Math.round(p);
      if (f !== lastHudFrame) {
        lastHudFrame = f;
        syncHud();
      }

      if (p < len - 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        // Finished. The rover is parked, so nothing is running any more.
        reportSource(null);
        onFinishedRef.current?.();
      }
    };

    lastTsRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // TRAJECTORY IDENTITY, NOT ITS LENGTH.
    //
    // Keyed on length, pressing Run twice on the same program changed nothing
    // this effect could see: same length, isPlaying already true, isPaused
    // already false. So no frame loop was scheduled, while the effect above
    // rewound the playhead to 0. The rover sat at the start with the button
    // reading "Pause", and only Reset - which empties the trajectory and so
    // does change the length - brought it back.
    //
    // That is why it looked intermittent. Editing the code usually changes the
    // frame count, which hid the bug; re-running the same program, or any edit
    // that kept the same duration, exposed it.
  }, [isManual, isPaused, isPlaying, trajectory, drawScene, syncHud, reportSource]);

  // Manual mode is live: keep the rover on the newest point as it streams in.
  useEffect(() => {
    if (!isManual) return;
    playheadRef.current = Math.max(0, trajectory.length - 1);
    drawScene();
    syncHud();
  }, [isManual, trajectory, drawScene, syncHud]);

  // External reset (shared simulator controls) parks the view at the start.
  useEffect(() => {
    if (resetVersion === 0) return;
    playheadRef.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- react to the shared reset signal from the workspace controls
    setIsPaused(true);
    drawScene();
    syncHud();
  }, [resetVersion, drawScene, syncHud]);

  const handleScrub = (value: number) => {
    setIsPaused(true);
    playheadRef.current = value;
    drawScene();
    syncHud();
    // Dragging to the end is watching to the end, as far as the learner is
    // concerned: they have seen where the rover finishes.
    if (!isManual && value >= trajRef.current.length - 1) onFinishedRef.current?.();
  };

  const handlePlayPause = () => {
    const len = trajRef.current.length;
    if (isPaused && playheadRef.current >= len - 1) {
      playheadRef.current = 0; // restart if parked at the end
    }
    lastTsRef.current = null;
    setIsPaused((p) => !p);
  };

  const handleReset = () => {
    onReset?.();
    playheadRef.current = 0;
    setIsPaused(true);
    drawScene();
    syncHud();
  };

  const hasTrajectory = trajectory.length > 0;

  const controls = hasTrajectory && (
    // ONE ROW, like a video player, laid over the bottom of the yard rather
    // than under it: below, it took height from the yard the moment a run
    // started, and the yard has to stay one size. Icons with labels for screen
    // readers; the shapes are the ones every player uses.
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/70 via-black/35 to-transparent px-2.5 pb-2 pt-5">
      {!isManual && (
        <button
          onClick={handlePlayPause}
          aria-label={isPaused ? 'Play' : 'Pause'}
          className={`clay-press flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
            isPaused ? 'bg-gradient-mars text-primary-foreground' : 'bg-white/90 text-gray-900'
          }`}
        >
          {isPaused ? <PlayIcon /> : <PauseIcon />}
        </button>
      )}
      <input
        type="range"
        min={0}
        max={Math.max(0, trajectory.length - 1)}
        value={Math.min(Math.max(0, hud.frame - 1), Math.max(0, trajectory.length - 1))}
        onChange={(e) => handleScrub(parseInt(e.target.value))}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
        aria-label="Scrub simulation frame"
      />
      <button
        onClick={handleReset}
        aria-label="Reset"
        title="Reset"
        className="clay-press flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/45 text-white transition-colors"
      >
        <ResetIcon />
      </button>
    </div>
  );

  const yard = (
    <YardFrame
      className={bare ? 'relative h-full w-full' : 'relative min-w-0 flex-1'}
      frameRef={wrapRef}
      frameClassName={
        bare && frameless ? 'overflow-hidden' : 'overflow-hidden rounded-2xl border border-border'
      }
      // The colour the canvas paints beyond the floor photo's edges, so a
      // sliver the canvas misses by rounding never reads as a band.
      frameStyle={{ background: simPalette.groundOuter }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      {!hasTrajectory && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center">
          <p className="text-xs font-semibold text-foreground/70">
            Tap a block or press Run to move your rover
          </p>
        </div>
      )}
      {(hud.hitWall || hud.hitRock) && (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <div className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-950/80 px-3 py-1.5 backdrop-blur-sm">
            <svg className="h-3.5 w-3.5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-semibold text-red-300">
              {hud.hitRock
                ? 'Rock hit! The real rover would crash into it here.'
                : 'Wall hit! The rover cannot drive past the edge of the yard.'}
            </span>
          </div>
        </div>
      )}
      {controls}
    </YardFrame>
  );

  // The run player's own chrome already names the run and says it is a
  // simulation, so bare has no header of its own.
  if (bare) return yard;

  return (
    // simCard / simBody / simFooter: see globals.css. The footer goes beside
    // the yard instead of under it when the card is much wider than tall.
    <div className="simCard panel flex h-full flex-col gap-2 border border-border/60 bg-card/40 clay">
      {/* A fixed height: the position readout appears once a run starts and
          is taller than the title, and the yard is sized from what is left. */}
      <div className="flex h-6 shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-block-move" />
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Simulator</p>
        </div>
        {hasTrajectory && (
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Chip label="X" value={`${hud.x.toFixed(0)}`} />
            <Chip label="Y" value={`${hud.y.toFixed(0)}`} />
            <Chip label="°" value={`${hud.heading.toFixed(0)}`} />
          </div>
        )}
      </div>

      <div className="simBody">
        {yard}

        {footer !== undefined && (
          <div className="simFooter @container shrink-0 overflow-hidden" data-sim-footer="">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/50 px-1.5 py-0.5">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </span>
  );
}

function PlayIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
function ResetIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 10a8 8 0 00-14.32-3.5M4 14a8 8 0 0014.32 3.5" />
    </svg>
  );
}

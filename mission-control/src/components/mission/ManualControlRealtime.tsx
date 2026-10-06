"use client";

import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import styles from './ManualControlRealtime.module.css';
import { RoverPhysics, RoverState, YARD, zoneUnderRover, type Yard } from '@/lib/rover-physics';
import type { TrajectoryPoint } from '@/lib/simulateCommands';

interface ManualControlRealtimeProps {
  onTrajectoryUpdate: (trajectory: TrajectoryPoint[]) => void;
  /** Bumped by the workspace's reset (DriveFooter, or the simulator's own). */
  resetVersion?: number;
  /** The yard being driven in (AB#468): its rocks stop the rover, its slopes are recorded. */
  yard?: Yard;
}

/**
 * The manual palette mirrors the Blockly movement blocks: tap one and the rover
 * runs that instruction for a beat. It is the on-ramp David asked for, so a
 * learner who has never coded sees that blocks drive the rover before they open
 * the full Blockly editor.
 */
type DriveBlock = { command: string; label: string; speed: number; ms: number; colour: string };

// Labels and colours mirror the real Blockly movement blocks, so a learner sees
// the same thing in both places. The colours are CSS VARIABLES rather than the
// hex literals they used to be: these buttons are large filled surfaces, and
// the dark-theme values are too vivid to carry white text on a light page.
// globals.css deepens each one under [data-theme="light"].
// the same Lego pieces here as in the editor (movement blue, spin purple,
// steer cyan, stop red).
const BLOCKS: DriveBlock[] = [
  { command: 'forward', label: 'Move Forward', speed: 80, ms: 1000, colour: 'var(--block-move)' },
  { command: 'reverse', label: 'Move Backward', speed: 80, ms: 1000, colour: 'var(--block-move)' },
  { command: 'spinLeft', label: 'Spin Left', speed: 60, ms: 500, colour: 'var(--block-spin)' },
  { command: 'spinRight', label: 'Spin Right', speed: 60, ms: 500, colour: 'var(--block-spin)' },
  { command: 'steerLeft', label: 'Steer Left', speed: 60, ms: 1000, colour: 'var(--block-steer)' },
  { command: 'steerRight', label: 'Steer Right', speed: 60, ms: 1000, colour: 'var(--block-steer)' },
];

const KEY_MAP: Record<string, DriveBlock> = {
  w: BLOCKS[0],
  s: BLOCKS[1],
  a: BLOCKS[2],
  d: BLOCKS[3],
  q: BLOCKS[4],
  e: BLOCKS[5],
};

/** One physics state as the simulator wants it. Manual driving has no lamps. */
function toTrajectoryPoint(state: RoverState, yard: Yard): TrajectoryPoint {
  return {
    x: state.x,
    y: state.y,
    heading: state.heading,
    speedL: state.speedL,
    speedR: state.speedR,
    servos: {
      '9': state.servos[9],
      '15': state.servos[15],
      '11': state.servos[11],
      '13': state.servos[13],
    },
    hitWall: state.hitWall,
    hitRock: state.hitRock,
    zone: zoneUnderRover(state.x, state.y, yard),
    leds: [null, null, null, null],
  };
}

/** Bounded so a long drive cannot grow the trail for ever. */
const MAX_TRAIL_POINTS = 3000;

export function ManualControlRealtime({ onTrajectoryUpdate, resetVersion = 0, yard = YARD }: ManualControlRealtimeProps) {
  const roverRef = useRef<RoverPhysics>(new RoverPhysics(yard));
  // The yard's layout arrives from the server just after the page does
  // (useYardLayout). Before anything has been driven the rover is simply put
  // in it; mid-drive it waits for the next reset, rather than yanking the
  // rover back to the start under a learner's finger.
  const yardRef = useRef(yard);
  const trajectoryRef = useRef<TrajectoryPoint[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const runTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  // True once a block has been tapped this run, so chaining more blocks keeps
  // the existing trail. Reset clears it.
  const startedRef = useRef(false);

  const resetController = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (runTimeoutRef.current) {
      clearTimeout(runTimeoutRef.current);
      runTimeoutRef.current = null;
    }
    setIsActive(false);
    setActiveCommand(null);
    roverRef.current = new RoverPhysics(yardRef.current);
    trajectoryRef.current = [];
    startedRef.current = false;
  }, []);

  useEffect(() => {
    yardRef.current = yard;
    if (!startedRef.current) roverRef.current = new RoverPhysics(yard);
  }, [yard]);

  // Listen for external reset from the shared simulator controls.
  useEffect(() => {
    if (resetVersion > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- react to the shared reset signal from the workspace controls
      resetController();
    }
  }, [resetVersion, resetController]);

  useEffect(() => {
    const updateLoop = () => {
      const newState = roverRef.current.update();
      // Converted here, once per frame, rather than re-mapping the whole trail
      // on every frame further up. See the note on onTrajectoryUpdate below.
      trajectoryRef.current.push(toTrajectoryPoint(newState, yardRef.current));

      /**
       * A sliding window, and callers must treat it as one.
       *
       * The cap keeps a long drive from growing without bound, but it means
       * this array does NOT only ever grow: past the limit the oldest points
       * fall off the front. A parent tracking "how much have I seen" by length
       * will conclude nothing new ever arrives and freeze the rover on screen,
       * which is exactly what used to happen after about sixteen seconds of
       * driving. Send the whole thing; let the consumer take it as given.
       *
       * 3000 points is roughly fifty seconds at 60fps, long enough that the
       * trail rarely eats its own tail while a child is exploring.
       */
      if (trajectoryRef.current.length > MAX_TRAIL_POINTS) {
        trajectoryRef.current = trajectoryRef.current.slice(-MAX_TRAIL_POINTS);
      }

      /**
       * A SHALLOW copy, and that distinction is the whole point.
       *
       * The workspace used to receive RoverStates and map the entire trail into
       * fresh TrajectoryPoints on every animation frame. At sixty frames a
       * second against a three-thousand-point trail that is ~180,000 object
       * allocations per second, which drove React into "maximum update depth"
       * and eventually killed the dev server outright.
       *
       * Each point is now built once, when it happens. This copy exists only so
       * React sees a new array identity and re-renders; it copies references,
       * not objects.
       */
      onTrajectoryUpdate(trajectoryRef.current.slice());
      animationFrameRef.current = requestAnimationFrame(updateLoop);
    };

    if (isActive) {
      updateLoop();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, onTrajectoryUpdate]);

  // Tap a block: run that instruction for a beat, then stop. Tapping more blocks
  // extends the path, one block at a time.
  const runBlock = useCallback((block: DriveBlock) => {
    if (!startedRef.current) {
      startedRef.current = true;
      trajectoryRef.current = [toTrajectoryPoint(roverRef.current.getState(), yardRef.current)];
    }
    if (runTimeoutRef.current) clearTimeout(runTimeoutRef.current);
    roverRef.current.setCommand(block.command, block.speed);
    setActiveCommand(block.command);
    setIsActive(true); // run the render loop while this instruction plays
    runTimeoutRef.current = setTimeout(() => {
      roverRef.current.setCommand('stop');
      setActiveCommand(null);
      runTimeoutRef.current = null;
      setIsActive(false); // halt the loop; the rover holds its place and trail
    }, block.ms);
  }, []);

  const stopNow = useCallback(() => {
    if (runTimeoutRef.current) {
      clearTimeout(runTimeoutRef.current);
      runTimeoutRef.current = null;
    }
    roverRef.current.setCommand('stop');
    setActiveCommand(null);
    setIsActive(false); // halt the loop when the learner stops
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;
      const block = KEY_MAP[e.key.toLowerCase()];
      if (block) {
        e.preventDefault();
        runBlock(block);
      } else if (e.key === ' ') {
        e.preventDefault();
        stopNow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [runBlock, stopNow]);

  return (
    // On a phone this shares the screen with the docked simulator (AB#455),
    // so the buttons compact. Reset position and the keyboard hint are not
    // here at all: on a laptop they are in the footer card under this panel
    // (DriveFooter), and on a phone the simulator's own Reset does the job
    // and there is no keyboard.
    <div className="flex h-full w-full flex-col gap-2 p-3 md:gap-3 md:p-4">
      <div>
        <h3 className="font-display text-base font-bold text-foreground md:text-lg">Tap a block to drive</h3>
        <p className="hidden text-xs text-muted-foreground md:block">
          These are the same blocks you code with. Tap one to run it.
        </p>
      </div>

      <div className="grid flex-1 content-start grid-cols-2 gap-x-3 gap-y-2.5 md:gap-x-4 md:gap-y-6">
        {BLOCKS.map((block) => (
          <button
            key={block.command}
            onClick={() => runBlock(block)}
            className={`${styles.block} ${activeCommand === block.command ? styles.active : ''}`}
            style={{ ['--c']: block.colour } as CSSProperties}
          >
            {block.label}
          </button>
        ))}
        <button
          onClick={stopNow}
          className={`${styles.block} col-span-2 justify-center`}
          style={{ ['--c']: 'var(--block-stop)' } as CSSProperties}
        >
          Stop
        </button>
      </div>

    </div>
  );
}

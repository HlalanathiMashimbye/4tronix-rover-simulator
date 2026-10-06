'use client';

import { useEffect, useRef } from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  useVelocity,
  type MotionValue,
} from 'motion/react';
import type { LucideIcon } from 'lucide-react';

/**
 * The Drive / Blocks / Python switch (6 Oct 2026): one slim track and a thumb
 * that moves like something physical.
 *
 * - The thumb springs to the mode picked, stretching as it travels and
 *   settling with a small bounce, rather than jumping.
 * - It can be dragged, as a slider: it follows the finger, and on letting go
 *   snaps to the nearest mode and switches to it.
 * - Each label lights as the thumb passes under it, while it moves, not after.
 *
 * Everything is driven by one number, the thumb's position in segments
 * (0 = the first mode), as a motion value, so dragging and springing are the
 * same animation and none of it re-renders React. Under reduced motion the
 * thumb jumps and does not stretch.
 */

export interface ModeOption<T extends string> {
  value: T;
  label: string;
  Icon: LucideIcon;
  /** A sign of interest before the press, for prefetching what it opens. */
  onIntent?: () => void;
}

/** The track's padding round the thumb, in px (p-[3px] below). */
const PAD = 3;

/**
 * Where the thumb goes, in segments, for a finger this far along the track:
 * centred under the finger, and never past either end.
 */
export function thumbAt(offset: number, width: number, count: number): number {
  const segment = (width - PAD * 2) / count;
  return Math.min(count - 1, Math.max(0, (offset - PAD) / segment - 0.5));
}

/**
 * How long the thumb is drawn at this speed, in segments a second: the
 * faster it goes the more it stretches, up to a little over a quarter, so a
 * flick reads as liquid and a rest as round.
 */
export function thumbStretch(velocity: number): number {
  return 1 + Math.min(Math.abs(velocity) * 0.05, 0.28);
}

/** Just under critically damped: one small bounce as it lands. */
const SNAP = { type: 'spring', stiffness: 420, damping: 28, mass: 0.8 } as const;

export function ModeSwitch<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ModeOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** What the group chooses, for screen readers. */
  label: string;
}) {
  const reduceMotion = useReducedMotion();
  const count = options.length;
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const trackRef = useRef<HTMLDivElement>(null);
  const position = useMotionValue(index);
  const dragging = useRef(false);
  // A drag ends with a pointerup, which a mouse follows with a click on
  // whichever segment it let go over. The drag has already switched, so
  // that click is swallowed rather than switching a second time.
  const dragEnded = useRef(false);

  useEffect(() => {
    if (dragging.current) return;
    const spring = animate(position, index, reduceMotion ? { duration: 0 } : SNAP);
    return () => spring.stop();
  }, [index, position, reduceMotion]);

  const velocity = useVelocity(position);
  const scaleX = useTransform(velocity, (v) => (reduceMotion ? 1 : thumbStretch(v)));
  // A percentage of the thumb's own width, which is one segment.
  const x = useTransform(position, (p) => `${p * 100}%`);

  const follow = (clientX: number) => {
    const track = trackRef.current?.getBoundingClientRect();
    if (track) position.set(thumbAt(clientX - track.left, track.width, count));
  };

  return (
    <motion.div
      ref={trackRef}
      role="group"
      aria-label={label}
      // overflow-hidden: a fast thumb stretches, and never past the track.
      className="relative grid flex-shrink-0 overflow-hidden rounded-full bg-secondary/50 p-[3px] ring-1 ring-inset ring-border/60"
      // pan-y: a sideways drag is the slider's, an up-and-down one is still
      // the page's.
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, touchAction: 'pan-y' }}
      onPanStart={() => {
        dragging.current = true;
      }}
      onPan={(event) => follow((event as PointerEvent).clientX)}
      onPanEnd={() => {
        dragging.current = false;
        dragEnded.current = true;
        setTimeout(() => {
          dragEnded.current = false;
        }, 0);
        const nearest = Math.round(position.get());
        if (options[nearest].value !== value) onChange(options[nearest].value);
        else animate(position, index, reduceMotion ? { duration: 0 } : SNAP);
      }}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute bottom-[3px] left-[3px] top-[3px] rounded-full bg-gradient-mars shadow-[0_2px_10px_-3px_var(--primary)]"
        style={{ width: `calc((100% - ${PAD * 2}px) / ${count})`, x, scaleX }}
      />
      {options.map((option, i) => (
        <Segment
          key={option.value}
          option={option}
          at={i}
          position={position}
          active={i === index}
          reduceMotion={!!reduceMotion}
          onPress={() => {
            if (!dragEnded.current) onChange(option.value);
          }}
        />
      ))}
    </motion.div>
  );
}

function Segment<T extends string>({
  option: { label, Icon, onIntent },
  at,
  position,
  active,
  reduceMotion,
  onPress,
}: {
  option: ModeOption<T>;
  at: number;
  position: MotionValue<number>;
  active: boolean;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  // 1 with the thumb right under this label, 0 a segment or more away: the
  // light label fades in over the muted one as the thumb arrives.
  const lit = useTransform(position, (p) => Math.max(0, 1 - Math.abs(p - at)));
  const content = (
    <>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </>
  );
  return (
    <button
      onClick={onPress}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      aria-pressed={active}
      className="relative z-10 flex h-[22px] items-center justify-center rounded-full text-xs font-bold text-muted-foreground transition-colors hover:text-foreground md:h-[26px]"
    >
      {/* A small hop for the icon of the mode just picked. */}
      <motion.span
        className="relative flex items-center gap-1.5"
        animate={active && !reduceMotion ? { scale: [1, 1.12, 1], y: [0, -1.5, 0] } : { scale: 1, y: 0 }}
        transition={{ duration: 0.42, ease: 'easeOut' }}
      >
        {content}
        <motion.span aria-hidden className="absolute inset-0 flex items-center gap-1.5 text-primary-foreground" style={{ opacity: lit }}>
          {content}
        </motion.span>
      </motion.span>
    </button>
  );
}

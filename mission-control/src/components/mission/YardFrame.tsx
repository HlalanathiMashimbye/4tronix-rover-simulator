'use client';

import type { CSSProperties, ReactNode, Ref } from 'react';
import { YARD } from '@/lib/rover-physics';

interface YardFrameProps {
  /**
   * Classes for the space the frame may use, including its positioning
   * (relative, or absolute inset-0). It needs a size: flex-1, h-full, inset-0.
   */
  className?: string;
  /** Classes for the frame itself: its border, rounding and background. */
  frameClassName?: string;
  frameStyle?: CSSProperties;
  frameRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/**
 * The yard's own shape, as large as the space it is given allows (AB#464).
 *
 * Every simulator a rover is driven or watched in is framed like this. The
 * two other ways were both tried and both lost something: fitting the yard
 * into a frame of another shape left bars of empty ground inside it, and
 * filling the frame cropped rocks and corners off the yard a learner is
 * planning a route across. So the frame takes the yard's shape instead, and
 * whatever space is left over is the page's, outside it.
 *
 * Sized with container query units, so it needs no measuring in script: the
 * outer box is a size container, and the frame is the largest box of the
 * yard's proportions that fits in it, centred. The proportions come from YARD,
 * so a differently measured yard reshapes every simulator with it.
 */
export function YardFrame({ className = '', frameClassName = '', frameStyle, frameRef, children }: YardFrameProps) {
  return (
    <div
      className={`min-h-0 min-w-0 ${className}`}
      style={{ containerType: 'size', ['--yard-ratio' as string]: YARD.widthCm / YARD.depthCm }}
      data-yard-frame-space=""
    >
      <div
        ref={frameRef}
        className={`absolute inset-0 m-auto h-[min(100cqh,calc(100cqw/var(--yard-ratio)))] w-[min(100cqw,calc(100cqh*var(--yard-ratio)))] ${frameClassName}`}
        style={frameStyle}
        data-yard-frame=""
      >
        {children}
      </div>
    </div>
  );
}

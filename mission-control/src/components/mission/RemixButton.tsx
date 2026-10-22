'use client';

import { motion, useReducedMotion } from 'motion/react';
import { Zap } from 'lucide-react';

/**
 * Remix: take this mission's code back into the editor.
 *
 * `nudge` makes the bolt jump. The page raises it when the simulation has
 * played to its end, the moment a learner has something to change, so the
 * button moves when it becomes the next thing to press and is still otherwise.
 *
 * Keyed by the nudge rather than animated from an effect: a new key is a new
 * element, and its entrance is the jump. Motion's `animate` on the same
 * element would need the value to change and change back.
 *
 * It grows, by a thousandth of what the note beside it does
 * (OperatorFeedback). Sharing a line with the note that is nothing, and the
 * button is its own width; on a line of its own, at the foot of a narrow code
 * card where the two do not fit side by side, it is the whole line.
 */
export function RemixButton({
  onRemix,
  nudge = 0,
  compact = false,
  tourId,
}: {
  onRemix: () => void;
  nudge?: number;
  /** Where the narrowest phones have room for the bolt alone. */
  compact?: boolean;
  tourId?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <button
      type="button"
      onClick={onRemix}
      aria-label="Remix"
      title="Tweak the code and run your own version"
      data-tour-id={tourId}
      // The after: is the tap target. The button stays the size the page's
      // other buttons are (the user's call for phones, 3 October 2026), and a
      // thumb still gets 44px to land on.
      className="clay clay-press group/remix relative inline-flex h-10 flex-[1_0_auto] items-center justify-center gap-1.5 rounded-xl bg-gradient-mars px-3.5 font-display text-sm font-bold text-primary-foreground after:absolute after:-inset-1 after:content-['']"
    >
      <motion.span
        key={nudge}
        className="inline-flex"
        initial={reduceMotion ? false : { rotate: -30, scale: 1.6 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 10, delay: 0.3 }}
      >
        <Zap
          className="h-3.5 w-3.5 transition-transform duration-200 group-hover/remix:-rotate-12 group-hover/remix:scale-125"
          fill="currentColor"
        />
      </motion.span>
      <span className={compact ? 'max-[359px]:sr-only' : undefined}>Remix</span>
    </button>
  );
}

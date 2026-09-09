'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass } from 'lucide-react';
import { hasSeenWelcome, recordWelcomeSeen } from '@/infrastructure/browser/platformMilestones';

/**
 * A first-visit welcome that points a new learner at the Getting Started
 * challenges, whose first step is a walk around the site.
 *
 * OVER THE FEED, NOT A PAGE OF ITS OWN. A child arriving here came to see a
 * rover drive somebody's code. A welcome page would stand between them and
 * that, and a redirect would also catch the learner who opened a mission link
 * from their email. So this sits over the home feed only, closes in one tap,
 * and does not come back once closed.
 *
 * Remembered in the learner's own milestones, so a shared classroom machine
 * welcomes each child once rather than only whoever sat down first.
 *
 * Plain CSS transitions, not Motion's AnimatePresence, for the reason recorded
 * in MissionSentDialog.
 */

export const TOUR_CHALLENGE_HREF = '/challenges/platform-orientation';

const EXIT_MS = 200;

export function WelcomeCard() {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Decided after mount: localStorage does not exist during the server render,
  // and deciding there would flash the card at every visitor.
  useEffect(() => {
    if (hasSeenWelcome()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first-visit check needs the browser
    setOpen(true);
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  const close = useCallback(() => {
    recordWelcomeSeen();
    setVisible(false);
    exitTimer.current = setTimeout(() => setOpen(false), EXIT_MS);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center px-4 py-8 ${visible ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      aria-describedby="welcome-body"
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />

      <div
        className={`relative z-[101] w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-6 shadow-2xl backdrop-blur-sm transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
          <Compass className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>

        <h2 id="welcome-title" className="mt-3 font-display text-xl font-bold text-foreground">
          Welcome to Mission Control
        </h2>

        <div id="welcome-body" className="mt-2 space-y-2 text-sm text-muted-foreground">
          <p>
            Write a mission for a real Mars rover, send it to the yard, and watch a video of your
            code driving it.
          </p>
          <p>
            New here? The <span className="font-semibold text-foreground">Getting Started</span>{' '}
            challenges show you around the site, one small step at a time.
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <Link
            href={TOUR_CHALLENGE_HREF}
            onClick={recordWelcomeSeen}
            autoFocus
            className="clay clay-press flex-1 rounded-xl bg-gradient-mars px-4 py-2.5 text-center text-sm font-bold text-primary-foreground"
          >
            Show me around
          </Link>
          <button
            type="button"
            onClick={close}
            className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-primary/70"
          >
            I&apos;ll explore on my own
          </button>
        </div>
      </div>
    </div>
  );
}

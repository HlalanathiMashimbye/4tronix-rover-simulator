'use client';

import { useEffect, useState } from 'react';
import { Rocket } from 'lucide-react';

/**
 * Confirmation shown after a mission reaches the queue.
 *
 * There was already a small "Mission sent!" banner in the submit bar, but on a
 * learner's FIRST submit it was never seen: the email prompt opens in the same
 * tick behind a full-screen backdrop that covers the banner, and the banner
 * cleared itself on a 5-second timer that ran while the modal was still up. Read
 * the prompt, press Skip, and the confirmation had already expired - so the one
 * moment that needs to feel like an achievement said nothing at all.
 *
 * This waits for the email decision instead of racing it, and dismisses on a
 * tap rather than a timer, because a timer is what caused the problem.
 *
 * Plain CSS transitions, not Motion's AnimatePresence - see NotificationModal
 * for the verified reason that library combination leaves an invisible,
 * click-eating layer behind on exit.
 */
const EXIT_MS = 200;

interface MissionSentDialogProps {
  open: boolean;
  onClose: () => void;
  /** Set when the learner has an email saved: changes what we promise them. */
  email: string | null;
}

export function MissionSentDialog({ open, onClose, email }: MissionSentDialogProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the dialog
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center px-4 py-8 ${visible ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mission-sent-title"
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      <div
        className={`relative z-[101] w-full max-w-sm rounded-2xl border border-border/70 bg-card/95 p-6 text-center shadow-2xl backdrop-blur-sm transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* The rocket lifts off its pad, once, with a puff of exhaust and a
            ring going out: the moment a mission leaves is the one to feel
            (globals.css, "Moments"). It replays on every open, because the
            dialog unmounts when it closes. */}
        <div className="relative mx-auto h-14 w-14" aria-hidden="true">
          <span className="launch-ring absolute inset-0 rounded-2xl border-2 border-buzz/60" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-buzz/15">
            <Rocket className="launch-rocket h-7 w-7 -rotate-45 text-buzz" />
          </div>
          <div className="launch-trail absolute -bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
            <span className="h-2 w-2 rounded-full bg-primary/60" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
          </div>
        </div>

        <h2
          id="mission-sent-title"
          className="pop-in mt-4 font-display text-lg font-bold text-foreground [animation-delay:300ms]"
        >
          Mission sent!
        </h2>

        {email ? (
          <p className="mt-2 text-sm text-muted-foreground">
            It is in the queue for the rover. We will email{' '}
            {/* The address is shown back deliberately: it is the only chance to
                notice a typo before the one notification goes to nobody. */}
            <span className="font-semibold text-foreground">{email}</span> once it has run.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            It is in the queue for the rover. No email needed - find it again any
            time under <span className="font-semibold text-foreground">My History</span>.
          </p>
        )}

        <button
          onClick={onClose}
          autoFocus
          className="clay clay-press mt-5 w-full rounded-xl bg-gradient-mars px-4 py-2.5 text-sm font-bold text-primary-foreground"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

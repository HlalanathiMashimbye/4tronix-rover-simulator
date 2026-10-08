'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { hasSeenWelcome, recordWelcomeSeen } from '@/infrastructure/browser/platformMilestones';
import { RecoveryCodeCard } from '@/components/learner/RecoveryCodeCard';
import { RestoreFromCode } from '@/components/learner/RestoreFromCode';
import { AvatarPicker } from '@/components/learner/AvatarPicker';
import { useLearner } from '@/contexts/LearnerContext';
import type { LearnerAvatar } from '@/core/domain/entities/Learner';

/**
 * First-visit modal: pick an avatar and a generated name.
 *
 * OVER THE FEED, NOT A PAGE OF ITS OWN. A child arriving here came to see a
 * rover drive somebody's code. A welcome page would stand between them and
 * that, and a redirect would also catch the learner who opened a mission link
 * from their email. So this sits over the home feed only, closes in one tap,
 * and does not come back once closed.
 *
 * After the avatar is chosen, the recovery code card is offered once so the
 * learner can save a code to restore their identity on another device.
 */

export const TOUR_CHALLENGE_HREF = '/challenges/platform-orientation';

const EXIT_MS = 200;

export function WelcomeCard() {
  const { learner, sessionId, updateProfile } = useLearner();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showRecoveryOffer, setShowRecoveryOffer] = useState(false);
  const [saving, setSaving] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hasSeenWelcome()) return;
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
    exitTimer.current = setTimeout(() => {
      setOpen(false);
      setShowRecoveryOffer(true);
    }, EXIT_MS);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const handleConfirm = useCallback(
    async (avatar: LearnerAvatar, displayName: string) => {
      setSaving(true);
      await updateProfile(displayName, avatar);
      setSaving(false);
      close();
    },
    [updateProfile, close],
  );

  return (
    <>
      {open && (
        <div
          className={`fixed inset-0 z-[100] grid place-items-center overflow-y-auto px-4 py-8 ${visible ? '' : 'pointer-events-none'}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-title"
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
            <button
              type="button"
              onClick={close}
              className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>

            <h2 id="welcome-title" className="font-display text-xl font-bold text-foreground">
              Who&apos;s flying today?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick an avatar and a name for the leaderboard.
            </p>

            <div className="mt-4">
              {sessionId && (
                <AvatarPicker
                  learnerId={sessionId}
                  initialAvatar={learner?.avatar}
                  initialName={learner?.displayName}
                  onConfirm={handleConfirm}
                />
              )}
              {saving && (
                <div className="mt-2 text-center text-xs text-muted-foreground">
                  Saving…
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => { recordWelcomeSeen(); setOpen(false); setVisible(false); setShowRestore(true); }}
              className="mt-3 w-full text-center text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              I have a recovery code
            </button>
          </div>
        </div>
      )}

      <RestoreFromCode
        open={showRestore}
        onClose={() => setShowRestore(false)}
      />

      <RecoveryCodeCard
        open={showRecoveryOffer}
        onClose={() => setShowRecoveryOffer(false)}
        onSkip={() => setShowRecoveryOffer(false)}
      />
    </>
  );
}

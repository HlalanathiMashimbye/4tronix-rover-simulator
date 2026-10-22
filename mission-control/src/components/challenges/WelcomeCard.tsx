'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Compass } from 'lucide-react';
import Image from 'next/image';
import { hasSeenWelcome, recordWelcomeSeen } from '@/infrastructure/browser/platformMilestones';
import { RecoveryCodeCard } from '@/components/learner/RecoveryCodeCard';
import { RestoreProfileContent } from '@/components/learner/RestoreProfileContent';
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
  const router = useRouter();
  const { learner, sessionId, updateProfile } = useLearner();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [showRestoreInline, setShowRestoreInline] = useState(false);
  const [showRecoveryOffer, setShowRecoveryOffer] = useState(false);
  const [showTourOffer, setShowTourOffer] = useState(false);
  const [tourVisible, setTourVisible] = useState(false);
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
    setShowRestoreInline(false);
    setVisible(false);
    exitTimer.current = setTimeout(() => {
      setOpen(false);
      setShowRecoveryOffer(true);
    }, EXIT_MS);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showRestoreInline) {
          setShowRestoreInline(false);
        } else {
          close();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, showRestoreInline]);

  const handleConfirm = useCallback(
    async (avatar: LearnerAvatar, displayName: string) => {
      setSaving(true);
      await updateProfile(displayName, avatar);
      setSaving(false);
      close();
    },
    [updateProfile, close],
  );

  const handleRestoreSuccess = useCallback(() => {
    recordWelcomeSeen();
    setShowRestoreInline(false);
    setVisible(false);
    exitTimer.current = setTimeout(() => setOpen(false), EXIT_MS);
  }, []);

  const handleBackFromRecovery = useCallback(() => {
    setShowRecoveryOffer(false);
    setOpen(true);
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const openTourOffer = useCallback(() => {
    setShowRecoveryOffer(false);
    setShowTourOffer(true);
    requestAnimationFrame(() => setTourVisible(true));
  }, []);

  const closeTourOffer = useCallback(() => {
    setTourVisible(false);
    exitTimer.current = setTimeout(() => setShowTourOffer(false), EXIT_MS);
  }, []);

  const handleShowMeAround = useCallback(() => {
    closeTourOffer();
    router.push(TOUR_CHALLENGE_HREF);
  }, [closeTourOffer, router]);

  return (
    <>
      {/* ── Avatar picker / restore modal ── */}
      {open && (
        <div
          className={`fixed inset-0 z-[100] grid place-items-center overflow-y-auto px-4 py-8 ${visible ? '' : 'pointer-events-none'}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-title"
        >
          <div
            className={`absolute inset-0 bg-black/70 transition-opacity duration-200 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
            onClick={showRestoreInline ? () => setShowRestoreInline(false) : close}
          />

          <div
            className={`relative z-[101] w-full max-w-md rounded-2xl border border-border bg-card shadow-xl transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
              visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
            }`}
          >
            {/* Avatar picker view — stays mounted so state (avatar, callsign) is preserved */}
            <div className={showRestoreInline ? 'hidden' : ''}>
              <button
                type="button"
                onClick={close}
                className="absolute right-4 top-4 z-10 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>

              <div className="flex items-center justify-center pb-2 pt-6">
                <div className="h-16 w-16 overflow-hidden rounded-2xl">
                  <Image src="/rover-hero.jpg" alt="" width={128} height={128} className="h-full w-full object-cover" />
                </div>
              </div>

              <div className="px-4 pb-6 md:px-6">
                <h2 id="welcome-title" className="text-center font-display text-2xl font-bold text-foreground">
                  Who&apos;s flying today?
                </h2>
                <p className="mt-1 text-center text-sm text-muted-foreground">
                  Pick an avatar and a name for the leaderboard.
                </p>

                <div className="mt-4">
                  {sessionId && (
                    <AvatarPicker
                      learnerId={sessionId}
                      initialAvatar={learner?.avatar}
                      initialName={learner?.displayName}
                      onConfirm={handleConfirm}
                      onRestore={() => setShowRestoreInline(true)}
                    />
                  )}
                  {saving && (
                    <div className="mt-2 text-center text-xs text-muted-foreground">
                      Saving…
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Restore view — mounted fresh each time so state resets */}
            {showRestoreInline && (
              <div className="px-4 pb-6 pt-6 md:px-6">
                <h2 className="font-display text-xl font-bold text-foreground">
                  Restore a profile
                </h2>
                <div className="mt-4">
                  <RestoreProfileContent
                    onSuccess={handleRestoreSuccess}
                    onBack={() => setShowRestoreInline(false)}
                    backLabel="Back"
                    variant="welcome"
                    autoFocusInput
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <RecoveryCodeCard
        open={showRecoveryOffer}
        onClose={openTourOffer}
        onSkip={openTourOffer}
        onBack={handleBackFromRecovery}
      />

      {/* ── Tour offer modal ── */}
      {showTourOffer && (
        <div
          className={`fixed inset-0 z-[100] grid place-items-center px-4 py-8 ${tourVisible ? '' : 'pointer-events-none'}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
        >
          <div
            className={`absolute inset-0 bg-black/70 transition-opacity duration-200 motion-reduce:transition-none ${tourVisible ? 'opacity-100' : 'opacity-0'}`}
            onClick={closeTourOffer}
          />

          <div
            className={`relative z-[101] w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card text-center shadow-xl transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
              tourVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
            }`}
          >
            <div className="flex items-center justify-center pb-2 pt-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-secondary">
                <Compass className="h-8 w-8 text-foreground" aria-hidden="true" />
              </div>
            </div>

            <div className="px-6 pb-6">
              <h2 id="tour-title" className="font-display text-2xl font-bold text-foreground">
                Ready to explore? 🧭
              </h2>
              <p className="mx-auto mt-2 max-w-[260px] text-sm text-muted-foreground">
                A quick tour will show you where everything is and end with your
                first mission to the rover.
              </p>

              <div className="mt-6 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleShowMeAround}
                  className="clay clay-press rounded-xl bg-gradient-mars px-4 py-3 text-sm font-bold text-primary-foreground"
                >
                  TAKE OFF! (Quick Tour)
                </button>
                <button
                  type="button"
                  onClick={closeTourOffer}
                  className="rounded-xl px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  I&apos;ll explore solo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

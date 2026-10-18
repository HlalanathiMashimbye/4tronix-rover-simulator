'use client';

import { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { useLearner } from '@/contexts/LearnerContext';
import { getFirebaseAuth } from '@/infrastructure/persistence/firebase-client';

const EXIT_MS = 200;

interface LinkedLearner {
  learnerId: string;
  displayName?: string;
  avatar?: { style: string; seed: string };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ParentRestore({ open, onClose }: Props) {
  const { restoreFromParent, adoptLearner } = useLearner();
  const [step, setStep] = useState<'prompt' | 'signing-in' | 'pick' | 'restoring'>('prompt');
  const [learners, setLearners] = useState<LinkedLearner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setStep('prompt');
      setLearners([]);
      setError(null);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    exitTimer.current = setTimeout(() => {
      setStep('prompt');
      setLearners([]);
      setError(null);
    }, EXIT_MS);
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open && !visible) return null;

  async function handleSignIn() {
    setStep('signing-in');
    setError(null);

    try {
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(getFirebaseAuth(), provider);
      const idToken = await credential.user.getIdToken(true);

      const auth = getFirebaseAuth();
      await auth.signOut();

      const result = await restoreFromParent(idToken);
      if (result.success && result.learners && result.learners.length > 0) {
        if (result.learners.length === 1) {
          setStep('restoring');
          await adoptLearner(result.learners[0].learnerId);
          onClose();
        } else {
          setLearners(result.learners);
          setStep('pick');
        }
      } else {
        setError(result.error ?? 'No linked learners found for this account.');
        setStep('prompt');
      }
    } catch {
      setError('Sign-in was cancelled or failed. Please try again.');
      setStep('prompt');
    }
  }

  async function handlePick(learnerId: string) {
    setStep('restoring');
    await adoptLearner(learnerId);
    onClose();
  }

  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center px-4 py-8 ${visible ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="parent-restore-title"
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      <div
        className={`relative z-[101] w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-6 shadow-2xl backdrop-blur-sm transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
          <Users className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>

        {step === 'prompt' && (
          <>
            <h2 id="parent-restore-title" className="mt-3 font-display text-xl font-bold text-foreground">
              Restore from parent account
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in with the Google account you linked to your child&apos;s profile
              to restore their missions and progress on this device.
            </p>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-card/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSignIn}
                className="rounded-lg bg-gradient-to-r from-orange-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-900/20"
              >
                Sign in with Google
              </button>
            </div>
          </>
        )}

        {(step === 'signing-in' || step === 'restoring') && (
          <>
            <h2 id="parent-restore-title" className="mt-3 font-display text-xl font-bold text-foreground">
              {step === 'signing-in' ? 'Looking up linked profiles...' : 'Restoring...'}
            </h2>
            <div className="mt-5 flex justify-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-foreground" />
            </div>
          </>
        )}

        {step === 'pick' && (
          <>
            <h2 id="parent-restore-title" className="mt-3 font-display text-xl font-bold text-foreground">
              Which learner?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Multiple profiles are linked to your account. Pick the one to restore.
            </p>

            <div className="mt-4 space-y-2">
              {learners.map((l) => (
                <button
                  key={l.learnerId}
                  type="button"
                  onClick={() => handlePick(l.learnerId)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background/50 px-4 py-3 text-left transition-colors hover:border-primary/70 hover:bg-primary/5"
                >
                  {l.avatar && (
                    <img
                      src={`https://api.dicebear.com/7.x/${l.avatar.style}/svg?seed=${encodeURIComponent(l.avatar.seed)}`}
                      alt=""
                      className="h-10 w-10 rounded-full"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-display text-sm font-bold text-foreground">
                    {l.displayName ?? 'Space Explorer'}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-card/50"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

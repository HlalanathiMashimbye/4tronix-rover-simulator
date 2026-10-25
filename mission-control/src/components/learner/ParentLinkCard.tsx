'use client';

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Unlink } from 'lucide-react';
import { useLearner } from '@/contexts/LearnerContext';
import { browserAuth } from '@/infrastructure/container.browser';

const EXIT_MS = 200;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ParentLinkCard({ open, onClose }: Props) {
  const { linkParent, unlinkParent } = useLearner();
  const [step, setStep] = useState<'consent' | 'linking' | 'linked' | 'unlinking'>('consent');
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setStep('consent');
      setError(null);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    exitTimer.current = setTimeout(() => {
      setStep('consent');
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

  async function handleLink() {
    setStep('linking');
    setError(null);

    try {
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(browserAuth(), provider);
      const idToken = await credential.user.getIdToken(true);

      const auth = browserAuth();
      await auth.signOut();

      const result = await linkParent(idToken);
      if (result.success) {
        setStep('linked');
      } else {
        setError(result.error ?? 'Could not link your account.');
        setStep('consent');
      }
    } catch {
      setError('Sign-in did not finish. Please try again.');
      setStep('consent');
    }
  }

  async function handleUnlink() {
    setStep('unlinking');
    setError(null);

    try {
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(browserAuth(), provider);
      const idToken = await credential.user.getIdToken(true);

      const auth = browserAuth();
      await auth.signOut();

      const result = await unlinkParent(idToken);
      if (result.success) {
        onClose();
      } else {
        setError(result.error ?? 'Could not unlink your account.');
        setStep('linked');
      }
    } catch {
      setError('Sign-in did not finish. Please try again.');
      setStep('linked');
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center px-4 py-8 ${visible ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="parent-link-title"
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
          <ShieldCheck className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>

        {step === 'consent' && (
          <>
            <h2 id="parent-link-title" className="mt-3 font-display text-xl font-bold text-foreground">
              Link a parent account
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in with your Google account to link it to this learner profile.
              This lets you restore their progress on a new device without a recovery code.
            </p>
            <div className="mt-4 rounded-xl border border-border/60 bg-background/50 p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">What we store:</p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                <li>Only your account ID — not your name or email</li>
                <li>A record of your consent and when you gave it</li>
              </ul>
              <p className="mt-2 font-semibold text-foreground">You can:</p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                <li>Unlink at any time, which deletes the link completely</li>
                <li>Restore the learner profile on any device by signing in</li>
              </ul>
            </div>

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
                onClick={handleLink}
                className="rounded-lg bg-gradient-to-r from-orange-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-900/20"
              >
                Sign in with Google
              </button>
            </div>
          </>
        )}

        {step === 'linking' && (
          <>
            <h2 id="parent-link-title" className="mt-3 font-display text-xl font-bold text-foreground">
              Linking...
            </h2>
            <div className="mt-5 flex justify-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-foreground" />
            </div>
          </>
        )}

        {step === 'linked' && (
          <>
            <h2 id="parent-link-title" className="mt-3 font-display text-xl font-bold text-foreground">
              Parent account linked
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              You can now restore this learner&apos;s profile on any device by signing in
              with the same Google account.
            </p>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={handleUnlink}
                className="flex items-center gap-1.5 text-xs font-medium text-red-400 transition-colors hover:text-red-300"
              >
                <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                Unlink and delete
              </button>
              <button
                type="button"
                onClick={onClose}
                className="clay clay-press rounded-xl bg-gradient-mars px-6 py-2.5 text-sm font-bold text-primary-foreground"
              >
                Done
              </button>
            </div>
          </>
        )}

        {step === 'unlinking' && (
          <>
            <h2 id="parent-link-title" className="mt-3 font-display text-xl font-bold text-foreground">
              Unlinking...
            </h2>
            <div className="mt-5 flex justify-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-foreground" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useLearner } from '@/contexts/LearnerContext';
import { getFirebaseAuth } from '@/infrastructure/persistence/firebase-client';

const EXIT_MS = 200;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SaveProfileModal({ open, onClose }: Props) {
  const { generateRecoveryCode, linkParent, markProfileSaved } = useLearner();
  const [method, setMethod] = useState<'code' | 'parent'>('code');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedCheck, setSavedCheck] = useState(false);
  const [linking, setLinking] = useState(false);
  const [visible, setVisible] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateRecoveryCode();
      if (result) {
        setRecoveryKey(result);
      } else {
        setError('Could not generate a recovery code. Please try again.');
      }
    } catch {
      setError('Could not generate a recovery code. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [generateRecoveryCode]);

  useEffect(() => {
    if (open) {
      generate();
      setMethod('code');
      setSavedCheck(false);
      setCopied(false);
      setError(null);
      setLinking(false);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    exitTimer.current = setTimeout(() => {
      setRecoveryKey(null);
      setSavedCheck(false);
      setCopied(false);
      setError(null);
    }, EXIT_MS);
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [open, generate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open && !visible) return null;

  const handleCopy = async () => {
    if (!recoveryKey) return;
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: user can select manually
    }
  };

  const handleDone = async () => {
    if (method === 'code') {
      markProfileSaved();
      onClose();
    } else {
      setLinking(true);
      setError(null);
      try {
        const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const credential = await signInWithPopup(getFirebaseAuth(), provider);
        const idToken = await credential.user.getIdToken(true);
        const auth = getFirebaseAuth();
        await auth.signOut();
        const result = await linkParent(idToken);
        if (result.success) {
          markProfileSaved();
          onClose();
        } else {
          setError(result.error ?? 'Could not link your account.');
        }
      } catch {
        setError('Sign-in did not finish. Please try again.');
      } finally {
        setLinking(false);
      }
    }
  };

  const doneDisabled = method === 'code' ? (!savedCheck || !recoveryKey || loading) : linking;

  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center overflow-y-auto px-4 py-8 ${visible ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-profile-title"
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      <div
        className={`relative z-[101] w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 id="save-profile-title" className="pr-12 font-display text-2xl font-bold text-foreground">
          Save your profile
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick one way to get back to your missions on any device.
        </p>

        {/* Option A: Recovery code */}
        <button
          type="button"
          onClick={() => setMethod('code')}
          className={`mt-5 w-full rounded-2xl border-2 p-4 text-left transition-colors ${
            method === 'code' ? 'border-foreground' : 'border-border'
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                method === 'code'
                  ? 'border-blue-600 bg-blue-600'
                  : 'border-muted-foreground/40'
              }`}
              aria-hidden="true"
            >
              {method === 'code' && (
                <span className="h-2 w-2 rounded-full bg-white" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">Get a recovery code</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                A short code you keep. Enter it on any device to get back in.
              </p>
            </div>
          </div>
        </button>

        {method === 'code' && (
          <div className="mt-3 space-y-3 px-1">
            {loading && (
              <div className="flex justify-center py-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
              </div>
            )}
            {error && method === 'code' && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            {recoveryKey && !loading && (
              <>
                <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-4 py-3">
                  <span className="min-w-0 flex-1 font-mono text-lg font-bold tracking-wider text-foreground">
                    {recoveryKey}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Copied
                      </>
                    ) : (
                      'Copy'
                    )}
                  </button>
                </div>
                <label className="flex items-center gap-2.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={savedCheck}
                    onChange={(e) => setSavedCheck(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-foreground"
                  />
                  I&apos;ve saved my code somewhere safe
                </label>
              </>
            )}
          </div>
        )}

        {/* Option B: Parent email */}
        <button
          type="button"
          onClick={() => setMethod('parent')}
          className={`mt-3 w-full rounded-2xl border-2 p-4 text-left transition-colors ${
            method === 'parent' ? 'border-foreground' : 'border-border'
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                method === 'parent'
                  ? 'border-blue-600 bg-blue-600'
                  : 'border-muted-foreground/40'
              }`}
              aria-hidden="true"
            >
              {method === 'parent' && (
                <span className="h-2 w-2 rounded-full bg-white" />
              )}
            </span>
            <div>
              <p className="font-semibold text-foreground">Link a parent&apos;s email</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                A parent signs in with Google. Best for keeping progress safe long term.
              </p>
            </div>
          </div>
        </button>

        {error && method === 'parent' && (
          <p className="mt-2 px-1 text-sm text-red-500">{error}</p>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 items-center rounded-full border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDone}
            disabled={doneDisabled}
            className="flex h-11 items-center rounded-full bg-foreground px-5 text-sm font-semibold text-background transition-opacity disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-foreground/20"
          >
            {linking ? 'Linking…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}

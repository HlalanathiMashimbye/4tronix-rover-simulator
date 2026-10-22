'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLearner } from '@/contexts/LearnerContext';
import {
  formatRecoveryCode,
  normaliseRecoveryCode,
  RECOVERY_CODE_LENGTH,
} from '@/core/domain/services/recoveryCode';
import { getFirebaseAuth } from '@/infrastructure/persistence/firebase-client';

type Variant = 'default' | 'welcome';

interface Props {
  onSuccess: () => void;
  onBack: () => void;
  backLabel?: string;
  variant?: Variant;
  autoFocusInput?: boolean;
}

export function RestoreProfileContent({
  onSuccess,
  onBack,
  backLabel = 'Cancel',
  variant = 'default',
  autoFocusInput = false,
}: Props) {
  const { restoreFromCode, restoreFromParent, adoptLearner } = useLearner();
  const [tab, setTab] = useState<'code' | 'parent'>('code');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const tabCodeRef = useRef<HTMLButtonElement>(null);
  const tabParentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocusInput && tab === 'code') {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [autoFocusInput, tab]);

  const switchTab = useCallback(
    (next: 'code' | 'parent') => {
      setTab(next);
      setError(null);
    },
    [],
  );

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = tab === 'code' ? 'parent' : 'code';
        switchTab(next);
        (next === 'code' ? tabCodeRef : tabParentRef).current?.focus();
      }
    },
    [tab, switchTab],
  );

  const handleChange = (value: string) => {
    setError(null);
    const normalised = normaliseRecoveryCode(value);
    setInput(formatRecoveryCode(normalised));
  };

  const handleRestore = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const normalised = normaliseRecoveryCode(input);
    if (normalised.length !== RECOVERY_CODE_LENGTH) {
      setError('Please enter all 10 characters of your recovery code.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await restoreFromCode(normalised);
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error ?? 'Code not recognised');
        setSubmitting(false);
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  const handleGoogleRestore = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { GoogleAuthProvider, signInWithPopup } = await import(
        'firebase/auth'
      );
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(getFirebaseAuth(), provider);
      const idToken = await credential.user.getIdToken(true);
      const auth = getFirebaseAuth();
      await auth.signOut();
      const result = await restoreFromParent(idToken);
      if (result.success && result.learners && result.learners.length > 0) {
        await adoptLearner(result.learners[0].learnerId);
        onSuccess();
      } else {
        setError(
          result.error ??
            "We couldn’t find a profile for that account.",
        );
      }
    } catch {
      setError('Sign-in was cancelled or failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const w = variant === 'welcome';

  const primaryCls = w
    ? 'clay clay-press flex h-11 items-center rounded-xl bg-gradient-mars px-5 text-sm font-bold text-primary-foreground disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/30'
    : 'flex h-11 items-center rounded-full bg-foreground px-5 text-sm font-semibold text-background transition-opacity disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-foreground/20';

  const secondaryCls = w
    ? 'flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 rounded'
    : 'flex h-11 items-center rounded-full border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20';

  const googleCls = w
    ? 'clay clay-press mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-gradient-mars text-sm font-bold text-primary-foreground disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/30'
    : 'mt-4 flex h-12 w-full items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background transition-opacity disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-foreground/20';

  const backButton = (
    <button type="button" onClick={onBack} className={secondaryCls}>
      {w && <ArrowLeft className="h-3 w-3" aria-hidden="true" />}
      {backLabel}
    </button>
  );

  return (
    <div>
      <div className="flex rounded-full bg-muted/50 p-1" role="tablist">
        <button
          ref={tabCodeRef}
          type="button"
          role="tab"
          id="restore-tab-code"
          aria-selected={tab === 'code'}
          aria-controls="restore-panel-code"
          tabIndex={tab === 'code' ? 0 : -1}
          onClick={() => switchTab('code')}
          onKeyDown={handleTabKeyDown}
          className={`flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-foreground/20 ${
            tab === 'code'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground'
          }`}
        >
          Use a code
        </button>
        <button
          ref={tabParentRef}
          type="button"
          role="tab"
          id="restore-tab-parent"
          aria-selected={tab === 'parent'}
          aria-controls="restore-panel-parent"
          tabIndex={tab === 'parent' ? 0 : -1}
          onClick={() => switchTab('parent')}
          onKeyDown={handleTabKeyDown}
          className={`flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-foreground/20 ${
            tab === 'parent'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground'
          }`}
        >
          Use parent&apos;s email
        </button>
      </div>

      {tab === 'code' ? (
        <form
          onSubmit={handleRestore}
          role="tabpanel"
          id="restore-panel-code"
          aria-labelledby="restore-tab-code"
        >
          <label className="mt-4 block text-sm font-medium text-foreground">
            Recovery code
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="MARS-4K7Q-92XD"
              className="mt-2 w-full rounded-xl border border-border bg-muted/30 px-4 py-3 font-mono text-lg tracking-widest outline-none transition placeholder:text-muted-foreground/40 focus:border-foreground focus:ring-2 focus:ring-foreground/20"
              autoComplete="off"
              spellCheck={false}
              maxLength={12}
            />
          </label>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the code you saved. It switches this device to that profile.
          </p>
          <div
            className={`mt-5 flex items-center ${w ? 'justify-between' : 'justify-end gap-3'}`}
          >
            {backButton}
            <button type="submit" disabled={submitting} className={primaryCls}>
              {submitting ? 'Restoring…' : 'Restore profile'}
            </button>
          </div>
        </form>
      ) : (
        <div
          role="tabpanel"
          id="restore-panel-parent"
          aria-labelledby="restore-tab-parent"
        >
          <p className="mt-4 text-sm text-muted-foreground">
            Sign in with the Google account your parent linked to this profile.
          </p>
          <button
            type="button"
            onClick={handleGoogleRestore}
            disabled={submitting}
            className={googleCls}
          >
            {submitting ? 'Signing in…' : 'Continue with Google'}
          </button>
          <p className="mt-3 text-sm text-muted-foreground">
            We only use it to find your profile.
          </p>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          <div
            className={`mt-5 flex ${w ? 'justify-start' : 'justify-end'}`}
          >
            {backButton}
          </div>
        </div>
      )}
    </div>
  );
}

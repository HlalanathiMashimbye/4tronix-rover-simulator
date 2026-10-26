'use client';

import { useEffect, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useLearner } from '@/contexts/LearnerContext';
import { formatRecoveryCode, normaliseRecoveryCode, RECOVERY_CODE_LENGTH } from '@/core/domain/services/recoveryCode';

const EXIT_MS = 200;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RestoreFromCode({ open, onClose }: Props) {
  const { restoreFromCode } = useLearner();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [visible, setVisible] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setInput('');
      setError(null);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    exitTimer.current = setTimeout(() => {
      setInput('');
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

  const handleChange = (value: string) => {
    setError(null);
    const normalised = normaliseRecoveryCode(value);
    setInput(formatRecoveryCode(normalised));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    const normalised = normaliseRecoveryCode(input);
    if (normalised.length !== RECOVERY_CODE_LENGTH) {
      setError('Please enter all 10 characters of your recovery code.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await restoreFromCode(normalised);

    if (result.success) {
      onClose();
    } else {
      setError(result.error ?? 'Code not recognised');
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center px-4 py-8 ${visible ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-title"
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      <form
        onSubmit={handleSubmit}
        className={`relative z-[101] w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-6 shadow-2xl backdrop-blur-sm transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
          <KeyRound className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>

        <h2 id="restore-title" className="mt-3 font-display text-xl font-bold text-foreground">
          Continue on this device
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          Enter the recovery code from your other device to pick up your missions
          and progress here.
        </p>

        <label className="mt-4 block">
          <input
            value={input}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="XXXX-XXX-XXX"
            className="mt-2 w-full rounded-xl border border-border bg-background/70 px-4 py-3 font-mono text-lg tracking-widest outline-none transition placeholder:text-muted-foreground/40 focus:border-primary focus:ring-2 focus:ring-primary/30"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
          />
        </label>

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-card/50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-gradient-to-r from-orange-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-900/20 disabled:opacity-50"
          >
            {submitting ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      </form>
    </div>
  );
}

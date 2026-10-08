'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, KeyRound, Check } from 'lucide-react';
import { useLearner } from '@/contexts/LearnerContext';

const EXIT_MS = 200;

interface Props {
  open: boolean;
  onClose: () => void;
  onSkip?: () => void;
}

export function RecoveryCodeCard({ open, onClose, onSkip }: Props) {
  const { generateRecoveryCode } = useLearner();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateRecoveryCode();
      if (result) {
        setCode(result);
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
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    exitTimer.current = setTimeout(() => {
      setCode(null);
      setCopied(false);
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
    if (!code) return;
    try {
      const recoveryText = code;
      await navigator.clipboard.writeText(recoveryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text for manual copy
    }
  };

  const handleDownload = () => {
    if (!code) return;
    const text = `Mars Rover Mission Control — Recovery Code\n\n${code}\n\nEnter this code on any device to restore your missions and progress.\nKeep it somewhere safe. If you lose it, you can generate a new one from your history page.\n`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovery-code.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center px-4 py-8 ${visible ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-title"
    >
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      <div
        className={`relative z-[101] w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-6 shadow-2xl backdrop-blur-sm transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
          <KeyRound className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>

        <h2 id="recovery-title" className="mt-3 font-display text-xl font-bold text-foreground">
          Your recovery code
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          Write this down or save it. You can enter it on another device to pick up
          your missions and progress.
        </p>

        {loading && (
          <div className="mt-4 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        )}

        {code && !loading && (
          <>
            <div className="mt-4 flex items-center justify-center rounded-xl border border-border bg-background/70 px-5 py-4">
              <span className="font-mono text-2xl font-bold tracking-[0.15em] text-foreground">
                {code}
              </span>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="clay clay-press flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground"
              >
                {copied ? (
                  <><Check className="h-4 w-4 text-emerald-500" aria-hidden="true" /> Copied</>
                ) : (
                  <><Copy className="h-4 w-4" aria-hidden="true" /> Copy</>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="clay clay-press flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground"
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Download
              </button>
            </div>
          </>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onClose}
            className="clay clay-press flex-1 rounded-xl bg-gradient-mars px-4 py-2.5 text-center text-sm font-bold text-primary-foreground"
          >
            Done
          </button>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="flex-1 rounded-xl px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              I&apos;ll skip this
            </button>
          )}
        </div>

        {onSkip && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            If you skip, clearing your browser will lose your missions and progress.
          </p>
        )}
      </div>
    </div>
  );
}

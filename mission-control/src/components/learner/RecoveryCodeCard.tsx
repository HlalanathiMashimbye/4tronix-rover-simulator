'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, Check } from 'lucide-react';
import Image from 'next/image';
import { useLearner } from '@/contexts/LearnerContext';

const EXIT_MS = 200;

interface Props {
  open: boolean;
  onClose: () => void;
  onSkip?: () => void;
  onBack?: () => void;
}

export function RecoveryCodeCard({ open, onClose, onSkip, onBack }: Props) {
  const { generateRecoveryCode } = useLearner();
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
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
        setRecoveryCode(result);
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
      setRecoveryCode(null);
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
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text for manual copy
    }
  };

  const handleDownload = () => {
    if (!recoveryCode) return;
    const text = `Mars Rover Mission Control — Recovery Code\n\n${recoveryCode}\n\nEnter this code on any device to restore your missions and progress.\nKeep it somewhere safe. If you lose it, you can generate a new one from your history page.\n`;
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
        className={`absolute inset-0 bg-black/70 transition-opacity duration-200 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      <div
        className={`relative z-[101] w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-xl transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <div className="flex items-center justify-center py-5">
          <div className="h-16 w-16 overflow-hidden rounded-2xl">
            <Image src="/rover-hero.jpg" alt="" width={128} height={128} className="h-full w-full object-cover" />
          </div>
        </div>

        <div className="px-6 pb-6">
          <h2 id="recovery-title" className="text-center font-display text-2xl font-bold text-foreground">
            Your secret key! 🔐
          </h2>

          <p className="mt-2 text-center text-sm text-muted-foreground">
            Save this code — it&apos;s your pass to pick up your missions on any device.
          </p>

          {loading && (
            <div className="mt-5 flex justify-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-foreground" />
            </div>
          )}

          {error && (
            <div className="mt-4 text-center">
              <p className="text-sm text-red-400">{error}</p>
              <button
                type="button"
                onClick={generate}
                disabled={loading}
                className="mt-2 text-sm font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Try again
              </button>
            </div>
          )}

          {recoveryCode && !loading && (
            <div
              className="mt-5 flex items-center gap-2 rounded-xl px-4 py-3"
              style={{
                background: 'oklch(0.42 0.17 285)',
                border: '1.5px solid oklch(0.52 0.19 285)',
              }}
            >
              <span className="min-w-0 flex-1 font-mono text-2xl font-bold tracking-[0.15em] text-white">
                {recoveryCode}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                aria-label={copied ? 'Copied' : 'Copy code'}
              >
                {copied
                  ? <Check className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                  : <Copy className="h-4 w-4" aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Download code"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                  Back
                </button>
              )}
              {onSkip && (
                <button
                  type="button"
                  onClick={onSkip}
                  className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Skip
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="clay clay-press rounded-xl bg-gradient-mars px-6 py-2.5 text-sm font-bold text-primary-foreground"
            >
              Done
            </button>
          </div>

          {onSkip && (
            <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
              Skipping means clearing your browser loses your progress.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

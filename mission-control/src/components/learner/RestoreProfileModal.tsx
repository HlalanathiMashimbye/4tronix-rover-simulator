'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { RestoreProfileContent } from './RestoreProfileContent';

const EXIT_MS = 200;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RestoreProfileModal({ open, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    exitTimer.current = setTimeout(() => {}, EXIT_MS);
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open && !visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center overflow-y-auto px-4 py-8 ${visible ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-profile-title"
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

        <h2
          id="restore-profile-title"
          className="pr-12 font-display text-2xl font-bold text-foreground"
        >
          Restore a profile
        </h2>

        <div className="mt-4">
          <RestoreProfileContent onSuccess={onClose} onBack={onClose} />
        </div>
      </div>
    </div>
  );
}

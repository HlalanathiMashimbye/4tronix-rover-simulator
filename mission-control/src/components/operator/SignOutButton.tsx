'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';

/**
 * Ends the server session and revokes it, so signing out takes effect
 * everywhere rather than only in this browser.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/session', { method: 'DELETE' });
    } finally {
      // Hard navigation so the server re-renders without the cookie. Also runs
      // if the request failed: the cookie is cleared server-side regardless,
      // and leaving someone looking at a console they are signed out of is
      // worse than a reload.
      window.location.replace('/operator');
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-label="Sign out"
      // Icon-only below md. The word is the first thing the console header can
      // give up on a phone: three labelled controls and a title do not share
      // 375px, and this one is recognisable without it.
      className="clay-press inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-card text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50 md:w-auto md:rounded-lg md:px-3.5"
    >
      <LogOut className="h-4 w-4 md:h-3.5 md:w-3.5" />
      <span className="hidden md:inline">{busy ? 'Signing out…' : 'Sign out'}</span>
    </button>
  );
}

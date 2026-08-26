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
      className="clay-press inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
    >
      <LogOut className="h-3.5 w-3.5" />
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

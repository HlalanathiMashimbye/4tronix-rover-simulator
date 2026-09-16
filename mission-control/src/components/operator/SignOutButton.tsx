'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';

import { menuItemClass } from '@/components/ui/Menu';

/**
 * Ends the server session and revokes it, so signing out takes effect
 * everywhere rather than only in this browser.
 */
export function SignOutButton({
  /**
   * `chip` in the laptop header, `menu-item` inside the phone's overflow
   * menu. One component with two shapes rather than two components, because
   * the thing that matters here - revoke, then hard-navigate even on failure -
   * must not be copied.
   */
  variant = 'chip',
}: {
  variant?: 'chip' | 'menu-item';
} = {}) {
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

  if (variant === 'menu-item') {
    return (
      <button type="button" role="menuitem" onClick={signOut} disabled={busy} className={menuItemClass}>
        <LogOut className="h-4 w-4 text-muted-foreground" />
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    );
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

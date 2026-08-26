'use client';

import { useState } from 'react';

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
    <button type="button" onClick={signOut} disabled={busy} style={style}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

const style = {
  marginTop: '0.5rem',
  padding: '0.5rem 0.9rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(128,128,128,0.4)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: '0.875rem',
};

'use client';

import { useState } from 'react';

import { getFirebaseAuth } from '@/lib/firebase';

/**
 * Operator sign-in (AB#342).
 *
 * Rendered at /operator itself when there is no session, so there is one route
 * to give an operator and no separate /login to stumble across.
 *
 * The flow is deliberately short-lived: sign in with Firebase, exchange the ID
 * token for a server session cookie, then hard-navigate. Nothing keeps client
 * auth state afterwards, because the server session is the only thing that
 * decides access.
 */
export function OperatorSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email, password);

      // Force-refresh so the token carries the CURRENT custom claims. Without
      // it, an operator granted the role moments ago signs in with a token
      // minted before the claim existed and is told they have no access. This
      // is the fix that resolved a first-login hang in the previous console.
      const token = await credential.user.getIdToken(true);

      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not sign you in');
      }

      // The Firebase client session has done its job. Dropping it means one
      // place holds identity from here on, which is the server cookie.
      await auth.signOut().catch(() => {});

      // Hard navigation, not router.push: the server needs to re-render the
      // page against the new cookie. A client transition would show the
      // sign-in form again while the server still saw no session.
      window.location.replace('/operator');
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  }

  return (
    <main style={styles.wrap}>
      <form onSubmit={handleSubmit} style={styles.card} noValidate>
        <h1 style={styles.heading}>Operator sign in</h1>

        {error && (
          <p role="alert" style={styles.error}>
            {error}
          </p>
        )}

        <label style={styles.label}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={styles.input}
          />
        </label>

        <button type="submit" disabled={busy || !email || !password} style={styles.button}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

/**
 * Firebase error codes are not for operators to read. Anything unrecognised
 * gets one generic message rather than a raw code: a facilitator at a science
 * centre can act on "check your email and password" and cannot act on
 * "auth/invalid-credential".
 */
function messageFor(err: unknown): string {
  const code = (err as { code?: string })?.code;

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'That email and password did not match. Check both and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check the connection and try again.';
    default:
      // Server-side refusals (no operator role, stale sign-in) arrive as plain
      // Errors and already carry a sentence written for a person.
      return err instanceof Error && err.message ? err.message : 'Could not sign you in.';
  }
}

const styles = {
  wrap: {
    minHeight: '70vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
  },
  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1rem',
    width: '100%',
    maxWidth: '22rem',
  },
  heading: { fontSize: '1.375rem', fontWeight: 700, marginBottom: '0.25rem' },
  label: { display: 'flex', flexDirection: 'column' as const, gap: '0.35rem', fontSize: '0.875rem' },
  input: {
    padding: '0.625rem 0.75rem',
    borderRadius: '0.5rem',
    border: '1px solid rgba(128,128,128,0.4)',
    fontSize: '1rem',
    background: 'transparent',
    color: 'inherit',
  },
  button: {
    padding: '0.7rem 1rem',
    borderRadius: '0.5rem',
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    fontWeight: 600,
    fontSize: '1rem',
    cursor: 'pointer',
  },
  error: {
    margin: 0,
    padding: '0.625rem 0.75rem',
    borderRadius: '0.5rem',
    background: 'rgba(220,38,38,0.12)',
    color: '#b91c1c',
    fontSize: '0.875rem',
  },
};

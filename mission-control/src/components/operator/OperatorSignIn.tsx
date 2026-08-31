'use client';

import { useState } from 'react';
import { AlertTriangle, Lock, MapPin } from 'lucide-react';

import { getFirebaseAuth } from '@/infrastructure/persistence/firebase-client';
import { selectableYards, type Yard } from '@/core/domain/entities/Yard';

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
 *
 * The yard is chosen HERE, and only here. It used to be a dropdown on the
 * console that could be changed at any moment, which made working at the wrong
 * yard a stray click; a mission attributed to the wrong place is invisible
 * until somebody notices a child's video is in the wrong city. Choosing it
 * with the password makes it part of starting a shift.
 */
export function OperatorSignIn({ yards }: { yards: Yard[] }) {
  const options = selectableYards(yards);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Preselected when there is only one, because a dropdown of one is a
  // statement of fact rather than a decision.
  const [yardId, setYardId] = useState(options.length === 1 ? options[0].id : '');
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
        body: JSON.stringify({ token, yardId }),
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
    <main className="relative flex h-[calc(100vh-64px)] items-center justify-center px-4 sm:px-6">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="clay w-full max-w-sm rounded-3xl border border-border/60 bg-card/70 p-7 backdrop-blur-xl"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="clay flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-mars">
            <Lock className="h-6 w-6 text-primary-foreground" />
          </span>
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Operator <span className="text-gradient-mars">sign in</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Yard staff only. Learners do not need an account.
            </p>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <div className="mt-6 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              className="h-11 rounded-lg border border-border/60 bg-background/70 px-3 text-sm text-foreground outline-none transition focus:border-primary/70"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="h-11 rounded-lg border border-border/60 bg-background/70 px-3 text-sm text-foreground outline-none transition focus:border-primary/70"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Which yard are you at?
            </span>
            {options.length === 1 ? (
              // One yard is a fact, not a choice. Shown so the operator can
              // see what they are signing in to, and submitted all the same.
              <span className="flex h-11 items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 text-sm text-foreground">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                {options[0].name}, {options[0].area}
              </span>
            ) : (
              <select
                value={yardId}
                onChange={(e) => setYardId(e.target.value)}
                required
                className="h-11 rounded-lg border border-border/60 bg-background/70 px-3 text-sm text-foreground outline-none transition focus:border-primary/70"
              >
                <option value="" disabled>
                  Choose a yard
                </option>
                {options.map((yard) => (
                  <option key={yard.id} value={yard.id}>
                    {yard.name}, {yard.area} ({yard.city})
                  </option>
                ))}
              </select>
            )}
            <span className="text-[11px] text-muted-foreground">
              Every mission you run is recorded here. Changing it means signing out.
            </span>
          </label>

          <button
            type="submit"
            disabled={busy || !email || !password || !yardId}
            className="clay-press mt-1 h-11 rounded-lg bg-gradient-mars font-display text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
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

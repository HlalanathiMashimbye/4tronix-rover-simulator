'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Lock, Mail, MapPin } from 'lucide-react';

import type { User } from 'firebase/auth';

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
/**
 * Refused because the account has no operator role, as opposed to any other
 * failure. Carries the signed-in user so "Ask an admin" can prove who is asking.
 */
class NoAccessError extends Error {
  constructor(message: string, readonly user: User, readonly email: string | null) {
    super(message);
  }
}

/** Only back into the operator console: `next` arrives in a URL anyone can craft. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith('/operator') && !next.startsWith('//') ? next : '/operator';
}

export function OperatorSignIn({ yards, next }: { yards: Yard[]; next?: string }) {
  const options = selectableYards(yards);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Preselected when there is only one, because a dropdown of one is a
  // statement of fact rather than a decision.
  const [yardId, setYardId] = useState(options.length === 1 ? options[0].id : '');
  const [error, setError] = useState<string | null>(null);
  // Which way in is running, so only that button says it is working.
  const [busy, setBusy] = useState<'password' | 'google' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [noAccess, setNoAccess] = useState<{ user: User; email: string | null } | null>(null);
  const [request, setRequest] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [requestError, setRequestError] = useState<string | null>(null);

  /**
   * Trade a signed-in Firebase user for the server session, then leave.
   *
   * Shared by both ways in, because everything after "Firebase says who this
   * is" is the same: the server decides access from the role claim, whichever
   * provider proved the identity.
   */
  async function startSession(user: User) {
    const auth = getFirebaseAuth();

    const exchange = async () => {
      // Force-refresh so the token carries the CURRENT custom claims. Without
      // it, an operator granted the role moments ago signs in with a token
      // minted before the claim existed and is told they have no access. This
      // is the fix that resolved a first-login hang in the previous console.
      const token = await user.getIdToken(true);
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, yardId }),
      });
      return { response, body: await response.json().catch(() => ({})) };
    };

    let { response, body } = await exchange();

    // A first Google sign-in for an address an admin invited: the server has
    // just written the role, after this token was minted. One fresh token
    // carries it. Once, not in a loop: a second refusal is a real one.
    if (response.status === 409 && body.refresh) {
      ({ response, body } = await exchange());
    }

    if (response.status === 403 && body.code === 'no-access') {
      throw new NoAccessError(body.error ?? 'No operator access', user, body.email ?? null);
    }

    if (!response.ok) {
      throw new Error(body.error ?? 'Could not sign you in');
    }

    // The Firebase client session has done its job. Dropping it means one
    // place holds identity from here on, which is the server cookie.
    await auth.signOut().catch(() => {});

    // Hard navigation, not router.push: the server needs to re-render the
    // page against the new cookie. A client transition would show the
    // sign-in form again while the server still saw no session.
    window.location.replace(safeNext(next));
  }

  /** Email the admins, as the person Google just verified. */
  async function askAdmin() {
    if (!noAccess) return;
    setRequest('sending');
    setRequestError(null);
    try {
      const token = await noAccess.user.getIdToken();
      const response = await fetch('/api/auth/access-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Could not send the request');
      setRequest('sent');
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Could not send the request');
      setRequest('failed');
    }
  }

  /** Closing the pop-up ends the Firebase sign-in: access has to start over anyway. */
  function closeNoAccess() {
    setNoAccess(null);
    setRequest('idle');
    setRequestError(null);
    getFirebaseAuth().signOut().catch(() => {});
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy('password');

    try {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
      await startSession(credential.user);
    } catch (err) {
      setError(messageFor(err));
      setBusy(null);
    }
  }

  async function handleGoogle() {
    setError(null);
    setBusy('google');

    try {
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      // Always offer the account chooser. A shared laptop at a venue is
      // usually signed in to somebody's personal Google account, and silently
      // using it would sign the wrong person in, or refuse them for no
      // reason they can see.
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(getFirebaseAuth(), provider);
      await startSession(credential.user);
    } catch (err) {
      if (err instanceof NoAccessError) {
        setNoAccess({ user: err.user, email: err.email });
        setBusy(null);
        return;
      }
      const code = (err as { code?: string })?.code;
      // The message points at the email and password fields, so show them.
      if (code === 'auth/account-exists-with-different-credential') setShowPassword(true);
      // Closing the chooser is changing your mind, not an error.
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setError(messageFor(err));
      }
      setBusy(null);
    }
  }

  return (
    <main className="relative flex h-page items-center justify-center px-4 sm:px-6">
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

          {/* The way in. Google is how operators sign in: it is what Manage
              access grants to, what an access request is sent as, and it needs
              no password to be issued or reset. So it is the one large button
              on the card. Styled to Google's sign-in guidance - the full-colour
              G on a plain surface - so it reads as Google's door. It needs the
              yard like the password route does: the session is for a yard,
              whichever way the person proved who they are. */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy !== null || !yardId}
            className="clay clay-press flex h-12 items-center justify-center gap-3 rounded-xl border border-border bg-background text-[15px] font-semibold text-foreground transition-colors hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleMark className="h-5 w-5" />
            {busy === 'google' ? 'Signing in…' : 'Continue with Google'}
          </button>

          {/* Email and password is only for accounts created by hand in
              Firebase Authentication, so it waits behind a link rather than
              asking every operator for a password they do not have. */}
          {showPassword ? (
            <div className="grid gap-4 border-t border-border/60 pt-4">
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

            <button
              type="submit"
              disabled={busy !== null || !email || !password || !yardId}
              className="clay-press mt-1 h-11 rounded-lg bg-gradient-mars font-display text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'password' ? 'Signing in…' : 'Sign in'}
            </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPassword(true)}
              className="justify-self-center text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Use email and password instead
            </button>
          )}
        </div>
      </form>

      {noAccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="no-access-title"
            className="clay w-full max-w-sm rounded-3xl border border-border/60 bg-card p-6 text-center"
          >
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              {request === 'sent' ? <Check className="h-5 w-5 text-primary" /> : <Mail className="h-5 w-5 text-primary" />}
            </span>

            {request === 'sent' ? (
              <>
                <h2 id="no-access-title" className="mt-4 font-display text-xl font-bold text-foreground">
                  Request sent
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  The admins have been emailed. Once one of them lets you in, sign in with Google again.
                </p>
                <button
                  type="button"
                  onClick={closeNoAccess}
                  className="clay-press mt-5 h-11 w-full rounded-lg bg-gradient-mars font-display text-sm font-bold text-primary-foreground"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <h2 id="no-access-title" className="mt-4 font-display text-xl font-bold text-foreground">
                  You don&apos;t have access yet
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {noAccess.email ? <span className="font-semibold text-foreground">{noAccess.email}</span> : 'This account'}{' '}
                  is not an operator yet. Ask an admin and they&apos;ll get an email to let you in.
                </p>
                {requestError && (
                  <p role="alert" className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {requestError}
                  </p>
                )}
                <div className="mt-5 grid gap-2">
                  <button
                    type="button"
                    onClick={askAdmin}
                    disabled={request === 'sending'}
                    className="clay-press h-11 rounded-lg bg-gradient-mars font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
                  >
                    {request === 'sending' ? 'Sending…' : 'Ask an admin'}
                  </button>
                  <button
                    type="button"
                    onClick={closeNoAccess}
                    className="h-11 rounded-lg border border-border bg-background text-sm font-semibold text-foreground hover:border-primary/70"
                  >
                    Not now
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

/** Google's "G", in its own four colours, as its sign-in branding asks. */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
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
    case 'auth/popup-blocked':
      return 'The browser blocked the Google window. Allow pop-ups for this site and try again.';
    case 'auth/account-exists-with-different-credential':
      // One account per email: this address already signs in with a password.
      return 'This email already signs in with a password. Use the email and password fields instead.';
    case 'auth/unauthorized-domain':
      return 'Google sign-in is not enabled for this web address yet. Use your email and password for now.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is switched off. Use your email and password, or ask an admin.';
    default:
      // Server-side refusals (no operator role, stale sign-in) arrive as plain
      // Errors and already carry a sentence written for a person.
      return err instanceof Error && err.message ? err.message : 'Could not sign you in.';
  }
}

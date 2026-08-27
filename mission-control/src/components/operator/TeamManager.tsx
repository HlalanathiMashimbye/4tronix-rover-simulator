'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Loader2, ShieldCheck, UserPlus, X } from 'lucide-react';

import type { OperatorAccount, OperatorRole } from '@/core/domain/entities/OperatorAccount';

/**
 * Granting and removing operator access, in the app.
 *
 * Every refusal shown here is decided on the server (see the team route and
 * OperatorAccount.changeBlocker). The disabled buttons below are a courtesy so
 * an admin can see why before clicking; they are not the control. Anyone
 * calling the API directly hits the same rules.
 */
export function TeamManager({
  initialAccounts,
  currentUid,
}: {
  initialAccounts: OperatorAccount[];
  currentUid: string;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OperatorRole>('operator');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const adminCount = accounts.filter((a) => a.role === 'admin').length;

  async function submit(targetEmail: string, nextRole: OperatorRole | null, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/operator/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, role: nextRole }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error ?? 'Could not apply that change');
        return;
      }

      if (data.accounts) setAccounts(data.accounts);
      if (data.message) setNotice(data.message);
      if (busyKey === 'grant') setEmail('');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-3.5 py-2.5 text-sm text-foreground"
        >
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{notice}</span>
        </div>
      )}

      {/* Grant */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) submit(email.trim(), role, 'grant');
        }}
        className="clay rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5"
      >
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-bold text-foreground">Give someone access</h2>
        </div>

        <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-end">
          <label className="grid flex-1 gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Email address
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="facilitator@example.com"
              className="h-11 rounded-lg border border-border/60 bg-background/70 px-3 text-sm text-foreground outline-none transition focus:border-primary/70"
            />
          </label>

          <label className="grid gap-1.5 sm:w-44">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Access level
            </span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OperatorRole)}
              className="h-11 rounded-lg border border-border/60 bg-background/70 px-3 text-sm text-foreground outline-none transition focus:border-primary/70"
            >
              <option value="operator">Operator</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={busy !== null}
            className="clay-press h-11 shrink-0 rounded-lg bg-gradient-mars px-5 font-display text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'grant' ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Granting
              </span>
            ) : (
              'Grant access'
            )}
          </button>
        </div>

        <p className="mt-2.5 text-xs text-muted-foreground">
          The person needs a Firebase Authentication account already. Granting
          access does not create one, and a new role only takes effect once they
          sign out and back in.
        </p>
      </form>

      {/* Current holders */}
      <div className="clay min-h-0 flex-1 overflow-y-auto rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5">
        <h2 className="font-display text-sm font-bold text-foreground">
          Who has access{' '}
          <span className="font-sans text-xs font-medium text-muted-foreground">
            ({accounts.length})
          </span>
        </h2>

        {adminCount === 1 && (
          // Not an error, but the single most fragile thing about this setup:
          // one admin means one forgotten password away from needing a script.
          <p className="mt-2.5 flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>
              There is only one admin. If that account is lost, granting access
              would need a script run against the database. Promoting a second
              admin avoids that.
            </span>
          </p>
        )}

        <ul className="mt-3 grid gap-2">
          {accounts.map((account) => {
            const isSelf = account.uid === currentUid;
            const isLastAdmin = account.role === 'admin' && adminCount === 1;
            const locked = isSelf || isLastAdmin;

            return (
              <li
                key={account.uid}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border/50 bg-background/40 px-3.5 py-3"
              >
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    account.role === 'admin'
                      ? 'bg-primary/15 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <ShieldCheck className="h-3 w-3" />
                  {account.role}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {account.email ?? account.uid}
                    {isSelf && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">you</span>
                    )}
                  </p>
                  {account.grantedBy && (
                    <p className="truncate text-xs text-muted-foreground">
                      Granted by {account.grantedBy}
                      {account.grantedAt
                        ? ` on ${new Date(account.grantedAt).toLocaleDateString('en-ZA')}`
                        : ''}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {account.role === 'operator' && account.email && (
                    <button
                      onClick={() => submit(account.email!, 'admin', `promote-${account.uid}`)}
                      disabled={busy !== null}
                      className="rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/70 disabled:opacity-50"
                    >
                      {busy === `promote-${account.uid}` ? 'Working' : 'Make admin'}
                    </button>
                  )}

                  <button
                    onClick={() => account.email && submit(account.email, null, `revoke-${account.uid}`)}
                    disabled={busy !== null || locked || !account.email}
                    title={
                      isSelf
                        ? 'You cannot remove your own access'
                        : isLastAdmin
                          ? 'The only admin cannot be removed'
                          : 'Remove access'
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-destructive transition-colors hover:border-destructive/70 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:border-border/60"
                  >
                    {busy === `revoke-${account.uid}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

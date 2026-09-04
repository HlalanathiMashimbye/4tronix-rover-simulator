import Link from 'next/link';
import { ShieldCheck, SlidersHorizontal, Users } from 'lucide-react';

import { getOperatorSession } from '@/infrastructure/auth/dal';
import { OperatorSignIn } from '@/components/operator/OperatorSignIn';
import { YardChip } from '@/components/operator/YardChip';
import { yardDirectory } from '@/infrastructure/config/yardDirectory';
import { findYardIn, yardLabelOf } from '@/core/domain/entities/Yard';
import { SignOutButton } from '@/components/operator/SignOutButton';
import { MissionQueue } from '@/components/operator/MissionQueue';

/**
 * One route for the operator surface: sign-in when there is no session, the
 * console when there is. Nothing to distribute except this URL.
 *
 * A server component, so the session is verified before anything renders. An
 * unauthenticated visitor is never sent operator markup at all, rather than
 * being sent it and having the browser hide it.
 */
export default async function OperatorPage() {
  const session = await getOperatorSession();

  if (!session) {
    return <OperatorSignIn yards={await yardDirectory()} />;
  }

  const yard = findYardIn(await yardDirectory(), session.yardId ?? undefined) ?? null;

  return (
    <main className="relative flex h-[calc(100dvh-var(--app-chrome))] flex-col overflow-hidden px-4 sm:px-6">
      {/* One line, not two. This console is a fixed-height page: everything
          spent here comes straight off the mission pane below, which is where
          the code and blocks have to fit. At 720px - an ordinary laptop - the
          old stacked header took 86px, leaving the code area 264px, about
          eleven lines. Title and identity on one baseline is 52px. */}
      <header className="mx-auto w-full max-w-page shrink-0 pt-3 pb-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="font-display text-xl font-bold tracking-tight text-foreground md:text-2xl">
            Operator <span className="text-gradient-mars">Console</span>
          </h1>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Signed in as {session.email ?? session.uid}.
          </p>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col gap-3 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="clay inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            {session.role}
          </span>
          {/* Chosen at sign-in and fixed for the session, so this states where
              they are rather than offering to change it. Clicking says how. */}
          <YardChip yard={yard} />

          {/* Admins only. An operator has no use for it and the page redirects
              them anyway, so showing it would be an invitation to a dead end. */}
          {session.role === 'admin' && (
            <Link
              href="/operator/team"
              className="clay inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/70"
            >
              <Users className="h-3.5 w-3.5 text-primary" />
              Manage access
            </Link>
          )}

          {session.role === 'admin' && (
            <Link
              href="/operator/settings"
              className="clay inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/70"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
              Settings
            </Link>
          )}
        </div>

        {yard ? (
          <MissionQueue
            role={session.role}
            yardId={yard.id}
            yardName={yardLabelOf(yard)}
            yards={await yardDirectory()}
          />
        ) : (
          // No yard on the session: one minted before the choice existed, or a
          // yard retired since. Sending them to sign in again is the only
          // honest option, because every write needs a yard to attribute to.
          <p className="rounded-2xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
            Sign out and back in to choose which yard you are at. Missions are recorded
            against a yard, so the queue cannot be shown without one.
          </p>
        )}

        <div className="flex justify-end">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}

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
    // h-page, not a hand-rolled calc: below md the learner tab bar covers the
    // bottom 4rem of the viewport, and this console was sized as if it did
    // not. The document scrolled by exactly that much and the last queue row
    // sat under the bar until you pushed the page up.
    <main className="relative flex h-page flex-col overflow-hidden px-3 sm:px-6">
      {/* One line, not two. This console is a fixed-height page: everything
          spent here comes straight off the mission pane below, which is where
          the code and blocks have to fit. At 720px - an ordinary laptop - the
          old stacked header took 86px, leaving the code area 264px, about
          eleven lines. Title and identity on one baseline is 52px.

          On a phone that same row was four: 375px cannot hold a title, two
          chips and three buttons side by side, so each wrapped onto its own
          line and the header took 200px of an 812px screen before the queue
          started. Below sm the three controls keep their icons and drop their
          words, and who-and-where moves to one truncating line underneath. */}
      <header className="mx-auto w-full max-w-page shrink-0 pt-2 pb-2 sm:pt-3">
        <div className="flex items-center gap-x-3 gap-y-0.5 sm:flex-wrap sm:items-baseline">
          <h1 className="font-display text-lg font-bold tracking-tight text-foreground sm:text-xl md:text-2xl">
            Operator <span className="text-gradient-mars">Console</span>
          </h1>
          <p className="hidden text-xs text-muted-foreground lg:block">
            Signed in as {session.email ?? session.uid}.
          </p>

          {/* Chips and sign-out live on the title's line rather than in rows of
              their own. This page is a fixed-height shell: the header, a chip
              row and a sign-out row were three separate blocks, and every one
              of them came off the mission pane, which is the only part with
              something to fit. */}
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="clay hidden items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-[11px] font-medium text-foreground sm:inline-flex">
              <ShieldCheck className="h-3 w-3 text-primary" />
              {session.role}
            </span>
            <span className="hidden sm:inline-flex">
              <YardChip yard={yard} />
            </span>
            {session.role === 'admin' && (
              <Link
                href="/operator/team"
                aria-label="Manage access"
                className="clay inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-card text-[11px] font-medium text-foreground transition-colors hover:border-primary/70 sm:h-auto sm:w-auto sm:px-2.5 sm:py-1"
              >
                <Users className="h-4 w-4 text-primary sm:h-3 sm:w-3" />
                <span className="hidden md:inline">Manage access</span>
              </Link>
            )}
            {session.role === 'admin' && (
              <Link
                href="/operator/settings"
                aria-label="Settings"
                className="clay inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-card text-[11px] font-medium text-foreground transition-colors hover:border-primary/70 sm:h-auto sm:w-auto sm:px-2.5 sm:py-1"
              >
                <SlidersHorizontal className="h-4 w-4 text-primary sm:h-3 sm:w-3" />
                <span className="hidden md:inline">Settings</span>
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>

        {/* Phone only, and the same two facts the chips above carry: which role
            this session has and which yard it is recorded against. A second
            YardChip rather than the one above moved, because the compact one
            has to sit in running text and the pill has to sit on the title's
            baseline - the label and the explanation behind it are still the
            component's, not copied here. */}
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground sm:hidden">
          <ShieldCheck className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
          <span className="shrink-0">{session.role}</span>
          <span aria-hidden="true" className="shrink-0">·</span>
          <YardChip yard={yard} compact />
        </p>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col gap-3 pb-5">
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
      </div>
    </main>
  );
}

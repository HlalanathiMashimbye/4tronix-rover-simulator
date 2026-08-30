import Link from 'next/link';
import { ShieldCheck, Users } from 'lucide-react';

import { getOperatorSession } from '@/lib/auth/dal';
import { OperatorSignIn } from '@/components/operator/OperatorSignIn';
import { SignOutButton } from '@/components/operator/SignOutButton';
import { YardPicker } from '@/components/operator/YardPicker';
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
    return <OperatorSignIn />;
  }

  return (
    <main className="relative flex h-[calc(100vh-64px)] flex-col overflow-hidden px-4 sm:px-6">
      <header className="mx-auto w-full max-w-page shrink-0 pt-4 pb-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Operator <span className="text-gradient-mars">Console</span>
        </h1>
        <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
          Signed in as {session.email ?? session.uid}.
        </p>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col gap-3 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="clay inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            {session.role}
          </span>
          {/* A choice, not a permission. An operator is an operator anywhere;
              the yard decides which queue they are looking at. */}
          <YardPicker />

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
        </div>

        <MissionQueue role={session.role} />

        <div className="flex justify-end">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}

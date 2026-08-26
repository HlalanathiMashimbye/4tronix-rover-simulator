import { ShieldCheck, MapPin } from 'lucide-react';

import { getOperatorSession } from '@/lib/auth/dal';
import { OperatorSignIn } from '@/components/operator/OperatorSignIn';
import { SignOutButton } from '@/components/operator/SignOutButton';

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

  const hasYards = session.yardIds.length > 0;

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
          <span
            className={`clay inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
              hasYards
                ? 'border-border/60 bg-card text-foreground'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
            }`}
          >
            <MapPin className="h-3.5 w-3.5" />
            {hasYards ? session.yardIds.join(', ') : 'No yard assigned'}
          </span>
        </div>

        <div className="clay flex flex-1 items-center justify-center rounded-3xl border border-border/60 bg-card/60 p-8 text-center">
          <div className="max-w-sm space-y-2">
            <p className="font-display text-lg font-bold text-foreground">
              {hasYards ? 'The mission queue lands here next' : 'Nothing to dispatch to yet'}
            </p>
            <p className="text-sm text-muted-foreground">
              {hasYards
                ? 'Sign-in and route protection are in place. The live queue arrives with the next story.'
                : 'This account has no yard assigned, so there is nowhere to send a mission. An admin can grant one.'}
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}

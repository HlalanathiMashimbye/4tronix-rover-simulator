import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { getOperatorSession } from '@/infrastructure/auth/dal';
import { TeamManager } from '@/components/operator/TeamManager';
import { listOperatorAccounts } from '@/infrastructure/auth/operatorAccounts';
import { listInvites } from '@/infrastructure/auth/operatorInvites';

/**
 * Managing who can operate, without a shell (AB#341 follow-on).
 *
 * A server component, so an operator who is not an admin is redirected before
 * any of this renders. They are never sent the markup and told not to look at
 * it.
 *
 * The list is fetched here rather than in the client component so the page
 * arrives populated. Changes afterwards come back from the API, which returns
 * the fresh list with every write.
 */
export const metadata = { title: 'Operator access' };

export default async function OperatorTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ grant?: string | string[] }>;
}) {
  const session = await getOperatorSession();
  const { grant } = await searchParams;
  const grantEmail = typeof grant === 'string' ? grant : undefined;

  if (!session) {
    // From an access-request email: sign in, then land back here with the
    // address still filled in, rather than on the console.
    const back = grantEmail ? `/operator/team?grant=${encodeURIComponent(grantEmail)}` : '/operator/team';
    redirect(`/operator?next=${encodeURIComponent(back)}`);
  }

  if (session.role !== 'admin') {
    // Back to the console rather than an error page. An operator landing here
    // has followed a stale link, not done something wrong.
    redirect('/operator');
  }

  const [accounts, invites] = await Promise.all([listOperatorAccounts(), listInvites()]);

  return (
    <main className="relative flex h-page flex-col overflow-hidden px-4 sm:px-6">
      <header className="mx-auto w-full max-w-page shrink-0 pt-4 pb-3">
        <Link
          href="/operator"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to console
        </Link>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Operator <span className="text-gradient-mars">access</span>
        </h1>
        <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
          Grant and remove operator access. This replaces running
          set-operator-role.mjs by hand.
        </p>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col pb-5">
        <TeamManager
          initialAccounts={accounts}
          initialInvites={invites}
          currentUid={session.uid}
          initialEmail={grantEmail}
        />
      </div>
    </main>
  );
}

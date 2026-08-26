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

  return (
    <main style={styles.wrap}>
      <h1 style={styles.heading}>Operator console</h1>
      <p style={styles.body}>
        Signed in as {session.email ?? session.uid} ({session.role}).
      </p>
      <p style={styles.body}>
        {session.yardIds.length > 0
          ? `Yards: ${session.yardIds.join(', ')}`
          : 'No yards assigned to this account yet, so there is nothing to dispatch to.'}
      </p>
      <p style={styles.note}>The mission queue arrives in the next story.</p>
      <SignOutButton />
    </main>
  );
}

const styles = {
  wrap: {
    minHeight: '60vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    padding: '2rem',
    textAlign: 'center' as const,
  },
  heading: { fontSize: '1.5rem', fontWeight: 700 },
  body: { opacity: 0.85, maxWidth: '32rem' },
  note: { opacity: 0.55, fontSize: '0.875rem' },
};

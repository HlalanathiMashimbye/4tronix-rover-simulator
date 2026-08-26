import { getOperatorSession } from '@/lib/auth/dal';

/**
 * AB#341 ships the lock; AB#342 ships the key.
 *
 * Right now this route exists, is verified, and is unreachable: nobody can
 * obtain a session cookie until the sign-in form and the session route land.
 * That is the correct resting state for a locked door, and it means the guard
 * can be reviewed and tested on its own rather than tangled up with a login.
 */
export default async function OperatorPage() {
  const session = await getOperatorSession();

  if (!session) {
    // Rendered in place rather than redirecting to a separate /login: one
    // route means one thing to distribute to operators, and nothing extra to
    // stumble across.
    return (
      <main style={styles.centre}>
        <h1 style={styles.heading}>Operator sign in</h1>
        <p style={styles.body}>
          Sign in is not available yet. It arrives with AB#342.
        </p>
      </main>
    );
  }

  return (
    <main style={styles.centre}>
      <h1 style={styles.heading}>Operator console</h1>
      <p style={styles.body}>
        Signed in as {session.email ?? session.uid} ({session.role}).
      </p>
      <p style={styles.body}>
        {session.yardIds.length > 0
          ? `Yards: ${session.yardIds.join(', ')}`
          : 'No yards assigned to this account yet.'}
      </p>
    </main>
  );
}

const styles = {
  centre: {
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
  body: { opacity: 0.8, maxWidth: '32rem' },
};

import 'server-only';

import { getFirebaseAdminAuth, getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import {
  isOperatorRole,
  sortAccounts,
  type OperatorAccount,
} from '@/core/domain/entities/OperatorAccount';

/**
 * Everyone holding operator access, read from Firebase Auth.
 *
 * Auth is the store that firestore.rules, dal.ts and the yard console all
 * enforce from, so it is what this reads. The users/{uid} ledger is decoration
 * on top: it can drift from Auth (the script wrote both, and an interrupted run
 * wrote one), and a page showing the drifted copy would tell an admin that
 * access was removed when it was not.
 *
 * listUsers is a full scan, which is fine here and worth stating plainly:
 * learners are not Firebase Auth users at all, so this collection holds staff
 * only and is currently 2 records. If learner accounts are ever introduced this
 * needs a different approach.
 *
 * Lives here rather than in the page or the route because both need it, and
 * two copies of "who has access" is the shape of bug this codebase has already
 * paid for twice.
 */
export async function listOperatorAccounts(): Promise<OperatorAccount[]> {
  const auth = getFirebaseAdminAuth();
  const db = getFirestoreInstance();

  const accounts: OperatorAccount[] = [];
  let pageToken: string | undefined;

  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      const role = user.customClaims?.role;
      if (isOperatorRole(role)) {
        // Deliberately a narrow DTO, not the Firebase UserRecord. That record
        // carries phone numbers, provider identities and password-hash
        // metadata, and this object crosses to the client. Next's own data
        // security guide is explicit that returning whole records is how
        // private fields leak (02-guides/data-security.md).
        accounts.push({ uid: user.uid, email: user.email ?? null, role });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  await Promise.all(
    accounts.map(async (account) => {
      try {
        const doc = await db.collection('users').doc(account.uid).get();
        if (doc.exists) {
          account.grantedAt = doc.data()?.grantedAt ?? null;
          account.grantedBy = doc.data()?.grantedBy ?? null;
        }
      } catch {
        // The ledger is an audit trail, not the access decision. Failing to
        // read it must not blank the page that manages access.
      }
    }),
  );

  return sortAccounts(accounts);
}

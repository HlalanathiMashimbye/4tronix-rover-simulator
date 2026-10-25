/**
 * Every Firestore collection this app reads or writes, named once.
 *
 * The names were string literals in a dozen files, so renaming one, or
 * checking which code touches it, meant a search that could miss a spelling.
 * firestore.rules names the same collections and is the other half of the
 * contract: a collection added here needs a rule there, or Firestore denies it.
 */
export const COLLECTIONS = {
  missions: 'missions',
  /** missions/{id}/runs: one yard's attempt each. */
  runs: 'runs',
  /** missions/{id}/automaticUploads: the ledger of videos sent for a run. */
  automaticUploads: 'automaticUploads',
  learners: 'learners',
  /** The operator access ledger. Access itself is the Auth custom claim. */
  users: 'users',
  operatorInvites: 'operatorInvites',
  operatorAccessRequests: 'operatorAccessRequests',
  yards: 'yards',
  missionNames: 'missionNames',
  /**
   * Fixed-window counters for the public routes' rate limits. Server-only:
   * written only by the Admin SDK (FirestoreRateLimiter), and deliberately
   * given no rule in firestore.rules, so a browser is denied it outright.
   */
  rateLimits: 'rateLimits',
} as const;

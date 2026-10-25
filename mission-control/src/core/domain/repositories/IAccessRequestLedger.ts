/**
 * When each account last asked an admin for operator access.
 *
 * One request an hour per account, so a nervous double-tap on "Ask an admin"
 * is one email, not two.
 */
export interface IAccessRequestLedger {
  /** When this account last asked, in milliseconds, or null if it never has. */
  lastRequestedAt(uid: string): Promise<number | null>;

  record(uid: string, email: string, notified: number): Promise<void>;
}

/**
 * When each account last asked an admin for operator access.
 *
 * One request an hour per account, so a nervous double-tap on "Ask an admin"
 * is one email, not two. The record also tracks which email went to which
 * admin, so granting the access can reply to each in their thread.
 */

import type { AccessRequestEmail } from '@/core/domain/entities/OperatorAccount';

export interface AccessRequestRecord {
  email: string | null;
  subject: string | null;
  requestedAt: string | null;
  sent: AccessRequestEmail[];
}

export interface IAccessRequestLedger {
  /** When this account last asked, in milliseconds, or null if it never has. */
  lastRequestedAt(uid: string): Promise<number | null>;

  /** The full record, or null if no request exists. */
  find(uid: string): Promise<AccessRequestRecord | null>;

  /** Overwrites the record, merging `earlier` sent emails with the latest. */
  record(uid: string, email: string, subject: string, sent: AccessRequestEmail[], earlier: AccessRequestEmail[]): Promise<void>;

  /**
   * Ends the request and returns it, or null if there was none.
   *
   * Deleted rather than marked done: if this person's access is later removed
   * and they ask again, that is a new request with new emails.
   */
  close(uid: string): Promise<AccessRequestRecord | null>;
}

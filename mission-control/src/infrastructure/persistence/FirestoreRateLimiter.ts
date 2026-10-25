/**
 * A fixed-window rate limiter kept in Firestore.
 *
 * One document per key, reused across windows: it holds the current window's
 * index and the count so far. A transaction does the read-modify-write, so two
 * requests racing for the last slot cannot both be allowed through.
 *
 * Server-only, like every Admin SDK class: the collection it writes has no
 * Firestore rule, so a browser is denied it outright (firestore.rules denies
 * anything unmatched). Only this class, built in container.server.ts, touches
 * it.
 *
 * Fail-open is deliberate and is the IRateLimiter contract: if Firestore
 * cannot be reached, a child must still be able to submit a mission, so a
 * store error is logged and the call is allowed. A limiter that failed closed
 * would turn a database blip into "no child can submit", which is a worse
 * outage than the flooding it defends against.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { IRateLimiter } from '@/core/domain/services/IRateLimiter';
import { COLLECTIONS } from './collections';

interface WindowDoc {
  windowIndex: number;
  count: number;
}

export class FirestoreRateLimiter implements IRateLimiter {
  constructor(
    private readonly db: Firestore,
    /** Injected so tests can drive the window with a fake clock. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  async allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const windowIndex = Math.floor(this.now() / 1000 / windowSeconds);
    const ref = this.db.collection(COLLECTIONS.rateLimits).doc(this.docId(key));

    try {
      return await this.db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const current = snapshot.exists ? (snapshot.data() as WindowDoc) : undefined;

        // A new key, or the first call of a new window: start the count over.
        if (!current || current.windowIndex !== windowIndex) {
          tx.set(ref, { windowIndex, count: 1 });
          return true;
        }

        if (current.count >= limit) {
          return false;
        }

        tx.set(ref, { count: current.count + 1 }, { merge: true });
        return true;
      });
    } catch (error) {
      // Fail open: never let a counter outage stop a child submitting work.
      console.error('[rate-limit] store unreachable, allowing the request:', error);
      return true;
    }
  }

  /** Firestore document ids may not contain a slash; nothing else a key holds
   * (an IP, a learner or mission id) is a problem, so only the slash is mapped. */
  private docId(key: string): string {
    return key.replace(/\//g, '_');
  }
}

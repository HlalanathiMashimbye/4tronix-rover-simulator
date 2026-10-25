/**
 * Where learner records are kept.
 *
 * The learner context used to talk to Firestore itself, so the Learner
 * aggregate had no repository while Mission had the full port and adapter,
 * and the one React context that writes to the database could not be tested
 * without faking Firestore. This is the port; the browser's Firestore adapter
 * is wired in container.browser.ts.
 *
 * Every method takes the learner's hashed id (learnerRef) alongside the raw
 * one, because the record stores the hash for history lookups and the raw id
 * never leaves the learner's own browser and their own record.
 */

import type { Learner } from '../entities/Learner';

export interface ILearnerRepository {
  /** The learner with this id, or null when this browser is new here. */
  findById(id: string): Promise<Learner | null>;

  /** Store a learner seen for the first time. */
  create(learner: Learner, learnerRef: string): Promise<void>;

  /**
   * Note that a returning learner is active again. A display name is written
   * only when given: one recorded before names existed gets one on its visit.
   */
  recordVisit(id: string, learnerRef: string, at: string, displayName?: string): Promise<void>;
}

/**
 * Learner records as the server sees them, through the Admin SDK.
 *
 * The browser's own record goes through ILearnerRepository, under Firestore
 * rules. These are the server routes' needs: a profile the server validated,
 * a recovery code or parent link for a learner who may not have a record yet,
 * and the names and avatars a parent picks between. Routes reach this through
 * container.server.ts and never touch Firestore themselves.
 */

import type { LearnerAvatar } from '../entities/Learner';

export interface LearnerProfile {
  learnerId: string;
  displayName?: string;
  avatar?: LearnerAvatar;
}

export interface LearnerChallengeCompletions {
  learnerId: string;
  challengeIds: string[];
}

export interface ILearnerAccounts {
  exists(learnerId: string): Promise<boolean>;

  /** A recovery code may be issued before the learner's browser has written a record. */
  ensureExists(learnerId: string, at: string): Promise<void>;

  saveProfile(learnerId: string, displayName: string, avatar: LearnerAvatar, at: string): Promise<void>;

  /** In the order asked for; a learner with no record comes back with neither field. */
  profiles(learnerIds: string[]): Promise<LearnerProfile[]>;

  /** Every learner and the challenges they have completed (often none), for the leaderboard backfill. */
  challengeCompletions(): Promise<LearnerChallengeCompletions[]>;
}

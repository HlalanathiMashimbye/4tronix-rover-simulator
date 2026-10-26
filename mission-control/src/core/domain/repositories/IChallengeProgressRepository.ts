/**
 * Challenge Progress Repository Interface
 *
 * Repository pattern / Dependency Inversion, same role as IMissionRepository:
 * the domain layer states the contract, infrastructure provides it.
 */

import { ChallengeId } from '../entities/Challenge';
import { ChallengeProgress } from '../entities/ChallengeProgress';

export interface IChallengeProgressRepository {
  /** A learner's progress, or an empty ChallengeProgress if they have none yet. */
  getProgress(learnerId: string): Promise<ChallengeProgress>;

  /** Idempotent: completing an already-complete challenge again is a no-op. */
  markChallengeComplete(learnerId: string, challengeId: ChallengeId, completedAt: string): Promise<void>;
}

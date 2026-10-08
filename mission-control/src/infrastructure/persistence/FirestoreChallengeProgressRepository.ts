/**
 * Firestore Challenge Progress Repository
 *
 * Stores a learner's Progressive Challenges progress on their EXISTING
 * `learners/{learnerId}` document (`progress` field), not a new collection.
 * firestore.rules already allowlists `progress` on both create and update for
 * client writes, the same client SDK path LearnerContext already uses for
 * `lastActiveAt`/`learnerRef` - so this is a plain client-side Firestore
 * read/write, not an API route: unlike the learner's email, progress carries
 * no PII, so the trust model that keeps the address server-only doesn't apply.
 */

import { doc, Firestore, getDoc, setDoc } from 'firebase/firestore';
import { ChallengeId } from '@/core/domain/entities/Challenge';
import { ChallengeProgress } from '@/core/domain/entities/ChallengeProgress';
import { IChallengeProgressRepository } from '@/core/domain/repositories/IChallengeProgressRepository';

const EMPTY_PROGRESS: ChallengeProgress = { completions: [] };

export class FirestoreChallengeProgressRepository implements IChallengeProgressRepository {
  constructor(private readonly db: Firestore) {}

  async getProgress(learnerId: string): Promise<ChallengeProgress> {
    const snapshot = await getDoc(doc(this.db, 'learners', learnerId));
    if (!snapshot.exists()) return EMPTY_PROGRESS;

    const progress = snapshot.data().progress as ChallengeProgress | undefined;
    return progress ?? EMPTY_PROGRESS;
  }

  async markChallengeComplete(
    learnerId: string,
    challengeId: ChallengeId,
    completedAt: string,
  ): Promise<void> {
    const current = await this.getProgress(learnerId);
    if (current.completions.some((c) => c.challengeId === challengeId)) return;

    const next: ChallengeProgress = {
      ...current,
      completions: [...current.completions, { challengeId, completedAt }],
    };

    // merge: true so this never clobbers the rest of the learner document -
    // it may be the first write to a learner doc that doesn't exist yet (a
    // create, under the same rules-allowlisted `progress` key) just as
    // easily as an update to one LearnerContext already created.
    await setDoc(doc(this.db, 'learners', learnerId), { progress: next }, { merge: true });
  }
}

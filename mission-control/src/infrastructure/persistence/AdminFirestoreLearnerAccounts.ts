import type { Firestore } from 'firebase-admin/firestore';

import type { LearnerAvatar } from '@/core/domain/entities/Learner';
import type {
  ILearnerAccounts,
  LearnerChallengeCompletions,
  LearnerProfile,
} from '@/core/domain/repositories/ILearnerAccounts';
import { COLLECTIONS } from '@/infrastructure/persistence/collections';

export class AdminFirestoreLearnerAccounts implements ILearnerAccounts {
  constructor(private readonly db: Firestore) {}

  private learner(learnerId: string) {
    return this.db.collection(COLLECTIONS.learners).doc(learnerId);
  }

  async exists(learnerId: string): Promise<boolean> {
    return (await this.learner(learnerId).get()).exists;
  }

  async ensureExists(learnerId: string, at: string): Promise<void> {
    const ref = this.learner(learnerId);
    if (!(await ref.get()).exists) await ref.set({ createdAt: at }, { merge: true });
  }

  async saveProfile(learnerId: string, displayName: string, avatar: LearnerAvatar, at: string): Promise<void> {
    await this.learner(learnerId).set({ displayName, avatar, lastActiveAt: at }, { merge: true });
  }

  async profiles(learnerIds: string[]): Promise<LearnerProfile[]> {
    return Promise.all(learnerIds.map(async (learnerId) => {
      const data = (await this.learner(learnerId).get()).data();
      return {
        learnerId,
        displayName: (data?.displayName as string | undefined) || undefined,
        avatar: data?.avatar as LearnerAvatar | undefined,
      };
    }));
  }

  async challengeCompletions(): Promise<LearnerChallengeCompletions[]> {
    const snapshot = await this.db.collection(COLLECTIONS.learners).get();
    return snapshot.docs.map((learnerDoc) => {
      const completions = learnerDoc.data().progress?.completions as { challengeId: string }[] | undefined;
      return { learnerId: learnerDoc.id, challengeIds: (completions ?? []).map((c) => c.challengeId) };
    });
  }
}

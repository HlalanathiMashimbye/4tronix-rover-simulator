/**
 * Firestore Leaderboard Repository Implementation
 *
 * Implements ILeaderboardRepository using Firestore.
 * Only used server-side (Admin SDK) to prevent client manipulation.
 */

import { Firestore, Query } from 'firebase-admin/firestore';
import { LeaderboardEntry } from '@/core/domain/entities/LeaderboardEntry';
import {
  ILeaderboardRepository,
  LeaderboardPage,
  LeaderboardCursor,
} from '@/core/domain/repositories/ILeaderboardRepository';
import { generateNickname } from '@/core/domain/services/nicknameGenerator';

const LEADERBOARD_COLLECTION = 'leaderboardEntries';

export class FirestoreLeaderboardRepository implements ILeaderboardRepository {
  constructor(private readonly db: Firestore) {}

  async getOrCreate(
    learnerRefHash: string,
    nickname: string
  ): Promise<LeaderboardEntry> {
    const ref = this.db.collection(LEADERBOARD_COLLECTION).doc(learnerRefHash);
    const snap = await ref.get();

    if (snap.exists) {
      return snap.data() as LeaderboardEntry;
    }

    const now = new Date().toISOString();
    const entry: LeaderboardEntry = {
      id: learnerRefHash,
      leaderboardId: 'default',
      displayName: nickname,
      score: 0,
      completedChallenges: 0,
      completedChallengeIds: [],
      optedIn: false,
      createdAt: now,
      updatedAt: now,
    };

    await ref.set(entry);
    return entry;
  }

  async findByLearnerRef(learnerRefHash: string): Promise<LeaderboardEntry | null> {
    const ref = this.db.collection(LEADERBOARD_COLLECTION).doc(learnerRefHash);
    const snap = await ref.get();
    return snap.exists ? (snap.data() as LeaderboardEntry) : null;
  }

  async updateScore(
    learnerRefHash: string,
    completedChallenges: number,
    score: number,
    completedChallengeIds?: string[]
  ): Promise<LeaderboardEntry> {
    const ref = this.db.collection(LEADERBOARD_COLLECTION).doc(learnerRefHash);

    // Ensure entry exists before updating
    const entry = await this.getOrCreate(learnerRefHash, generateNickname());

    const updates: Record<string, unknown> = {
      completedChallenges,
      score,
      updatedAt: new Date().toISOString(),
    };

    if (completedChallengeIds) {
      updates.completedChallengeIds = completedChallengeIds;
    }

    await ref.update(updates);

    return {
      ...entry,
      ...updates,
      completedChallengeIds: completedChallengeIds ?? entry.completedChallengeIds,
    } as LeaderboardEntry;
  }

  async optIn(learnerRefHash: string, displayName: string): Promise<LeaderboardEntry> {
    const ref = this.db.collection(LEADERBOARD_COLLECTION).doc(learnerRefHash);
    const now = new Date().toISOString();

    // Ensure entry exists
    const entry = await this.getOrCreate(learnerRefHash, displayName);

    await ref.update({
      optedIn: true,
      displayName,
      optedInAt: now,
      updatedAt: now,
    });

    return {
      ...entry,
      optedIn: true,
      displayName,
      optedInAt: now,
      updatedAt: now,
    };
  }

  async optOut(learnerRefHash: string): Promise<void> {
    const ref = this.db.collection(LEADERBOARD_COLLECTION).doc(learnerRefHash);
    await ref.update({
      optedIn: false,
      updatedAt: new Date().toISOString(),
    });
  }

  async getPublicLeaderboard(limit: number, cursor?: LeaderboardCursor): Promise<LeaderboardPage> {
    let query: Query = this.db
      .collection(LEADERBOARD_COLLECTION)
      .where('optedIn', '==', true)
      .orderBy('score', 'desc')
      .orderBy('displayName', 'asc')
      .orderBy('__name__', 'asc');

    if (cursor) {
      query = query.startAfter(cursor.lastScore, cursor.lastName, cursor.lastId);
    }

    const snapshot = await query.limit(limit + 1).get();
    const docs = snapshot.docs;

    const entries = docs.slice(0, limit).map((doc) => doc.data() as LeaderboardEntry);

    const nextCursor =
      docs.length > limit
        ? {
            lastScore: entries[entries.length - 1].score,
            lastName: entries[entries.length - 1].displayName,
            lastId: entries[entries.length - 1].id,
          }
        : undefined;

    return {
      entries,
      nextCursor,
    };
  }

  async getRank(learnerRefHash: string): Promise<number | null> {
    const entry = await this.findByLearnerRef(learnerRefHash);
    if (!entry || !entry.optedIn) {
      return null;
    }

    const query = this.db
      .collection(LEADERBOARD_COLLECTION)
      .where('optedIn', '==', true)
      .where('score', '>', entry.score)
      .orderBy('score', 'desc');

    const snapshot = await query.get();
    return snapshot.size + 1;
  }

  async updateDisplayName(learnerRefHash: string, newName: string): Promise<LeaderboardEntry> {
    const ref = this.db.collection(LEADERBOARD_COLLECTION).doc(learnerRefHash);
    const entry = await this.findByLearnerRef(learnerRefHash);

    if (!entry) {
      throw new Error('Leaderboard entry not found');
    }

    const updates = {
      displayName: newName,
      updatedAt: new Date().toISOString(),
    };

    await ref.update(updates);

    return {
      ...entry,
      ...updates,
    };
  }
}

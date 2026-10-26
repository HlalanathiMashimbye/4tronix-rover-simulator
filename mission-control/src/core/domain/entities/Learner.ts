/**
 * Learner Domain Entity
 *
 * Represents an anonymous learner in the system.
 * No email or password required - identified via browser fingerprint.
 *
 * Design principles:
 * - Privacy-first: No PII collected
 * - Session-based: Uses nanoid for unique identification
 * - Progressive enhancement: Can be upgraded to authenticated user later
 */

import { ChallengeProgress } from './ChallengeProgress';

export interface LearnerAvatar {
  style: string;
  seed: string;
}

export const AVATAR_STYLES = ['bottts', 'identicon', 'shapes'] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

export interface Learner {
  // Identifiers
  id: string;                        // Unique learner ID (nanoid)
  sessionId: string;                 // Browser fingerprint for device linking

  // Profile, set during the welcome flow and changeable later.
  displayName?: string;
  avatar?: LearnerAvatar;
  learnerEmail?: string;             // Optional email for notifications / reminders

  // Timestamps
  createdAt: string;                 // When learner first accessed system
  lastActiveAt: string;              // Last activity timestamp

  // Progressive Challenges advancement. Absent until a learner completes
  // their first challenge - same as displayName, there is no eager default.
  progress?: ChallengeProgress;
}

export function createAnonymousLearner(learnerId: string): Learner {
  const now = new Date().toISOString();

  return {
    id: learnerId,
    sessionId: learnerId,
    createdAt: now,
    lastActiveAt: now,
  };
}

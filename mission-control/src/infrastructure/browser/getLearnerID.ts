import { nanoid } from 'nanoid';

const LEARNER_ID_KEY = 'mars-rover-learner-id';
const OLD_SESSION_KEY = 'mars-rover-session-id';

/**
 * Get or create a unique learner ID.
 *
 * On first call in a browser that has the old session key but no learner key,
 * the session's nanoid is adopted so the learner keeps their existing identity.
 */
export function getLearnerID(): string {
  if (typeof window === 'undefined') {
    throw new Error('getLearnerID can only be called in browser context');
  }

  try {
    const existingId = localStorage.getItem(LEARNER_ID_KEY);

    if (existingId && existingId.length > 0) {
      migrateOldSessionKey();
      return existingId;
    }

    // No learner key — check for the old session key before minting a new id.
    const migrated = migrateOldSessionKey();
    if (migrated) return migrated;

    const newId = nanoid(21);
    localStorage.setItem(LEARNER_ID_KEY, newId);
    return newId;
  } catch (error) {
    console.warn('localStorage unavailable, using temporary learner ID (will not persist):', error);
    return nanoid(21);
  }
}

/**
 * If the old `mars-rover-session-id` key exists, extract its nanoid and — when
 * no learner key is set yet — adopt it as the learner ID. The old key is
 * removed either way so only one identity remains.
 *
 * Returns the adopted id when it was written, null otherwise.
 */
function migrateOldSessionKey(): string | null {
  try {
    const raw = localStorage.getItem(OLD_SESSION_KEY);
    if (!raw) return null;

    let sessionId: string | null = null;
    try {
      const parsed = JSON.parse(raw);
      sessionId = parsed?.sessionId ?? null;
    } catch {
      // Not JSON — treat as plain string (defensive).
      if (raw.length > 0) sessionId = raw;
    }

    localStorage.removeItem(OLD_SESSION_KEY);

    if (!sessionId || sessionId.length === 0) return null;

    // Only adopt when the learner key is absent — if both exist the learner
    // key wins because missions were hashed from it.
    if (!localStorage.getItem(LEARNER_ID_KEY)) {
      localStorage.setItem(LEARNER_ID_KEY, sessionId);
      return sessionId;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Replace the stored learner ID with a known one — used when restoring
 * from a recovery code on a new device.
 */
export function setLearnerID(id: string): void {
  if (typeof window === 'undefined') {
    throw new Error('setLearnerID can only be called in browser context');
  }

  try {
    localStorage.setItem(LEARNER_ID_KEY, id);
  } catch (error) {
    console.error('Failed to set learner ID:', error);
  }
}

/**
 * Clear the stored learner ID (useful for testing or reset)
 */
export function clearLearnerID(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(LEARNER_ID_KEY);
  } catch (error) {
    console.error('Failed to clear learner ID:', error);
  }
}

/**
 * Check if a learner ID exists in storage
 *
 * @returns {boolean} True if ID exists, false otherwise
 */
export function hasLearnerID(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const id = localStorage.getItem(LEARNER_ID_KEY);
    return id !== null && id.length > 0;
  } catch {
    return false;
  }
}

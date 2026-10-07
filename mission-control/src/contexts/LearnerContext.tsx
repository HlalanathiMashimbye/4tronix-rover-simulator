'use client';

/**
 * Learner Context Provider
 *
 * Manages anonymous learner sessions and profile data.
 * Automatically initializes session on mount and syncs with Firestore.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFirestoreClient } from '@/infrastructure/persistence/firebase-client';
import { getLearnerID, clearLearnerID, setLearnerID } from '@/infrastructure/browser/getLearnerID';
import { hashLearnerEmail } from '@/core/domain/services/learnerEmailHash';
import { hashLearnerId } from '@/core/domain/services/learnerRef';
import { Learner, createAnonymousLearner, type LearnerAvatar } from '@/core/domain/entities/Learner';

interface LearnerContextType {
  learner: Learner | null;
  sessionId: string | null;
  loading: boolean;
  resetSession: () => void;
  learnerEmail: string | null;
  setLearnerEmail: (email: string | null) => Promise<void>;
  openEmailPrompt: () => void;
  closeEmailPrompt: () => void;
  showEmailPrompt: boolean;
  generateRecoveryCode: () => Promise<string | null>;
  restoreFromCode: (code: string) => Promise<{ success: boolean; error?: string }>;
  updateProfile: (displayName: string, avatar: LearnerAvatar) => Promise<boolean>;
}

const LearnerContext = createContext<LearnerContextType | undefined>(undefined);

/** Set by MissionWorkspace on every successful submit. */
const LATEST_MISSION_KEY = 'rover-latest-mission-id';

/**
 * The email prompt opens *after* a mission is submitted, so a first-time
 * learner's mission is written with no learnerEmailHash on it, and the
 * notification service has no way to connect that mission to an address. That
 * mission would otherwise stay silent for its whole lifecycle - including the
 * completion email, which is the one the learner was just promised.
 *
 * Stamps the HASH onto the mission in flight (never the address: mission
 * documents are world-readable), then fires the queued email that was skipped
 * at submit time. Best-effort: the address is already saved to the learner
 * record by the time this runs, so a failure here costs one notification, not
 * the address.
 */
async function backfillLatestMissionEmail(email: string): Promise<void> {
  let missionId: string | null = null;

  try {
    missionId = localStorage.getItem(LATEST_MISSION_KEY);
  } catch {
    return; // localStorage unavailable - nothing to backfill against
  }

  if (!missionId) return;

  try {
    const db = getFirestoreClient();
    const missionRef = doc(db, 'missions', missionId);
    const snapshot = await getDoc(missionRef);

    // Already stamped (e.g. the learner re-saved the same address from the
    // history page) - the queued email has been sent, don't send it twice.
    if (!snapshot.exists() || snapshot.data().learnerEmailHash) return;

    await updateDoc(missionRef, { learnerEmailHash: await hashLearnerEmail(email) });

    await fetch(`/api/missions/${missionId}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    });
  } catch (error) {
    console.warn('Failed to backfill learner email onto pending mission:', error);
  }
}

export function LearnerProvider({ children }: { children: ReactNode }) {
  const [learner, setLearner] = useState<Learner | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [learnerEmail, setLearnerEmailState] = useState<string | null>(null);
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- initializeLearnerSession is a hoisted function declaration and this effect runs once after mount, so there is no window where it is genuinely undefined. Pre-existing; the compiler only began reporting it once updateDisplayName was removed and it could analyse this component through to the end.
    initializeLearnerSession();
  }, []);

  // Load any saved email. We never prompt for it on landing (per David); the
  // email ask happens after a mission is submitted, and on the history page.
  useEffect(() => {
    try {
      const stored = localStorage.getItem('learnerEmail');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage; not readable during SSR render
      if (stored) setLearnerEmailState(stored);
    } catch {
      // localStorage unavailable - skip
    }
  }, []);

  /**
   * Save (or clear) the learner's email - persisted to localStorage and, if a
   * session exists, merged into the learner's Firestore document.
   */
  async function setLearnerEmail(email: string | null): Promise<void> {
    try {
      if (email) localStorage.setItem('learnerEmail', email);
      else localStorage.removeItem('learnerEmail');
    } catch {
      // localStorage unavailable - continue with in-memory state
    }
    setLearnerEmailState(email);
    setShowEmailPrompt(false);

    // Written server-side, not from here. The learner document is readable by
    // exact id and those ids are published on public mission documents, so an
    // address stored on it could be harvested in bulk from the feed. The route
    // puts it in a subcollection browsers cannot read at all - see
    // core/domain/services/learnerContact.ts.
    //
    // Order still matters: backfillLatestMissionEmail triggers a notify that
    // reads this back server-side, so it has to land first or that first email
    // finds no address and silently skips.
    try {
      const response = await fetch(
        `/api/learners/${encodeURIComponent(getLearnerID())}/email`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        },
      );
      if (!response.ok) {
        console.warn('Failed to persist learner email:', await response.text());
      }
    } catch (error) {
      console.warn('Failed to persist learner email:', error);
    }

    if (email) await backfillLatestMissionEmail(email);
  }

  const openEmailPrompt = () => setShowEmailPrompt(true);
  const closeEmailPrompt = () => setShowEmailPrompt(false);

  /**
   * Initialize or retrieve learner session
   */
  async function initializeLearnerSession() {
    const learnerId = getLearnerID();
    setSessionId(learnerId);

    try {
      const db = getFirestoreClient();
      const learnerRef = doc(db, 'learners', learnerId);
      const learnerSnap = await getDoc(learnerRef);

      const learnerRefHash = await hashLearnerId(learnerId);

      if (learnerSnap.exists()) {
        const existingLearner = learnerSnap.data() as Learner;

        await updateDoc(learnerRef, {
          lastActiveAt: new Date().toISOString(),
          learnerRef: learnerRefHash,
        });

        setLearner({ ...existingLearner, lastActiveAt: new Date().toISOString() });
      } else {
        const newLearner = createAnonymousLearner(learnerId);

        await setDoc(learnerRef, {
          ...newLearner,
          learnerRef: learnerRefHash,
          createdAt: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
        });

        setLearner(newLearner);
      }
    } catch (error) {
      console.warn('Firestore learner init unavailable, using local session fallback:', error);
      setLearner(createAnonymousLearner(learnerId));
    } finally {
      setLoading(false);
    }
  }

  async function updateProfile(
    displayName: string,
    avatar: LearnerAvatar,
  ): Promise<boolean> {
    const learnerId = getLearnerID();
    try {
      const response = await fetch(
        `/api/learners/${encodeURIComponent(learnerId)}/profile`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName, avatar }),
        },
      );
      if (!response.ok) return false;

      setLearner((prev) =>
        prev ? { ...prev, displayName, avatar } : prev,
      );
      return true;
    } catch {
      return false;
    }
  }

  async function generateRecoveryCode(): Promise<string | null> {
    const learnerId = getLearnerID();
    try {
      const response = await fetch(
        `/api/learners/${encodeURIComponent(learnerId)}/recovery-code`,
        { method: 'POST' },
      );
      if (!response.ok) return null;
      const data = await response.json();
      return data.code ?? null;
    } catch {
      return null;
    }
  }

  async function restoreFromCode(code: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('/api/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error ?? 'Code not recognised' };
      }

      setLearnerID(data.learnerId);
      setLearner(null);
      setSessionId(null);
      setLoading(true);
      await initializeLearnerSession();
      return { success: true };
    } catch {
      return { success: false, error: 'Something went wrong. Please try again.' };
    }
  }

  /**
   * Reset session and create new learner identity
   */
  function resetSession() {
    clearLearnerID();
    setLearner(null);
    setSessionId(null);
    setLoading(true);
    initializeLearnerSession();
  }

  return (
    <LearnerContext.Provider
      value={{
        learner,
        sessionId,
        loading,
        resetSession,
        learnerEmail,
        setLearnerEmail,
        openEmailPrompt,
        closeEmailPrompt,
        showEmailPrompt,
        generateRecoveryCode,
        restoreFromCode,
        updateProfile,
      }}
    >
      {children}
    </LearnerContext.Provider>
  );
}

export function useLearner() {
  const context = useContext(LearnerContext);
  if (context === undefined) {
    throw new Error('useLearner must be used within a LearnerProvider');
  }
  return context;
}

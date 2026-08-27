'use client';

/**
 * Learner Context Provider
 *
 * Manages anonymous learner sessions and profile data.
 * Automatically initializes session on mount and syncs with Firestore.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFirestoreClient } from '@/lib/firebase';
import { getOrCreateSession, clearSession } from '@/lib/anonymous-auth';
import { getLearnerID } from '@/lib/getLearnerID';
import { hashLearnerEmail } from '@/core/domain/services/learnerEmailHash';
import { hashLearnerId } from '@/core/domain/services/learnerRef';
import { Learner, createAnonymousLearner } from '@/core/domain/entities/Learner';

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
}

const LearnerContext = createContext<LearnerContextType | undefined>(undefined);

/** Set by MissionWorkspace on every successful submit. */
const LATEST_MISSION_KEY = 'rover-latest-mission-id';

/**
 * Learner records are keyed by getLearnerID(), the SAME id missions carry as
 * `learnerId`. They used to be keyed by getOrCreateSession()'s sessionId, a
 * separate nanoid under a different localStorage key, so the server could never
 * find a mission's learner - which is both why emails greeted "Space Explorer"
 * and why the address now has somewhere reliable to live.
 *
 * Existing documents under the old sessionId key are orphaned by this change.
 * Nothing is lost that matters: they hold only an email and display name, and
 * the email is also in localStorage, so it is rewritten under the correct id
 * the next time the learner saves it.
 */
function learnerDocId(): string {
  return getLearnerID();
}

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
        `/api/learners/${encodeURIComponent(learnerDocId())}/email`,
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
    try {
      // Get or create browser session
      const session = getOrCreateSession();
      setSessionId(session.sessionId);

      // Try to fetch existing learner from Firestore
      const db = getFirestoreClient();
      const learnerRef = doc(db, 'learners', learnerDocId());
      const learnerSnap = await getDoc(learnerRef);

      // Missions carry only a hash of the learner id, so the notification
      // service can no longer fetch a learner by document id - it finds the
      // record whose learnerRef matches the mission's. Stamped on both the
      // create and the update path, so records written before this change
      // become resolvable the next time their owner opens the app.
      const learnerRefHash = await hashLearnerId(learnerDocId());

      if (learnerSnap.exists()) {
        // Existing learner - update last active timestamp
        const existingLearner = learnerSnap.data() as Learner;
        // The address is deliberately no longer readable from here (it would
        // be readable by anyone holding this id). localStorage above is the
        // client's source of truth for display; this document is keyed by the
        // same device-local id, so it never knew anything the browser did not
        // already have.

        await updateDoc(learnerRef, {
          lastActiveAt: new Date().toISOString(),
          learnerRef: learnerRefHash,
        });

        setLearner({ ...existingLearner, lastActiveAt: new Date().toISOString() });
      } else {
        // New learner - create profile
        const newLearner = createAnonymousLearner(session.sessionId);

        await setDoc(learnerRef, {
          ...newLearner,
          learnerRef: learnerRefHash,
          // Use Firestore server timestamp for consistency
          createdAt: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
        });

        setLearner(newLearner);
      }
    } catch (error) {
      console.warn('Firestore learner init unavailable, using local session fallback:', error);

      const session = getOrCreateSession();
      const fallbackLearner = createAnonymousLearner(session.sessionId);
      setSessionId(session.sessionId);
      setLearner(fallbackLearner);
    } finally {
      setLoading(false);
    }
  }

  /*
   * There is deliberately no updateDisplayName.
   *
   * One existed, and nothing ever called it: no screen offered a learner a way
   * to name themselves, so all 170 learner records have no display name. That
   * is not an oversight to correct. Learners are anonymous here by design -
   * they are not Firebase Auth users, their id is hashed before it touches a
   * mission, and their address lives where browsers cannot read it - and a
   * dormant writer for a name is the thing someone wires up to a "name
   * yourself" box without realising what it undoes.
   *
   * Removed alongside AB#377, which asked the operator queue to show who
   * submitted each mission and was closed as won't-do for the same reason.
   *
   * MissionNotificationService still READS displayName when personalising the
   * completion email. That is a message to the learner's own address, it
   * handles the field being absent, and it is left alone.
   */

  /**
   * Reset session and create new learner identity
   */
  function resetSession() {
    clearSession();
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

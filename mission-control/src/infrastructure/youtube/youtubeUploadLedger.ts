import 'server-only';

import { randomUUID } from 'node:crypto';
import type { Firestore, DocumentReference } from 'firebase-admin/firestore';

import type { AutomaticUploadStatusView } from '@/core/domain/entities/MissionRun';
import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';

const MAX_ATTEMPTS = 3;
const LEASE_MS = 15 * 60 * 1000;

interface UploadLedgerEntry extends AutomaticUploadStatusView {
  attemptId?: string;
  leaseUntil?: string;
}

function uploadRef(db: Firestore, missionId: string, dispatchId: string): DocumentReference {
  return db.collection('missions').doc(missionId).collection('automaticUploads').doc(dispatchId);
}

export type UploadClaim =
  | { kind: 'claimed'; attemptId: string; attempts: number }
  | { kind: 'in-progress' | 'uploaded' | 'max-attempts'; entry: AutomaticUploadStatusView };

export async function claimAutomaticUpload(
  missionId: string,
  dispatchId: string,
  yardId: string,
  recordingName: string,
): Promise<UploadClaim> {
  const db = getFirestoreInstance();
  const ref = uploadRef(db, missionId, dispatchId);
  const attemptId = randomUUID();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() as Partial<UploadLedgerEntry> : {};
    const attempts = previous.attempts ?? 0;
    const leaseUntil = previous.leaseUntil ? Date.parse(previous.leaseUntil) : 0;
    if (previous.status === 'uploaded') {
      return { kind: 'uploaded', entry: previous as AutomaticUploadStatusView };
    }
    if (previous.status === 'uploading' && leaseUntil > Date.now()) {
      return { kind: 'in-progress', entry: previous as AutomaticUploadStatusView };
    }
    if (attempts >= MAX_ATTEMPTS) {
      return { kind: 'max-attempts', entry: previous as AutomaticUploadStatusView };
    }

    const nextAttempts = attempts + 1;
    transaction.set(ref, {
      missionId,
      dispatchId,
      yardId,
      recordingName,
      status: 'uploading',
      attempts: nextAttempts,
      attemptId,
      leaseUntil: new Date(Date.now() + LEASE_MS).toISOString(),
      updatedAt: new Date().toISOString(),
      errorMessage: null,
    }, { merge: true });
    return { kind: 'claimed', attemptId, attempts: nextAttempts };
  });
}

export async function finishAutomaticUpload(
  missionId: string,
  dispatchId: string,
  attemptId: string,
  result: { status: 'uploaded'; videoId: string; url: string } | { status: 'failed'; errorMessage: string },
): Promise<void> {
  const ref = uploadRef(getFirestoreInstance(), missionId, dispatchId);
  await getFirestoreInstance().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() as Partial<UploadLedgerEntry> : {};
    if (existing.attemptId !== attemptId || existing.status !== 'uploading') return;
    transaction.set(ref, {
      ...result,
      uploadedAt: result.status === 'uploaded' ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
      leaseUntil: null,
    }, { merge: true });
  });
}

export async function recordAutomaticUploadFailure(
  missionId: string,
  dispatchId: string,
  yardId: string,
  recordingName: string,
  errorMessage: string,
): Promise<void> {
  const db = getFirestoreInstance();
  const ref = uploadRef(db, missionId, dispatchId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() as Partial<UploadLedgerEntry> : {};
    if (existing.status === 'uploaded' || existing.status === 'uploading') return;
    transaction.set(ref, {
      missionId,
      dispatchId,
      yardId,
      recordingName,
      status: 'failed',
      attempts: existing.attempts ?? 0,
      errorMessage,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  });
}

export async function listAutomaticUploads(missionId: string): Promise<AutomaticUploadStatusView[]> {
  const snapshot = await getFirestoreInstance()
    .collection('missions')
    .doc(missionId)
    .collection('automaticUploads')
    .orderBy('updatedAt', 'desc')
    .limit(20)
    .get();
  return snapshot.docs.map((doc) => doc.data() as AutomaticUploadStatusView);
}

export async function runAutomaticUpload(
  input: {
    missionId: string;
    dispatchId: string;
    yardId: string;
    recordingName: string;
    file: Uint8Array;
  },
  dependencies = {
    claim: claimAutomaticUpload,
    finish: finishAutomaticUpload,
    upload: async (request: import('@/infrastructure/youtube/youtubeUpload').AutomaticUploadRequest) =>
      (await import('@/infrastructure/youtube/youtubeUpload')).maybeUploadRecording(request),
  },
): Promise<UploadClaim | { kind: 'failed'; attempts: number; errorMessage: string } | { kind: 'uploaded'; attempts: number; videoId: string; url: string }> {
  const claim = await dependencies.claim(
    input.missionId,
    input.dispatchId,
    input.yardId,
    input.recordingName,
  );
  if (claim.kind !== 'claimed') return claim;

  try {
    const result = await dependencies.upload({
      missionId: input.missionId,
      runId: input.dispatchId,
      yardId: input.yardId,
      title: input.recordingName.replace(/\.mp4$/i, ''),
      file: input.file,
    });
    if (result.status !== 'uploaded' || !result.videoId || !result.url) {
      const message = result.status === 'failed' ? result.error ?? 'Upload failed.' : 'Automatic uploads are not configured.';
      await dependencies.finish(input.missionId, input.dispatchId, claim.attemptId, {
        status: 'failed',
        errorMessage: message,
      });
      return { kind: 'failed', attempts: claim.attempts, errorMessage: message };
    }

    await dependencies.finish(input.missionId, input.dispatchId, claim.attemptId, {
      status: 'uploaded',
      videoId: result.videoId,
      url: result.url,
    });
    return { kind: 'uploaded', attempts: claim.attempts, videoId: result.videoId, url: result.url };
  } catch {
    const message = 'Automatic upload failed; the recording remains available for manual upload.';
    await dependencies.finish(input.missionId, input.dispatchId, claim.attemptId, {
      status: 'failed',
      errorMessage: message,
    });
    return { kind: 'failed', attempts: claim.attempts, errorMessage: message };
  }
}

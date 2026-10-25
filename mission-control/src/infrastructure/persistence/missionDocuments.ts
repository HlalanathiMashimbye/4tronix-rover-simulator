/**
 * How a Mission and its runs are laid out in Firestore, for both SDKs.
 *
 * The Admin and browser SDKs have incompatible types but store the same
 * documents, so the translation lives here once and each repository only
 * fetches. These are explicit allowlists in both directions: a field missing
 * here is dropped between Firestore and the page, which is what happened when
 * the run's feedback fields were added to the entity and not to the mapper.
 */

import type { Mission } from '@/core/domain/entities/Mission';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import { COLLECTIONS } from '@/infrastructure/persistence/collections';

export const MISSIONS_COLLECTION = COLLECTIONS.missions;
export const RUNS_SUBCOLLECTION = COLLECTIONS.runs;

export type MissionDocData = Record<string, unknown>;
/** The part of either SDK's document snapshot this code reads. */
export type DocumentLike = { id: string; data: () => MissionDocData };

/**
 * A stored time as an ISO string. Firestore hands some fields back as its own
 * Timestamp (either SDK's; both have toDate) where the type says string, and
 * a Timestamp reaching a component renders as "[object Object]".
 */
function isoTime(value: unknown): string | undefined {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return value as string | undefined;
}

export function missionFromDocument(id: string, data: MissionDocData): Mission {
  return {
    id,
    yardId: data.yardId as string,
    learnerRef: data.learnerRef as string,
    sessionId: data.sessionId as string,
    learnerEmailHash: data.learnerEmailHash as string | undefined,
    name: data.name as string | undefined,
    code: data.code as string,
    blocklyState: data.blocklyState as string | undefined,
    origin: data.origin as Mission['origin'],
    challengeId: data.challengeId as string | undefined,
    status: data.status as Mission['status'],
    deleted: (data.deleted as boolean) ?? false,
    deletedAt: data.deletedAt as string | undefined,
    executionResult: data.executionResult as Mission['executionResult'],
    executionMetadata: data.executionMetadata as Mission['executionMetadata'],
    videoUrl: data.videoUrl as string | undefined,
    // Coerced, because removing a video writes null and this field is
    // typed as optional. Leaving the null would make every consumer's
    // `string | undefined` a lie.
    youtubeUrl: (data.youtubeUrl as string | null | undefined) ?? undefined,
    submittedAt: isoTime(data.submittedAt) as string,
    startedAt: isoTime(data.startedAt),
    completedAt: isoTime(data.completedAt),
    needsReview: (data.needsReview as boolean) ?? false,
    reviewReason: (data.reviewReason as string | null) ?? null,
    // A document from before status changes were stamped last changed when it
    // was submitted.
    statusUpdatedAt: (data.statusUpdatedAt as string) ?? (data.submittedAt as string),
  };
}

/**
 * The document id IS the runId, so it is authoritative over any stored field.
 * The yard comes from the field; satellite-written runs from before the field
 * existed were keyed BY yard, so the id is the honest fallback, not ''.
 */
export function runFromDocument(runId: string, data: Partial<MissionRun>): MissionRun {
  return {
    runId,
    yardId: data.yardId ?? runId,
    status: data.status ?? 'queued',
    startedAt: data.startedAt,
    completedAt: data.completedAt,
    youtubeUrl: data.youtubeUrl ?? undefined,
    needsReview: data.needsReview,
    reviewReason: data.reviewReason ?? null,
    statusUpdatedAt: data.statusUpdatedAt ?? null,
    feedback: data.feedback,
    feedbackBy: data.feedbackBy,
    feedbackAt: data.feedbackAt,
  };
}

/**
 * Soft-deleted documents read as absent. Filtered after reading rather than in
 * the query, because documents written before soft delete existed have no
 * `deleted` field, and `where('deleted', '==', false)` would drop every one.
 */
export function isLive(data: MissionDocData): boolean {
  return !data.deleted;
}

export function missionToDocument(mission: Partial<Mission>): Record<string, unknown> {
  const persistedFields: Record<string, unknown> = { ...mission };

  if (typeof persistedFields.code === 'string') {
    persistedFields.code = normalizeMissionCode(persistedFields.code);
  }

  // Mission documents are world-readable. A plaintext learner address must
  // never reach one - only learnerEmailHash. The Mission type no longer has
  // the field, so this is a backstop against an untyped or legacy caller
  // reintroducing it silently.
  delete persistedFields.learnerEmail;

  // Same backstop for the raw learner id: only learnerRef (its hash) belongs
  // on a world-readable document. See core/domain/services/learnerRef.ts
  delete persistedFields.learnerId;

  return removeUndefinedValues(persistedFields) as Record<string, unknown>;
}

function normalizeMissionCode(code: string): string {
  return code
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

/** Firestore Admin rejects undefined values, including nested optional fields. */
function removeUndefinedValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map(removeUndefinedValues);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .map(([key, nestedValue]) => [key, removeUndefinedValues(nestedValue)])
    );
  }

  return value;
}

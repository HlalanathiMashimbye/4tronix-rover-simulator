/**
 * Operator bookkeeping: complete, cancel, attach a video, resolve a review,
 * and delete.
 *
 * WHY THESE MOVED OFF THE SATELLITE. Pasting a YouTube URL and marking a
 * mission complete are desk jobs. Only physical actions have to happen at the
 * yard, and tying the desk jobs to a Raspberry Pi on venue wifi meant that
 * whenever the yard lost network, the record could not be settled from
 * anywhere. That is the failure this route exists to remove.
 *
 * The satellite keeps everything physical: send, rerun, stop, camera, arming.
 * Stop especially. A cloud stop button would take up to a sync interval and do
 * nothing whatsoever when offline, which is the one thing a stop control must
 * never do.
 *
 * NOTHING IN THIS FILE CAN MOVE A ROVER. There is no dispatch here and no HTTP
 * call to the rover, and a test asserts it stays that way. Resolving a review
 * as 'requeue' makes a mission available to be sent again by a human; it does
 * not send it.
 *
 * The Admin SDK does the writing because Firestore rules deny the browser every
 * write to a mission or a run (firestore.rules), which is what keeps a public
 * feed safe to leave world-readable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { adminMissionRepository } from '@/infrastructure/container.server';
import { missionEmailComposer } from '@/infrastructure/email/missionStatusTemplates';
import { MissionNotificationService } from '@/core/application/services/MissionNotificationService';
import { ResendEmailSender } from '@/infrastructure/email/resend-client';
import { resolveAppUrl } from '@/infrastructure/config/appUrl';
import { requireOperator, requireAdmin, ForbiddenError, UnauthorizedError } from '@/lib/auth/dal';
import { isKnownYard } from '@/infrastructure/config/yards';
import { getYouTubeId } from '@/lib/missionRuns';
import {
  decideAttachVideo,
  decideCancel,
  decideComplete,
  decideResolve,
  type Decision,
  type RunSnapshot,
} from '@/core/domain/services/missionBookkeeping';

const yardId = z
  .string()
  .min(1)
  .refine(isKnownYard, 'That yard is not one this platform knows about.');

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete'), yardId }),
  z.object({ action: z.literal('cancel'), yardId }),
  z.object({ action: z.literal('attach-video'), yardId, url: z.string().trim().min(1) }),
  z.object({
    action: z.literal('resolve'),
    yardId,
    outcome: z.enum(['completed', 'requeue']),
  }),
]);

function authFailure(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json(
      { success: false, error: 'Only an admin can delete a mission' },
      { status: 403 },
    );
  }
  return null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireOperator();
  } catch (error) {
    return authFailure(error) ?? NextResponse.json(
      { success: false, error: 'Could not verify your access' },
      { status: 500 },
    );
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  const command = parsed.data;

  try {
    const firestore = getFirestoreInstance();
    const repository = adminMissionRepository();

    const mission = await repository.findById(id);
    if (!mission || mission.deleted) {
      return NextResponse.json({ success: false, error: 'Mission not found' }, { status: 404 });
    }

    // A missing run is ordinary, not an error: a yard with no network never
    // flushed one. The decision falls back to the mission's own status and the
    // write creates the run.
    const runs = await repository.findRuns(id);
    const run = runs.find((r) => r.yardId === command.yardId) ?? null;

    const snapshot: RunSnapshot = {
      runStatus: run?.status ?? null,
      missionStatus: mission.status,
      needsReview: run?.needsReview ?? mission.needsReview ?? false,
    };

    let decision: Decision;
    let youtubeUrl: string | undefined;

    switch (command.action) {
      case 'complete':
        decision = decideComplete(snapshot);
        break;
      case 'cancel':
        decision = decideCancel(snapshot);
        break;
      case 'attach-video': {
        // Parsed rather than pattern-matched, using the same helper the learner
        // player uses. If the id cannot be read out of it, the mission page
        // could not have embedded it either, so accepting it would store a link
        // that renders as an empty frame.
        if (!getYouTubeId(command.url)) {
          return NextResponse.json(
            { success: false, error: 'Use a youtube.com/watch?v=... or youtu.be/... link.' },
            { status: 400 },
          );
        }
        youtubeUrl = command.url;
        decision = decideAttachVideo(snapshot);
        break;
      }
      case 'resolve':
        decision = decideResolve(snapshot, command.outcome);
        break;
    }

    if (!decision.ok) {
      // 409, not 400. The request was well formed; the mission simply is not in
      // a state where this makes sense, usually because somebody else got there
      // first. The console shows the message and refreshes rather than telling
      // the operator they typed something wrong.
      return NextResponse.json({ success: false, error: decision.error }, { status: 409 });
    }

    const decidedAt = new Date().toISOString();

    await repository.applyBookkeeping(id, command.yardId, {
      status: decision.change.status,
      clearsReview: decision.change.clearsReview,
      youtubeUrl,
      decidedAt,
      decidedBy: session.email ?? session.uid,
    });

    // The learner's email on completion, which until now only ever fired when
    // the YARD marked a mission complete. Without this the same event sends a
    // message or does not depending on which console the operator happened to
    // use, and the child is the one who notices.
    //
    // Best effort, and deliberately after the write: a Resend outage must not
    // roll back a decision the operator already made.
    let notification: unknown = null;
    if (decision.change.status === 'completed') {
      try {
        const notifier = new MissionNotificationService(
          new ResendEmailSender(),
          missionEmailComposer,
          firestore,
          resolveAppUrl(),
        );
        notification = await notifier.notifyStatusChange({ ...mission, status: 'completed' }, 'completed');
      } catch (error) {
        console.error('[operator/bookkeeping] notification failed:', error);
      }
    }

    return NextResponse.json({
      success: true,
      missionId: id,
      status: decision.change.status ?? mission.status,
      notification,
    });
  } catch (error) {
    console.error('[operator/bookkeeping] failed:', error);
    return NextResponse.json(
      { success: false, error: 'Could not apply that change' },
      { status: 500 },
    );
  }
}

/**
 * Delete a mission. Admin only, per AB#379.
 *
 * Its own verb rather than another action in the union above, so the narrower
 * permission is visible in the handler signature instead of buried in a branch.
 *
 * Cancel is the reversible option and stays the answer to "this is not going to
 * run". Delete is for a mission that should not exist at all.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    return authFailure(error) ?? NextResponse.json(
      { success: false, error: 'Could not verify your access' },
      { status: 500 },
    );
  }

  const { id } = await params;

  try {
    const repository = adminMissionRepository();

    const mission = await repository.findById(id);
    if (!mission) {
      return NextResponse.json({ success: false, error: 'Mission not found' }, { status: 404 });
    }
    if (mission.deleted) {
      return NextResponse.json(
        { success: false, error: 'This mission is already deleted' },
        { status: 409 },
      );
    }

    await repository.softDeleteMission(id, new Date().toISOString(), session.email ?? session.uid);

    return NextResponse.json({ success: true, missionId: id });
  } catch (error) {
    console.error('[operator/bookkeeping] delete failed:', error);
    return NextResponse.json(
      { success: false, error: 'Could not delete that mission' },
      { status: 500 },
    );
  }
}

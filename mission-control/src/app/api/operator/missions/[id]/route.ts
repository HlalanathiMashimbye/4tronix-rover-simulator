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
import { nanoid } from 'nanoid';

import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { adminMissionRepository } from '@/infrastructure/container.server';
import { missionEmailComposer } from '@/infrastructure/email/missionStatusTemplates';
import { MissionNotificationService } from '@/core/application/services/MissionNotificationService';
import { ResendEmailSender } from '@/infrastructure/email/resend-client';
import { resolveAppUrl } from '@/infrastructure/config/appUrl';
import { requireOperator, requireAdmin, ForbiddenError, UnauthorizedError } from '@/infrastructure/auth/dal';
import { getYouTubeId } from '@/lib/missionRuns';
import {
  decideAnotherRun,
  decideAttachVideo,
  decideRemoveVideo,
  decideCancel,
  decideComplete,
  decideFeedback,
  decideResolve,
  type Decision,
  type RunSnapshot,
} from '@/core/domain/services/missionBookkeeping';

/**
 * Not checked against a list here. It is checked against the SESSION's yard
 * below, and that one was validated against the live yards at sign-in.
 *
 * It used to refine against the hardcoded KNOWN_YARDS, which stopped being
 * true the moment yards became data an admin can add: a venue added this
 * morning would have been refused here while appearing everywhere else.
 */
const yardId = z.string().min(1);

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete'), yardId }),
  z.object({ action: z.literal('cancel'), yardId }),
  z.object({ action: z.literal('another-run'), yardId }),
  // runId is optional on purpose: without one these act on the operator's
  // latest run at this yard, which is what every existing caller means. With
  // one they act on a named attempt, which is what managing several needs.
  z.object({
    action: z.literal('attach-video'), yardId,
    url: z.string().trim().min(1),
    runId: z.string().trim().min(1).optional(),
  }),
  z.object({ action: z.literal('remove-video'), yardId, runId: z.string().trim().min(1).optional() }),
  z.object({ action: z.literal('delete-run'), yardId, runId: z.string().trim().min(1) }),
  z.object({
    action: z.literal('resolve'),
    yardId,
    outcome: z.enum(['completed', 'requeue']),
  }),
  z.object({
    action: z.literal('feedback'),
    yardId,
    /**
     * Capped at 280 characters, and that cap is the boundary rather than a
     * form hint: this text lands on a world-readable run document that a child
     * reads. Long enough for "the turn was too small, try 90 degrees for a
     * square", short enough that it cannot become an essay or a payload.
     */
    text: z.string().trim().min(1, 'Write something before sending it.').max(280),
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

  // The yard is chosen at sign-in and fixed for the session, so a request may
  // not name a different one. Without this the body decides, and an operator
  // standing in Cape Town could record a run against Durban by having a stale
  // tab open. A session from before the choice existed has no yard and is sent
  // to sign in again rather than being trusted.
  if (!session.yardId) {
    return NextResponse.json(
      { success: false, error: 'Sign in again to choose which yard you are at.' },
      { status: 403 },
    );
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
    // The LATEST run at this yard, not the first match. Runs are keyed by
    // runId now precisely so a yard can attempt a mission twice, and an
    // operator pressing "mark complete" means the run in front of them, not
    // the one from last week that happens to sort first.
    const run =
      runs
        .filter((r) => r.yardId === command.yardId)
        .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0] ?? null;

    const snapshot: RunSnapshot = {
      runStatus: run?.status ?? null,
      missionStatus: mission.status,
      needsReview: run?.needsReview ?? mission.needsReview ?? false,
    };

    // Removing a run returns here rather than joining the decision switch
    // below: it produces no status change, so threading it through
    // applyBookkeeping would mean inventing one.
    //
    // Operator rather than admin, unlike deleting a mission. This is somebody
    // tidying an attempt they logged themselves a minute ago, not erasing a
    // child's work, and the yard check below is what keeps it to their own.
    if (command.action === 'delete-run') {
      if (command.yardId !== session.yardId) {
        return NextResponse.json(
          { success: false, error: 'That mission is at another yard. Sign out to change yards.' },
          { status: 403 },
        );
      }

      const target = runs.find((r) => r.runId === command.runId);
      if (!target) {
        return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
      }
      if (target.yardId !== command.yardId) {
        return NextResponse.json(
          { success: false, error: 'That run belongs to another yard.' },
          { status: 403 },
        );
      }

      await repository.softDeleteRun(
        id,
        command.runId,
        new Date().toISOString(),
        session.email ?? session.uid,
      );
      return NextResponse.json({ success: true });
    }

    let decision: Decision;
    let youtubeUrl: string | undefined;
    let feedback: string | undefined;
    let clearsVideo = false;

    switch (command.action) {
      case 'complete':
        decision = decideComplete(snapshot);
        break;
      case 'cancel':
        decision = decideCancel(snapshot);
        break;
      case 'another-run':
        decision = decideAnotherRun(snapshot);
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
      case 'remove-video':
        clearsVideo = true;
        decision = decideRemoveVideo(snapshot);
        break;
      case 'resolve':
        decision = decideResolve(snapshot, command.outcome);
        break;
      case 'feedback':
        feedback = command.text;
        decision = decideFeedback(snapshot);
        break;
    }

    // A named run has to be one of this yard's own. Without this the runId
    // above is an arbitrary document path from the request body, and an
    // operator could attach a video to - or clear one from - another yard's
    // attempt at the same mission.
    if ('runId' in command && command.runId) {
      const named = runs.find((r) => r.runId === command.runId);
      if (!named) {
        return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
      }
      if (named.yardId !== session.yardId) {
        return NextResponse.json(
          { success: false, error: 'That run belongs to another yard.' },
          { status: 403 },
        );
      }
    }

    if (command.yardId !== session.yardId) {
      return NextResponse.json(
        { success: false, error: 'That mission is at another yard. Sign out to change yards.' },
        { status: 403 },
      );
    }

    if (!decision.ok) {
      // 409, not 400. The request was well formed; the mission simply is not in
      // a state where this makes sense, usually because somebody else got there
      // first. The console shows the message and refreshes rather than telling
      // the operator they typed something wrong.
      return NextResponse.json({ success: false, error: decision.error }, { status: 409 });
    }

    const decidedAt = new Date().toISOString();
    // For offline yards, the run may not exist yet. Generate a runId if needed.
    //
    // 'another-run' always takes a fresh one, which is the entire point of it:
    // reusing the existing runId would merge the second attempt over the first
    // and destroy the record this action exists to create. Every other action
    // acts on the run in front of the operator.
    const runId =
      command.action === 'another-run'
        ? nanoid()
        // A named run when the caller gave one, which is how a mission with
        // several attempts says which video belongs to which. Falls back to
        // the latest at this yard, which is what every caller meant when a
        // mission could only have one.
        : ('runId' in command && command.runId ? command.runId : (run?.runId ?? nanoid()));

    await repository.applyBookkeeping(id, runId, command.yardId, {
      status: decision.change.status,
      clearsReview: decision.change.clearsReview,
      youtubeUrl,
      clearsVideo,
      feedback,
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

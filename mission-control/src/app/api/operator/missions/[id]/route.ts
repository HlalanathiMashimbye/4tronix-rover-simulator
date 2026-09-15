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
 * The satellite keeps everything physical: send, rerun, stop, camera. Stop
 * especially. A cloud stop button would have nothing to reach - the satellite
 * does not poll or sync with Mission Control at all now - so it would do
 * nothing whatsoever, which is the one thing a stop control must never do.
 *
 * NOTHING IN THIS FILE CAN MOVE A ROVER. There is no dispatch here and no HTTP
 * call to the rover, and a test asserts it stays that way. Resolving a review
 * as 'requeue' makes a mission available to be sent again by a human; it does
 * not send it.
 *
 * The Admin SDK does the writing because Firestore rules deny the browser every
 * write to a mission or a run (firestore.rules), which is what keeps a public
 * feed safe to leave world-readable.
 *
 * THIS FILE IS THE HTTP HALF: who the operator is, whether the body parses, and
 * which status code a result becomes. What the commands do - finding the run,
 * checking yards, deciding, writing, emailing the learner - is
 * OperatorMissionCommands, where it can be tested without a request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { operatorMissionCommands } from '@/infrastructure/container.server';
import { requireOperator, requireAdmin, ForbiddenError, UnauthorizedError } from '@/infrastructure/auth/dal';
import type {
  CommandFailure,
  CommandResult,
  OperatorCommand,
} from '@/core/application/services/OperatorMissionCommands';

/**
 * Not checked against a list here. It is checked against the SESSION's yard,
 * and that one was validated against the live yards at sign-in.
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
]) satisfies z.ZodType<OperatorCommand>;

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

/**
 * A refused command, as HTTP. A conflict is 409 rather than 400: the request
 * was well formed, the mission simply is not in a state where it makes sense,
 * usually because somebody else got there first. The console shows the message
 * and refreshes rather than telling the operator they typed something wrong.
 */
const STATUS_FOR: Record<CommandFailure, number> = {
  'not-found': 404,
  forbidden: 403,
  invalid: 400,
  conflict: 409,
};

function respond(result: CommandResult) {
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: STATUS_FOR[result.failure] },
    );
  }
  return NextResponse.json({
    success: true,
    missionId: result.missionId,
    status: result.status,
    notification: result.notification,
  });
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

  try {
    const result = await operatorMissionCommands().run(id, parsed.data, {
      name: session.email ?? session.uid,
      yardId: session.yardId,
    });
    return respond(result);
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
    return respond(
      await operatorMissionCommands().deleteMission(id, { name: session.email ?? session.uid }),
    );
  } catch (error) {
    console.error('[operator/bookkeeping] delete failed:', error);
    return NextResponse.json(
      { success: false, error: 'Could not delete that mission' },
      { status: 500 },
    );
  }
}

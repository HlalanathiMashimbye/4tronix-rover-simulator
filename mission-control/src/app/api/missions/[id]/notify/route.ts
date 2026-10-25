/**
 * POST /api/missions/[id]/notify
 *
 * Sends the one "your mission is queued" email, and nothing else.
 *
 * Its only caller is LearnerContext.backfillLatestMissionEmail: a learner who
 * submitted a mission and then gave an address, so the queued email that the
 * submission could not send (no address yet) goes out now. Every other status
 * email is sent server-side by OperatorMissionCommands and VideoLinker, which
 * hold the Admin SDK and do not need this route.
 *
 * Mission ids are public on the feed, so this used to be a lever: anyone could
 * POST any status for any mission and have the learner mailed. It is now
 * narrowed to exactly what its caller needs. It accepts only `queued`, only
 * while the mission is still queued, and only once per mission (the send is
 * recorded in a transaction through the repository, never written here). A
 * second attempt, a mission past queued, or any other status is refused and
 * nothing is sent. The send itself stays best-effort: a provider outage must
 * not fail the caller, so the outcome travels back with a 200.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  missionService,
  notificationService,
  queuedNotificationRecorder,
} from '@/infrastructure/container.server';

// The body still has to name a known status, so a typo is a clear 400 rather
// than a silent no-op; the route then accepts only the one it exists to send.
const notifyRequestSchema = z.object({
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'not_completed', 'cancelled']),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const validation = notifyRequestSchema.safeParse(body);
  if (!validation.success) {
    const errors = validation.error.errors.map((err) => {
      const path = err.path.join('.');
      return `${path}: ${err.message}`;
    });

    return NextResponse.json(
      { success: false, error: 'Validation failed', details: errors },
      { status: 400 }
    );
  }

  if (validation.data.status !== 'queued') {
    // The other statuses are sent server-side, never from a public route.
    return NextResponse.json(
      { success: false, error: 'This route only sends the queued notification.' },
      { status: 403 }
    );
  }

  try {
    const mission = await missionService().getMissionById(id);

    if (!mission) {
      return NextResponse.json(
        { success: false, error: 'Mission not found' },
        { status: 404 }
      );
    }

    if (mission.status !== 'queued') {
      return NextResponse.json(
        { success: false, error: 'Mission is no longer queued.' },
        { status: 409 }
      );
    }

    // Stamp-once, in a transaction: 'recorded' means this call won the right to
    // send. Anything else means a previous call already sent it, or the mission
    // left the queue between the read above and here, so nothing is sent.
    const outcome = await queuedNotificationRecorder().recordQueuedNotification(id);
    if (outcome !== 'recorded') {
      return NextResponse.json(
        { success: false, error: 'The queued notification was already sent.' },
        { status: 409 }
      );
    }

    // Surfaced rather than discarded. Sending stays best-effort - a provider
    // outage must not fail the caller - but the caller can no longer tell
    // "sent" apart from "silently skipped because the learner has no address"
    // or "Resend rejected it". That ambiguity cost an afternoon of testing a
    // domain-verification failure as if it were a broken template. Always HTTP
    // 200 from here down; the detail is in the body.
    const notification = await notificationService().notifyStatusChange(mission, 'queued');

    return NextResponse.json({ success: true, notification }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

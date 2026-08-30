/**
 * POST /api/missions/[id]/notify
 *
 * Best-effort status-change email trigger for callers that update mission
 * status directly in Firestore instead of through PATCH /api/missions/[id]
 * (the yard operator console, which must keep working even if this app is
 * unreachable). This route sends the notification only - it never touches
 * persistence, since the caller has already written the new status itself.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { adminMissionRepository } from '@/infrastructure/container.server';
import { MissionService } from '@/core/application/services/MissionService';
import { missionEmailComposer } from '@/infrastructure/email/missionStatusTemplates';
import { MissionNotificationService } from '@/core/application/services/MissionNotificationService';
import { ResendEmailSender } from '@/infrastructure/email/resend-client';
import { resolveAppUrl } from '@/infrastructure/config/appUrl';

const notifyRequestSchema = z.object({
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']),
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

  try {
    const firestore = getFirestoreInstance();
    const repository = adminMissionRepository();
    const service = new MissionService(repository);
    const mission = await service.getMissionById(id);

    if (!mission) {
      return NextResponse.json(
        { success: false, error: 'Mission not found' },
        { status: 404 }
      );
    }

    const appUrl = resolveAppUrl();
    const notificationService = new MissionNotificationService(
      new ResendEmailSender(),
      missionEmailComposer,
      firestore,
      appUrl
    );

    const outcome = await notificationService.notifyStatusChange(mission, validation.data.status);

    // Surfaced rather than discarded. Sending stays best-effort - a provider
    // outage must not fail the caller, which is the yard console - but the
    // caller can no longer tell "sent" apart from "silently skipped because
    // the learner has no address" or "Resend rejected it". That ambiguity cost
    // an afternoon of testing a domain-verification failure as if it were a
    // broken template. Always HTTP 200; the detail is in the body.
    return NextResponse.json({ success: true, notification: outcome }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

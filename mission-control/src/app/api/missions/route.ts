/**
 * POST /api/missions - server-side mission submission (Tasks 40 & 41).
 *
 * Validates the payload (schema + command allowlist) before persisting, so
 * submission can be trusted even if it bypasses the client UI. The client may
 * still submit directly via the repository, but this endpoint is the safe path.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateMission } from '@/infrastructure/validation/schemas';
import { missionService, notificationService } from '@/infrastructure/container.server';
import { clientIp, rateLimited } from '@/app/api/rateLimit';

// Per client IP, not per learner: a whole class shares one school IP, so the
// window is set high enough that a class iterating hard is never blocked (a
// child submits a mission every few minutes at most, so 60 in 10 minutes is
// far above a real room and far below a script hammering the endpoint).
const SUBMIT_LIMIT = 60;
const SUBMIT_WINDOW_SECONDS = 600;

export async function POST(request: NextRequest) {
  const limited = await rateLimited(
    `missions:${clientIp(request)}`,
    SUBMIT_LIMIT,
    SUBMIT_WINDOW_SECONDS,
    "You've sent a lot of missions in a short time. Please wait a minute, then try again.",
  );
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 500 }
    );
  }

  // Phase 1 + 2: schema and command-allowlist validation
  const validation = validateMission(body);
  if (!validation.success || !validation.data) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', details: validation.errors ?? [] },
      { status: 400 }
    );
  }

  try {
    const result = await missionService().submitMission(validation.data);

    if (!result.success || !result.mission) {
      return NextResponse.json(
        { success: false, error: result.error ?? 'Failed to submit mission' },
        { status: 500 }
      );
    }

    await notificationService().notifyStatusChange(result.mission, 'queued');

    return NextResponse.json({ success: true, mission: result.mission }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

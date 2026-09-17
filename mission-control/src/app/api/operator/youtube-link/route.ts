/**
 * GET /api/operator/youtube-link
 *
 * When the YouTube linker last read the channel, and the interval it ran under,
 * so the operator console can say whether uploads are being checked.
 *
 * A route rather than a Firestore read in the browser: `appState` has no
 * operator read rule, and rules are deployed by hand. One document read per
 * call, and the console calls it rarely (see useYouTubeLinkStatus).
 */

import { NextResponse } from 'next/server';

import { requireOperator, ForbiddenError, UnauthorizedError } from '@/infrastructure/auth/dal';
import { readLinkerState } from '@/infrastructure/persistence/pollState';

export async function GET() {
  try {
    await requireOperator();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, error: 'Operators only' }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: 'Could not verify your access' }, { status: 500 });
  }

  try {
    const { lastCheckedAt, intervalMinutes } = await readLinkerState();
    return NextResponse.json({
      success: true,
      lastCheckedAt: lastCheckedAt?.toISOString() ?? null,
      intervalMinutes,
    });
  } catch (error) {
    console.error('[operator/youtube-link] could not read the linker state:', error);
    return NextResponse.json({ success: false, error: 'Could not read the upload checker' }, { status: 500 });
  }
}

/**
 * Send to Rover's signed handoff: the mission's stored code, signed for the
 * operator's yard, for the run station to check before it sends by itself.
 */

import { NextResponse } from 'next/server';

import { missionHandoffService } from '@/infrastructure/container.server';
import { requireOperator, UnauthorizedError } from '@/infrastructure/auth/dal';

const STATUS = { 'not-found': 404, forbidden: 403 } as const;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireOperator();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: 'Could not verify your access' }, { status: 500 });
  }

  const { id } = await params;
  const result = await missionHandoffService().handoff(id, session.yardId);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: STATUS[result.failure] });
  }
  const { ok: _ok, ...handoff } = result;
  return NextResponse.json({ success: true, ...handoff });
}

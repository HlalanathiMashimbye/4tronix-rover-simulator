/**
 * GET /api/yards/:yardId/layout
 *
 * What the simulator draws and drives in for a yard (AB#468): its size,
 * start, rocks and rising ground. Public, like the yard itself: a learner
 * building a mission has no account, and nothing here is private (the rocks
 * are on every mission's video).
 *
 * Always answers with a layout. An id nobody knows, or a yard whose layout
 * has not been saved yet, gets the measured yard (layoutOf), which is what
 * the simulator would draw anyway, so a client never has to handle a gap.
 * The id it answers with is the yard's current one, so a mission recorded
 * under a former id finds the yard's floor photo too.
 */

import { NextResponse } from 'next/server';

import { findYardIn, layoutOf } from '@/core/domain/entities/Yard';
import { yardDirectory } from '@/infrastructure/config/yardDirectory';

export async function GET(_request: Request, { params }: { params: Promise<{ yardId: string }> }) {
  const { yardId } = await params;
  const yard = findYardIn(await yardDirectory(), yardId);
  return NextResponse.json(
    { yardId: yard?.id ?? yardId, configured: Boolean(yard?.layout), layout: layoutOf(yard) },
    // The directory behind this is cached for a minute already; a browser may
    // keep it as long.
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}

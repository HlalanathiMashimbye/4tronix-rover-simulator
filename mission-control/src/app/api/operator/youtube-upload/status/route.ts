import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireOperator, ForbiddenError, UnauthorizedError } from '@/infrastructure/auth/dal';
import { listAutomaticUploads } from '@/infrastructure/youtube/youtubeUploadLedger';

const missionIdSchema = z.string().min(1).max(128);

export async function GET(request: NextRequest) {
  try {
    await requireOperator();
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ success: false, error: 'Operators only' }, { status: 403 });
    return NextResponse.json({ success: false, error: 'Could not verify your access' }, { status: 500 });
  }

  const missionId = missionIdSchema.safeParse(request.nextUrl.searchParams.get('missionId'));
  if (!missionId.success) {
    return NextResponse.json({ success: false, error: 'Give a missionId.' }, { status: 400 });
  }

  try {
    return NextResponse.json({
      success: true,
      uploads: await listAutomaticUploads(missionId.data),
    });
  } catch (error) {
    console.error('[operator/youtube-upload] Could not read upload statuses:', error);
    return NextResponse.json({ success: false, error: 'Could not read automatic upload status.' }, { status: 500 });
  }
}

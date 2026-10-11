/**
 * POST /api/operator/youtube-upload
 *
 * Server-side automatic upload trigger. This is intentionally additive: the
 * manual upload workflow remains untouched, and this route is a no-op when the
 * server is not configured for automatic uploads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin, UnauthorizedError, ForbiddenError } from '@/infrastructure/auth/dal';
import { maybeUploadRecording } from '@/infrastructure/youtube/youtubeUpload';

const bodySchema = z.object({
  missionId: z.string().min(1),
  runId: z.string().min(1),
  yardId: z.string().min(1),
  file: z.string().min(1).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  privacy: z.enum(['private', 'public', 'unlisted']).optional(),
  madeForKids: z.boolean().optional(),
});

function authFailure(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ success: false, error: 'Only an admin can trigger automatic uploads.' }, { status: 403 });
  }
  return null;
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    return authFailure(error) ?? NextResponse.json({ success: false }, { status: 500 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Send missionId, runId, yardId and optional upload details.' }, { status: 400 });
  }

  const result = await maybeUploadRecording({
    missionId: parsed.data.missionId,
    runId: parsed.data.runId,
    yardId: parsed.data.yardId,
    file: parsed.data.file,
    title: parsed.data.title,
    description: parsed.data.description,
    privacy: parsed.data.privacy,
    madeForKids: parsed.data.madeForKids,
  });

  if (result.status === 'not-configured') {
    return NextResponse.json({
      success: true,
      status: 'not-configured',
      message: 'Automatic uploads are disabled because the server OAuth settings are not configured.',
    });
  }

  if (result.status === 'failed') {
    return NextResponse.json({
      success: false,
      status: 'failed',
      error: result.error ?? 'Automatic upload failed.',
      title: result.title,
      description: result.description,
    }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    status: 'uploaded',
    missionId: parsed.data.missionId,
    runId: parsed.data.runId,
    yardId: parsed.data.yardId,
    title: result.title,
    description: result.description,
    videoId: result.videoId,
    url: result.url,
    operator: session.email ?? session.uid,
  });
}

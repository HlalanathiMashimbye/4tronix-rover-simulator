/**
 * GET / PUT /api/operator/settings
 *
 * The runtime configuration an admin can change without a deploy: where mail
 * comes from, which YouTube channel is watched, how often it is checked.
 *
 * Admin only. These decide whether learners get email at all and which
 * channel's videos are attached to their missions, which is a wider blast
 * radius than anything on the operator queue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin, ForbiddenError, UnauthorizedError } from '@/infrastructure/auth/dal';
import {
  SETTINGS,
  describeSetting,
  isSettingName,
  type SettingName,
} from '@/core/domain/services/runtimeSettings';
import { readSetting, writeSetting } from '@/infrastructure/config/runtimeSettingsStore';

const updateSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

function authFailure(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json(
      { success: false, error: 'Only an admin can change these.' },
      { status: 403 },
    );
  }
  return null;
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return authFailure(error) ?? NextResponse.json({ success: false }, { status: 500 });
  }

  const names = Object.keys(SETTINGS) as SettingName[];
  const values = await Promise.all(names.map((name) => readSetting(name)));

  return NextResponse.json({
    success: true,
    settings: names.map((name, i) => describeSetting(name, values[i])),
  });
}

export async function PUT(request: NextRequest) {
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    return authFailure(error) ?? NextResponse.json({ success: false }, { status: 500 });
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Send a name and a value.' }, { status: 400 });
  }

  const { name, value } = parsed.data;
  if (!isSettingName(name)) {
    return NextResponse.json({ success: false, error: `No setting called ${name}.` }, { status: 400 });
  }

  const spec = SETTINGS[name];
  const trimmed = value.trim();

  // Validated before it becomes a version. A Secret Manager version cannot be
  // edited, only superseded, so a typo here is permanent history and, worse,
  // live until somebody notices the email stopped.
  const complaint = spec.validate?.(trimmed) ?? null;
  if (complaint) {
    return NextResponse.json({ success: false, error: complaint }, { status: 400 });
  }

  try {
    await writeSetting(name, trimmed);
  } catch (error) {
    console.error(`[settings] Could not write ${name}:`, error);
    return NextResponse.json(
      { success: false, error: 'Could not save that. The change was not applied.' },
      { status: 502 },
    );
  }

  console.log(`[settings] ${name} changed by ${session.email ?? session.uid}`);

  return NextResponse.json({
    success: true,
    setting: describeSetting(name, trimmed),
  });
}

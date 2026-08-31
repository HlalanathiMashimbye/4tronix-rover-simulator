/**
 * GET / POST / PATCH /api/operator/yards
 *
 * The venues this platform knows about. Adding one used to be a code change.
 *
 * Admin only, like the settings page it sits on: a yard is what every mission
 * is attributed to, and inventing one is not an operator's decision.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin, ForbiddenError, UnauthorizedError } from '@/infrastructure/auth/dal';
import { adminYardRepository } from '@/infrastructure/container.server';
import { yardIdComplaint } from '@/core/domain/entities/Yard';
import { clearYardCache } from '@/infrastructure/config/yardDirectory';

const addSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Give the venue a name.'),
  area: z.string().trim().min(1, 'Give the suburb.'),
  city: z.string().trim().min(1, 'Give the city. This is the part a learner reads.'),
});

/**
 * Everything about a yard except its id.
 *
 * THE ID IS NOT EDITABLE, here or anywhere. It is the rover's hostname and
 * every mission ever run there carries it, so changing it is a migration that
 * has to write formerIds and leave the old value resolving, not a text field.
 * Correcting a venue's name or moving it to a new suburb is an edit; renaming
 * the rover is not.
 */
const patchSchema = z.object({
  id: z.string().trim().min(1),
  active: z.boolean().optional(),
  name: z.string().trim().min(1, 'The venue needs a name.').optional(),
  area: z.string().trim().min(1, 'The suburb cannot be blank.').optional(),
  city: z.string().trim().min(1, 'The city cannot be blank. It is what a learner reads.').optional(),
});

function authFailure(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ success: false, error: 'Only an admin can change yards.' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return authFailure(error) ?? NextResponse.json({ success: false }, { status: 500 });
  }

  return NextResponse.json({ success: true, yards: await adminYardRepository().findAll() });
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    return authFailure(error) ?? NextResponse.json({ success: false }, { status: 500 });
  }

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Fill in every field.' },
      { status: 400 },
    );
  }

  const { id, name, area, city } = parsed.data;

  const complaint = yardIdComplaint(id);
  if (complaint) {
    return NextResponse.json({ success: false, error: complaint }, { status: 400 });
  }

  const repository = adminYardRepository();
  const yards = await repository.findAll();

  // Refused rather than merged. An id already in use is either a typo or an
  // attempt to rename a venue, and silently overwriting a live yard would
  // re-point every mission that reads its name.
  if (yards.some((y) => y.id === id)) {
    return NextResponse.json(
      { success: false, error: `There is already a yard called ${id}.` },
      { status: 409 },
    );
  }

  // Also refused if some other yard used to be called this. Missions submitted
  // under the old name still resolve to that yard, so reusing it would make
  // one id mean two places depending on when the mission ran.
  const formerlyKnown = yards.find((y) => y.formerIds?.includes(id));
  if (formerlyKnown) {
    return NextResponse.json(
      { success: false, error: `${id} used to be ${formerlyKnown.name}, and its missions still point at it.` },
      { status: 409 },
    );
  }

  await repository.save({
    id,
    name,
    area,
    city,
    active: true,
    createdAt: new Date().toISOString(),
    addedBy: session.email ?? session.uid,
  });

  // Otherwise the admin adds a yard and does not see it for up to a minute,
  // which reads as the save having failed.
  clearYardCache();

  return NextResponse.json({ success: true, yards: await repository.findAll() });
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return authFailure(error) ?? NextResponse.json({ success: false }, { status: 500 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Send an id and what to change.' },
      { status: 400 },
    );
  }

  const { id, active, ...details } = parsed.data;

  const repository = adminYardRepository();
  const yards = await repository.findAll();
  const existing = yards.find((y) => y.id === id);
  if (!existing) {
    return NextResponse.json({ success: false, error: 'No such yard.' }, { status: 404 });
  }

  if (Object.keys(details).length > 0) {
    // Merged onto the existing yard, so an edit to one field cannot blank the
    // others and cannot drop createdAt, addedBy or formerIds.
    await repository.save({ ...existing, ...details });
  }

  if (active !== undefined) {
    // Retiring, never deleting: the yard goes on resolving for every mission
    // ever run there, it just leaves the sign-in list.
    await repository.setActive(id, active);
  }

  clearYardCache();

  return NextResponse.json({ success: true, yards: await repository.findAll() });
}

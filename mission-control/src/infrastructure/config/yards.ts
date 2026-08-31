import type { Yard } from '@/core/domain/entities/Yard';

/**
 * The seed list, and the default yard a learner's mission is addressed to.
 *
 * THIS IS NO LONGER THE SOURCE OF TRUTH. Yards live in Firestore and are read
 * through yardDirectory(); an admin adds one on the settings page. What is
 * left here is the list scripts/seed-yards.mjs carried across, kept so that
 * history is readable, and DEFAULT_YARD_ID, which is a different question:
 * which yard a mission submitted on the public site is queued for when
 * NEXT_PUBLIC_YARD_ID is unset. See ./yard.ts.
 *
 * The per-browser selection that used to live here is gone with it. It backed
 * a dropdown on the operator console, which made working at the wrong yard a
 * stray click. The yard is chosen at sign-in now and carried beside the
 * session cookie: see infrastructure/auth/dal.ts.
 */
export const KNOWN_YARDS: Yard[] = [
  {
    id: 'curiosity',
    formerIds: ['uct-rover-1', 'cape-town'],
    name: 'Cape Town Science Centre',
    area: 'Observatory',
    city: 'Cape Town',
    active: true,
  },
];

export const DEFAULT_YARD_ID = KNOWN_YARDS[0].id;

/**
 * The learner-ref hash is computed in two places that must agree exactly:
 *
 *   - hashLearnerId() here, via Web Crypto, in the browser and the API
 *   - scripts/backfill-learner-refs.mjs, via node:crypto, when migrating
 *
 * A mismatch would not throw. It would quietly write refs that nothing ever
 * matches, so history would come back empty and notifications would silently
 * stop resolving. This pins the algorithm so a well-meaning change to either
 * side fails loudly instead.
 */

import { createHash } from 'node:crypto';
import { hashLearnerId } from '@/core/domain/services/learnerRef';

describe('hashLearnerId', () => {
  it('produces a 64-character hex sha-256 digest', async () => {
    const ref = await hashLearnerId('V1StGXR8_Z5jdHi6B-myT');
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns the id it was given', async () => {
    // The whole point: the raw id must not survive onto a public document.
    const id = 'V1StGXR8_Z5jdHi6B-myT';
    expect(await hashLearnerId(id)).not.toBe(id);
  });

  it('is stable, so a returning learner still finds their own history', async () => {
    const a = await hashLearnerId('V1StGXR8_Z5jdHi6B-myT');
    const b = await hashLearnerId('V1StGXR8_Z5jdHi6B-myT');
    expect(a).toBe(b);
  });

  it('separates different learners', async () => {
    expect(await hashLearnerId('learner-a')).not.toBe(await hashLearnerId('learner-b'));
  });

  it('ignores surrounding whitespace', async () => {
    expect(await hashLearnerId('  learner-123  ')).toBe(await hashLearnerId('learner-123'));
  });

  it('rejects an empty id rather than hashing nothing', async () => {
    await expect(hashLearnerId('   ')).rejects.toThrow('Cannot hash an empty learner id');
  });

  it('matches the node:crypto digest the backfill script uses', async () => {
    // Guards the migration path specifically. If these ever diverge, every
    // backfilled document points at a ref the app will never query for.
    for (const id of ['V1StGXR8_Z5jdHi6B-myT', 'learner-123', 'a']) {
      const fromScript = createHash('sha256').update(id.trim()).digest('hex');
      expect(await hashLearnerId(id)).toBe(fromScript);
    }
  });
});

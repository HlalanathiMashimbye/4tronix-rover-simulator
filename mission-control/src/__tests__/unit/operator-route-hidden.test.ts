/**
 * The operator route must not be discoverable from the learner UI (AB#341).
 *
 * Hiding is NOT the security control - lib/auth/dal.ts is, and App Router route
 * manifests name every route regardless. This guards a narrower thing: nobody
 * should be able to add an operator link to the learner navigation without a
 * test noticing.
 *
 * The navbar is the trap. It renders navigation TWICE - a NAV_ITEMS-driven
 * desktop row and a hand-written mobile tab bar - so a link added in one place
 * appears on one breakpoint only and reads as a styling bug.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the operator route is unlinked', () => {
  it('is absent from the navbar, both the desktop list and the mobile bar', () => {
    expect(read('src/components/layout/Navbar.tsx')).not.toContain('/operator');
  });

  it('is absent from the root layout', () => {
    expect(read('src/app/layout.tsx')).not.toContain('/operator');
  });

  it('is not linked from any learner-facing component', () => {
    // A <Link> would also put the path in the client route manifest via
    // prefetching, so this is about more than a visible button.
    const learnerSurfaces = [
      'src/components/layout/Navbar.tsx',
      'src/components/MissionCard/MissionCard.tsx',
      'src/components/mission/MissionWorkspace.tsx',
    ];

    for (const file of learnerSurfaces) {
      expect(read(file)).not.toMatch(/href=["'`]\/operator/);
    }
  });

  it('is disallowed in robots.txt', () => {
    const robots = read('src/app/robots.ts');

    expect(robots).toContain("'/operator'");
    expect(robots).toContain("'/api/operator'");
  });

  it('is marked noindex on the operator layout itself', () => {
    // robots.txt is a request; the meta tag is what a crawler that ignored it
    // still sees.
    expect(read('src/app/operator/layout.tsx')).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});

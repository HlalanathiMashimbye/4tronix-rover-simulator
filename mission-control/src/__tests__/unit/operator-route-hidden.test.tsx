/**
 * @jest-environment jsdom
 */

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
import { render, screen } from '@testing-library/react';
import { Navbar } from '@/components/layout/Navbar';
import { SearchProvider } from '@/contexts/SearchContext';
import robots from '@/app/robots';
import { metadata as operatorMetadata } from '@/app/operator/layout';

jest.mock('next/navigation', () => ({ usePathname: () => '/' }));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggleTheme: () => {} }) }));
jest.mock('@/hooks/useCompletionNotifications', () => ({
  useCompletionNotifications: () => ({ unread: [], hasUnread: false, markAllSeen: () => {}, dismiss: () => {} }),
}));
jest.mock('@/components/learner/EmailPrompt', () => ({ EmailPrompt: () => null }));
jest.mock('@/contexts/TourContext', () => ({ useTour: () => ({ start: () => {}, active: false }) }));

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the operator route is unlinked', () => {
  it('is absent from the navbar, both the desktop list and the mobile bar', () => {
    // Rendered, so both bars are in the DOM together; CSS hides one per size.
    render(
      <SearchProvider>
        <Navbar />
      </SearchProvider>,
    );

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.filter((href) => href.startsWith('/operator'))).toEqual([]);
  });

  it('is absent from the root layout', () => {
    expect(read('src/app/layout.tsx')).not.toContain('/operator');
  });

  it('is not linked from any learner-facing component', () => {
    // A structural guard, deliberately on the source: a <Link> would also put
    // the path in the client route manifest via prefetching, so this is about
    // more than a visible button, and these surfaces are too heavy to render
    // here just to find an href.
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
    const rules = [robots().rules].flat();

    expect(rules.flatMap((rule) => [rule?.disallow ?? []].flat())).toEqual(
      expect.arrayContaining(['/operator', '/api/operator']),
    );
  });

  it('is marked noindex on the operator layout itself', () => {
    // robots.txt is a request; the meta tag is what a crawler that ignored it
    // still sees.
    expect(operatorMetadata.robots).toMatchObject({ index: false });
  });
});

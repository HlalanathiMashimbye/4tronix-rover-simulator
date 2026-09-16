import type { Metadata } from 'next';

/**
 * The operator surface is reachable by URL only. There is no link to it from
 * anywhere a learner can see, by decision at the 2026-08-20 standup: a visible
 * login button on a site used by children invites poking at it.
 *
 * Hiding is NOT the security control. App Router route manifests name routes
 * regardless, so anyone determined will find the path. The control is the
 * session cookie verified in lib/auth/dal.ts. This only keeps curious learners
 * from wandering in, and that distinction is worth stating because it will be
 * asked.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  // data-surface is read by globals.css to zero --app-bottom-chrome: below
  // md the learner's fixed tab bar is not rendered on this surface (see
  // Navbar.tsx), so the padding that keeps content clear of it would be a
  // dead 64px band under the console's own tab bar. display: contents keeps
  // this wrapper out of the layout.
  return (
    <div data-surface="operator" className="contents">
      {children}
    </div>
  );
}

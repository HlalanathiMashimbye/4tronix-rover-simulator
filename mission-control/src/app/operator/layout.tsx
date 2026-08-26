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
  return children;
}

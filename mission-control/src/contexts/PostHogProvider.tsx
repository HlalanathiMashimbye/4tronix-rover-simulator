'use client';

/**
 * PostHog Provider
 *
 * Initializes autocapture + session replay (rage clicks, dead clicks, error
 * clicks) once on mount. `environment` is passed in as a prop rather than
 * read from process.env here on purpose: this file is a client component, so
 * only NEXT_PUBLIC_* vars would be visible to it, and those get frozen into
 * the bundle at build time. Prod promotes the exact image digest built for
 * staging (see appUrl.ts / environment.ts), so a build-time environment tag
 * would permanently label prod events as staging - the same bug #82 fixed for
 * the environment banner. The caller resolves it server-side, at request
 * time, and hands it down.
 *
 * The PostHog project key itself is fine to bake at build time: it is the
 * same project for every environment, and `environment` is what tells them
 * apart in the PostHog UI.
 */

import { useEffect, ReactNode } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

export function PostHogProvider({
  environment,
  children,
}: {
  environment: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!POSTHOG_KEY) return;

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_exceptions: true,
      defaults: '2026-05-30',
      // Session replay only records once "Record user sessions" is also
      // turned on in PostHog's project settings - that toggle is the actual
      // gate, this client never disables it. maskAllInputs is worth being
      // explicit about though: this app has real auth (OperatorSignIn) and
      // PII (EmailPrompt, TeamManager) input fields that replay shouldn't
      // capture verbatim.
      session_recording: {
        maskAllInputs: true,
      },
    });
    posthog.register({ environment });

    // The npm import above only gives a module-scoped reference - unlike the
    // hosted snippet, it never touches `window` on its own. Exposing it here
    // is what makes `posthog.capture(...)` work from the browser console.
    (window as unknown as { posthog: typeof posthog }).posthog = posthog;
    // Runs once per full page load. RootLayout (and this provider with it)
    // stays mounted across client-side navigation in the App Router, so an
    // empty dep array - not [environment] - is what keeps this a single init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No key configured (e.g. local dev without .env set up): render children
  // unwrapped rather than initializing PostHog against an empty key.
  if (!POSTHOG_KEY) return <>{children}</>;

  return <PHProvider client={posthog}>{children}</PHProvider>;
}

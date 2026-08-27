import { connection } from 'next/server';

import { resolveEnvironment } from '@/infrastructure/config/environment';
import { PostHogProvider } from '@/contexts/PostHogProvider';

/**
 * Server-side wrapper that resolves which environment this request is
 * actually running in - at request time, not build time - and hands it to
 * the client-side PostHogProvider to tag onto every event. `connection()` is
 * load-bearing: without it this sits in a statically prerendered layout and
 * resolveEnvironment() runs at build time, before APP_ENV exists. See
 * EnvironmentBanner, which hit exactly this bug (#82).
 */
export async function PostHogAnalytics({ children }: { children: React.ReactNode }) {
  await connection();

  const environment = resolveEnvironment();

  return <PostHogProvider environment={environment}>{children}</PostHogProvider>;
}

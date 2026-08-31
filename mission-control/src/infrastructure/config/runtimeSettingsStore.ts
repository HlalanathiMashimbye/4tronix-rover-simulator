import 'server-only';

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

import { SETTINGS, type SettingName } from '@/core/domain/services/runtimeSettings';

/**
 * Reading and writing the admin-editable settings, at request time.
 *
 * They used to be mounted as Cloud Run secret env vars. That cannot back a
 * settings page: Cloud Run resolves `version: latest` when an INSTANCE STARTS,
 * so a new version reaches new instances and not running ones. Saving a key
 * would have looked like it worked while half the traffic kept using the old
 * one, which is worse than it plainly not working.
 *
 * So they are read here instead, cached briefly. A change is live everywhere
 * within CACHE_TTL_MS rather than at the next deploy, and nothing is ever
 * stored outside Secret Manager.
 */

// Short enough that "a few clicks" means the change has landed by the time
// somebody checks, long enough that a burst of email does not become a burst
// of Secret Manager calls.
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: string | null;
  readAt: number;
}

const cache = new Map<string, CacheEntry>();
let client: SecretManagerServiceClient | undefined;

function secretClient(): SecretManagerServiceClient {
  client ??= new SecretManagerServiceClient();
  return client;
}

function projectId(): string {
  const id = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!id) throw new Error('FIREBASE_PROJECT_ID is required to reach Secret Manager.');
  return id;
}

/**
 * The value in force, or null.
 *
 * The environment wins when set, which is what keeps local development and
 * the test suite working with a plain .env and no Google credentials at all.
 * In Cloud Run these are deliberately NOT mounted, so the lookup falls
 * through to Secret Manager and the settings page is what decides.
 */
export async function readSetting(name: SettingName): Promise<string | null> {
  const spec = SETTINGS[name];

  const fromEnv = process.env[spec.envVar]?.trim();
  if (fromEnv) return fromEnv;

  const cached = cache.get(name);
  if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) {
    return cached.value;
  }

  let value: string | null = null;
  try {
    const [version] = await secretClient().accessSecretVersion({
      name: `projects/${projectId()}/secrets/${spec.secretId}/versions/latest`,
    });
    value = version.payload?.data?.toString() ?? null;
    // An empty version is how "unset" is expressed, since a secret cannot
    // have zero versions once Cloud Run has ever mounted it.
    if (value === '') value = null;
  } catch {
    // Absent, or unreachable. Either way the caller's own "not configured"
    // path is the right one, and it should not be reached through a stack
    // trace on every email.
    value = null;
  }

  cache.set(name, { value, readAt: Date.now() });
  return value;
}

/** Adds a new version and drops this instance's cached copy. */
export async function writeSetting(name: SettingName, value: string): Promise<void> {
  const spec = SETTINGS[name];

  await secretClient().addSecretVersion({
    parent: `projects/${projectId()}/secrets/${spec.secretId}`,
    payload: { data: Buffer.from(value, 'utf8') },
  });

  // Only this instance's. Others expire within CACHE_TTL_MS, which is the
  // bound on how stale a just-changed setting can be anywhere.
  cache.delete(name);
}

/** Test seam: the cache is process-wide and would otherwise leak between tests. */
export function clearSettingsCache(): void {
  cache.clear();
}

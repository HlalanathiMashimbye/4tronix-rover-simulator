/**
 * Every admin setting has a secret Terraform creates and lets the app use.
 *
 * A setting is declared twice: in runtimeSettings.ts, which the Settings page
 * reads, and in infra/modules/mission-control/main.tf, which creates its
 * Secret Manager secret and grants the runtime accounts access to it. Nothing
 * else checks that the two agree, and when they did not, the YouTube upload
 * settings sat on the Settings page for weeks with nowhere to be saved: the
 * secrets did not exist, or the services could not read them, and every save
 * failed.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { SETTINGS } from '@/core/domain/services/runtimeSettings';

const MODULE = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'infra', 'modules', 'mission-control', 'main.tf'),
  'utf8',
);

/** secret_id -> Terraform resource name, for every Secret Manager secret. */
const secretResources = new Map(
  [...MODULE.matchAll(/resource "google_secret_manager_secret" "(\w+)" \{\s*secret_id\s*=\s*"([^"]+)"/g)].map(
    ([, resource, secretId]) => [secretId, resource],
  ),
);

/** The resources the runtime accounts may read and add versions to. */
const editable = new Set(
  [...(MODULE.match(/editable_secrets = \{([\s\S]*?)\n  \}/)?.[1] ?? '').matchAll(
    /google_secret_manager_secret\.(\w+)/g,
  )].map(([, resource]) => resource),
);

describe('admin settings and their Terraform', () => {
  it('finds the secrets and the editable list it is checking against', () => {
    expect(secretResources.size).toBeGreaterThan(5);
    expect(editable.size).toBeGreaterThan(5);
  });

  it.each(Object.entries(SETTINGS))('%s has a secret Terraform creates', (_name, spec) => {
    expect(secretResources.get(spec.secretId)).toBeDefined();
  });

  it.each(Object.entries(SETTINGS))('%s is one the app may read and save', (_name, spec) => {
    expect(editable.has(secretResources.get(spec.secretId) ?? '')).toBe(true);
  });
});

/**
 * The two Firestore deploy configs, and the database name, agree.
 *
 * firebase.json is single-database because the Firestore emulator cannot load
 * rules from a list of databases: given one, it allows every read and write.
 * So prod's rules go out through a second file, firebase.prod.json, and
 * scripts/deploy-firestore.sh deploys both. Two files that must agree drift
 * unless something checks them, and a drift here would ship prod a different
 * rules file, or deploy rules to a database nothing reads.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

type FirestoreConfig = { database?: string; rules: string; indexes: string };
const firestoreOf = (file: string): FirestoreConfig => JSON.parse(read(file)).firestore;

/** The database prod's service is given, from the file Terraform applies. */
function prodDatabaseInTfvars(): string {
  const environments = read('infra/impact.tfvars').match(/^environments\s*=\s*\{([\s\S]*?)^\}/m)?.[1] ?? '';
  const prod = environments.match(/^\s*prod\s*=\s*\{([^}]*)\}/m)?.[1] ?? '';
  return prod.match(/firestore_database\s*=\s*"([^"]+)"/)?.[1] ?? '';
}

describe('Firestore deploy config', () => {
  const emulator = firestoreOf('firebase.json');
  const prod = firestoreOf('firebase.prod.json');

  it('keeps firebase.json to one database, which is all the emulator can load rules for', () => {
    expect(Array.isArray(emulator)).toBe(false);
    expect(emulator.database ?? '(default)').toBe('(default)');
  });

  it('deploys the same rules and indexes to prod as to (default)', () => {
    expect(prod.rules).toBe(emulator.rules);
    expect(prod.indexes).toBe(emulator.indexes);
  });

  it("deploys them to the database Terraform gives prod's service", () => {
    expect(prodDatabaseInTfvars()).not.toBe('');
    expect(prod.database).toBe(prodDatabaseInTfvars());
  });

  it('deploys both from the one script', () => {
    const script = read('scripts/deploy-firestore.sh');
    expect(script).toMatch(/deploy "\(default\)" firebase\.json/);
    expect(script).toMatch(/deploy "prod" firebase\.prod\.json/);
  });
});

/**
 * A soft-deleted run reads as gone, on both paths that read runs.
 *
 * There are two: findRuns on the server and subscribeToMissionRuns in the
 * browser. They are separate code, so a filter added to one and not the other
 * means a run that vanishes from the console and comes back on refresh, or the
 * reverse. Both are asserted here for that reason.
 *
 * Filtered in code rather than with a where() clause on purpose: runs written
 * before soft delete existed carry no `deleted` field at all, and Firestore
 * omits documents missing the field from an equality filter - which would hide
 * every historical run rather than the one that was deleted.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('deleted runs are filtered on every read path', () => {
  it('the server read filters them', () => {
    const repo = read('infrastructure/persistence/FirestoreMissionRepository.ts');
    const findRuns = repo.slice(repo.indexOf('async findRuns('), repo.indexOf('async findRuns(') + 1200);

    // Both SDK branches, admin and client.
    expect(findRuns.match(/\.deleted\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(findRuns).not.toMatch(/where\(\s*['"]deleted['"]/);
  });

  it('the live subscription filters them too', () => {
    const service = read('infrastructure/persistence/operatorQueueService.ts');
    const sub = service.slice(service.indexOf('subscribeToMissionRuns'));

    expect(sub).toContain('.deleted)');
    expect(sub).not.toMatch(/where\(\s*['"]deleted['"]/);
  });

  it('removing a video writes a cleared field rather than nothing', () => {
    // `if (change.youtubeUrl)` alone can only ever set a link, never take one
    // off, because an absent value is indistinguishable from "leave it alone".
    const repo = read('infrastructure/persistence/FirestoreMissionRepository.ts');

    expect(repo).toContain('change.clearsVideo');
    expect(repo).toMatch(/runFields\.youtubeUrl = null/);
  });
});

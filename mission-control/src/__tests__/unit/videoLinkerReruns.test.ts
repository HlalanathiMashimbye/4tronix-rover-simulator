/**
 * The linker writing a re-run's video to a run of its own, end to end against
 * an in-memory mission, so the decision in planVideoLink and the write here
 * are checked together.
 */

import { VideoLinker } from '@/core/application/services/VideoLinker';
import type { MissionRecord } from '@/core/domain/entities/Mission';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import { watchUrl } from '@/core/domain/services/youtubeLinking';

function setUp(runs: MissionRun[]) {
  const writes: Array<{ runId: string; status: unknown; youtubeUrl: unknown }> = [];
  const notify = jest.fn(async () => ({ sent: true as const }));
  const mission = { id: 'm1', yardId: 'curiosity', status: 'completed', learnerRef: 'r', sessionId: 's', code: '', submittedAt: '' } as MissionRecord;
  const linker = new VideoLinker(
    {
      findRuns: async () => runs,
      findById: async () => mission,
      applyBookkeeping: async (_missionId, runId, _yardId, change) => {
        writes.push({ runId, status: change.status, youtubeUrl: change.youtubeUrl });
        const existing = runs.find((r) => r.runId === runId);
        if (existing) existing.youtubeUrl = change.youtubeUrl;
        else runs.push({ runId, yardId: 'curiosity', status: 'completed', youtubeUrl: change.youtubeUrl });
      },
    },
    { notifyStatusChange: notify },
    () => 'generated-id',
  );
  return { linker, writes, notify, runs };
}

it("puts a re-run's video on a new run named for its dispatch, and leaves the first run's video alone", async () => {
  const { linker, writes, runs } = setUp([
    { runId: 'r1', yardId: 'curiosity', status: 'completed', youtubeUrl: watchUrl('Q6rBdpXeNxM') },
  ]);

  const result = await linker.link(
    { missionId: 'm1', yardId: 'curiosity', videoId: 'secondRun02', dispatchId: 'dispatch-2' },
    'youtube-auto-upload',
  );

  expect(result).toMatchObject({ kind: 'linked', runId: 'dispatch-2', completed: true });
  expect(writes).toEqual([{ runId: 'dispatch-2', status: 'completed', youtubeUrl: watchUrl('secondRun02') }]);
  expect(runs.map((r) => r.youtubeUrl)).toEqual([watchUrl('Q6rBdpXeNxM'), watchUrl('secondRun02')]);
});

it('writes nothing more when the satellite delivers the same video again', async () => {
  const { linker, writes } = setUp([
    { runId: 'r1', yardId: 'curiosity', status: 'completed', youtubeUrl: watchUrl('Q6rBdpXeNxM') },
  ]);
  const claim = { missionId: 'm1', yardId: 'curiosity', videoId: 'secondRun02', dispatchId: 'dispatch-2' };

  await linker.link(claim, 'youtube-auto-upload');
  const again = await linker.link(claim, 'youtube-auto-upload');

  expect(again.kind).toBe('skipped');
  expect(writes).toHaveLength(1);
});

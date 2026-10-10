/**
 * Matching uploads back to missions, from Mission Control rather than a yard.
 */

import {
  claimedMissions,
  missionFromVideo,
  planVideoLink,
  runToLink,
  watchUrl,
} from '@/core/domain/services/youtubeLinking';
import type { MissionRun } from '@/core/domain/entities/MissionRun';

function run(over: Partial<MissionRun> = {}): MissionRun {
  return { yardId: 'curiosity', status: 'completed', ...over } as MissionRun;
}

describe('reading the mission id out of a video', () => {
  it('finds the line the run station generates', () => {
    const claim = missionFromVideo({
      title: '',
      description: 'Lunar Mapper, driven by a real rover.\n\nMissionID: m-7f3a91',
    });

    expect(claim?.missionId).toBe('m-7f3a91');
  });

  it('tolerates the spacing a person might retype', () => {
    expect(missionFromVideo({ title: '', description: 'MissionID:m1' })?.missionId).toBe('m1');
    expect(missionFromVideo({ title: '', description: 'MissionID:   m1' })?.missionId).toBe('m1');
  });

  it('is null when the description says nothing about a mission', () => {
    expect(missionFromVideo({ title: '', description: 'Our rover doing a square!' })).toBeNull();
    expect(missionFromVideo({ title: '', description: '' })).toBeNull();
  });

  it('needs the marker, not a mention of it', () => {
    // Prose about the field must not link a mission called "is".
    expect(missionFromVideo({ title: '', description: 'the MissionID is below' })).toBeNull();
  });
});

describe('the filename YouTube turns into a title', () => {
  /**
   * The satellite writes `<missionId>__<yardId>__<stamp>.mp4` and YouTube
   * Studio prefills a title from the uploaded filename. An operator who
   * uploads the file as they downloaded it has labelled it without typing
   * anything, which is the version that survives the end of a long event day.
   */
  it('reads the mission id from an unrenamed recording', () => {
    expect(missionFromVideo({ title: 'm-7f3a91__curiosity__20260912T013122Z', description: '' })?.missionId)
      .toBe('m-7f3a91');
  });

  it('still reads a title with no stamp, from before recordings carried one', () => {
    expect(missionFromVideo({ title: 'm-7f3a91__curiosity', description: '' })?.missionId).toBe('m-7f3a91');
  });

  it('rejects a stamp that is not the shape recording_control writes', () => {
    // A third segment that is not the UTC stamp format must not qualify -
    // otherwise any two-underscore title would claim a mission.
    expect(missionFromVideo({ title: 'm1__curiosity__notastamp', description: '' })).toBeNull();
  });

  it('still works when the description was pasted as well', () => {
    // Both paths present is the ordinary case, not a conflict.
    expect(missionFromVideo({ title: 'm1__curiosity', description: 'MissionID: m1' })?.missionId)
      .toBe('m1');
  });

  it('prefers an explicit marker over the filename', () => {
    // Somebody who took the trouble to paste the block meant it.
    expect(missionFromVideo({ title: 'wrong__curiosity', description: 'MissionID: right' })?.missionId)
      .toBe('right');
  });

  it('ignores a title that is merely a title', () => {
    expect(missionFromVideo({ title: 'Our rover doing a square!', description: '' })).toBeNull();
  });

  it('needs the yard tail, so a bare word cannot claim a mission', () => {
    /**
     * The tail is what makes matching a title safe at all. Without it any
     * one-word title would claim a mission of that name.
     */
    expect(missionFromVideo({ title: 'holiday', description: '' })).toBeNull();
  });

  it('a wrong guess costs a lookup, not a mislabelled child', () => {
    /**
     * `holiday__beach` does parse, and that is fine: the linker then asks
     * Firestore for a mission called "holiday", finds none, and moves on. The
     * failure mode is a wasted read rather than somebody else's video landing
     * on a learner's page.
     */
    expect(missionFromVideo({ title: 'holiday__beach', description: '' })?.missionId).toBe('holiday');
  });
});

describe('what the recent uploads claim', () => {
  it('ignores videos with no marker, so a poll of ordinary uploads is free', () => {
    const claims = claimedMissions([
      { videoId: 'v1', title: '', description: 'holiday video' },
      { videoId: 'v2', title: '', description: 'MissionID: m1' },
    ]);

    expect(claims).toEqual([{ missionId: 'm1', yardId: null, videoId: 'v2' }]);
  });

  it('lets a re-upload win, because that is why people re-upload', () => {
    // Newest first, as the API returns them.
    const claims = claimedMissions([
      { videoId: 'new', title: '', description: 'MissionID: m1' },
      { videoId: 'old', title: '', description: 'MissionID: m1' },
    ]);

    expect(claims).toEqual([{ missionId: 'm1', yardId: null, videoId: 'new' }]);
  });

  it('builds a watchable url', () => {
    expect(watchUrl('abc123')).toBe('https://www.youtube.com/watch?v=abc123');
  });
});

describe('choosing which run the video belongs to', () => {
  it('takes the most recently completed run without a video', () => {
    const chosen = runToLink([
      run({ yardId: 'a', completedAt: '2026-08-01T10:00:00Z' }),
      run({ yardId: 'b', completedAt: '2026-08-30T10:00:00Z' }),
    ]);

    expect(chosen?.yardId).toBe('b');
  });

  it('never steals a run that already has its video', () => {
    const chosen = runToLink([
      run({ yardId: 'a', completedAt: '2026-08-30T10:00:00Z', youtubeUrl: 'https://y/1' }),
      run({ yardId: 'b', completedAt: '2026-08-01T10:00:00Z' }),
    ]);

    expect(chosen?.yardId).toBe('b');
  });

  it('is null once every completed run has a video', () => {
    /**
     * The ordinary case on every poll after the one that first saw the
     * upload. Attaching again is a write that changes nothing and an email
     * that repeats itself.
     */
    expect(runToLink([run({ youtubeUrl: 'https://y/1' })])).toBeNull();
  });

  it('will not attach to a run that has not finished', () => {
    expect(runToLink([run({ status: 'processing' })])).toBeNull();
  });

  it('is null for a mission nothing has run', () => {
    expect(runToLink([])).toBeNull();
  });
});

describe('which yard a video belongs to', () => {
  /**
   * The question the filename already answers and the linker used to throw
   * away. With one run per yard, mission plus yard identifies a run exactly,
   * so there is nothing left to guess.
   */
  it('takes the yard from the recording filename', () => {
    expect(missionFromVideo({ title: 'm1__durban', description: '' })).toEqual({
      missionId: 'm1',
      yardId: 'durban',
    });
  });

  it('takes the yard from a stamped recording filename too', () => {
    expect(missionFromVideo({ title: 'm1__durban__20260912T013122Z', description: '' })).toEqual({
      missionId: 'm1',
      yardId: 'durban',
    });
  });

  it('reads an explicit Yard line beside the MissionID one', () => {
    expect(
      missionFromVideo({ title: '', description: 'MissionID: m1\nYard: curiosity' }),
    ).toEqual({ missionId: 'm1', yardId: 'curiosity' });
  });

  it('admits it does not know, rather than inventing one', () => {
    // Null is what keeps runToLink as the fallback instead of a wrong guess
    // dressed up as a fact.
    expect(missionFromVideo({ title: '', description: 'MissionID: m1' })?.yardId).toBeNull();
  });

  it('keeps both yards when two ran the same mission', () => {
    /**
     * Deduping on the mission alone dropped whichever video was uploaded
     * second, which is the exact collision capturing the yard exists to stop.
     */
    const claims = claimedMissions([
      { videoId: 'v-ct', title: 'm1__curiosity', description: '' },
      { videoId: 'v-dbn', title: 'm1__durban', description: '' },
    ]);

    expect(claims.map((c) => c.yardId)).toEqual(['curiosity', 'durban']);
  });

  it('still collapses a genuine re-upload of the same run', () => {
    const claims = claimedMissions([
      { videoId: 'new', title: 'm1__curiosity', description: '' },
      { videoId: 'old', title: 'm1__curiosity', description: '' },
    ]);

    expect(claims).toEqual([{ missionId: 'm1', yardId: 'curiosity', videoId: 'new' }]);
  });
});

describe('a mission run more than once at the same yard', () => {
  const run = (over: Partial<MissionRun> & { runId: string }): MissionRun => ({
    yardId: 'curiosity',
    status: 'completed',
    ...over,
  });

  it('gives the second upload the second run, not nothing', () => {
    /**
     * The regression this closes. Before "log another run" existed there was
     * only ever one run per yard, so once its video was attached runToLink
     * returned null and every later upload was dropped on the floor - which is
     * exactly what happens to a re-run's footage that the yard kept.
     */
    const runs = [
      run({ runId: 'r1', completedAt: '2026-09-03T10:00:00Z', youtubeUrl: 'https://youtu.be/first' }),
      run({ runId: 'r2', completedAt: '2026-09-03T11:00:00Z' }),
    ];

    expect(runToLink(runs)?.runId).toBe('r2');
  });

  it('takes the newest run without a video when several are waiting', () => {
    const runs = [
      run({ runId: 'r1', completedAt: '2026-09-03T10:00:00Z' }),
      run({ runId: 'r3', completedAt: '2026-09-03T12:00:00Z' }),
      run({ runId: 'r2', completedAt: '2026-09-03T11:00:00Z' }),
    ];

    expect(runToLink(runs)?.runId).toBe('r3');
  });

  it('still stops once every run has its own video', () => {
    // Otherwise each poll would re-attach and re-notify for ever.
    const runs = [
      run({ runId: 'r1', completedAt: '2026-09-03T10:00:00Z', youtubeUrl: 'https://youtu.be/a' }),
      run({ runId: 'r2', completedAt: '2026-09-03T11:00:00Z', youtubeUrl: 'https://youtu.be/b' }),
    ];

    expect(runToLink(runs)).toBeNull();
  });

  describe('and filmed fewer times than it was run', () => {
    /**
     * Seen on the live site on 10 October 2026: a mission run twice, one
     * video uploaded, and the learner's page showing that video on both runs.
     * An upload stays among the channel's recent uploads for many polls, and
     * each poll handed it to the next run still waiting.
     */
    const FILMED = 'wThPlyLSVmw';
    const ANOTHER = 'secondRun02';

    const claim = (videoId: string) => ({ missionId: 'm1', yardId: 'curiosity', videoId });

    /** The runs as the next poll finds them, once a link has been written. */
    const afterLinking = (runs: MissionRun[], runId: string, videoId: string): MissionRun[] =>
      runs.map((r) => (r.runId === runId ? { ...r, youtubeUrl: watchUrl(videoId) } : r));

    const twoRuns = [
      run({ runId: 'r1', completedAt: '2026-10-10T09:00:00Z' }),
      run({ runId: 'r2', completedAt: '2026-10-10T10:00:00Z' }),
    ];

    it('gives one video to one run, however many polls see it', () => {
      const first = planVideoLink(claim(FILMED), twoRuns, undefined);
      expect(first).toEqual({ kind: 'link', runId: 'r2', yardId: 'curiosity', completes: false });

      const second = planVideoLink(claim(FILMED), afterLinking(twoRuns, 'r2', FILMED), undefined);
      expect(second.kind).toBe('skip');
    });

    it('still gives a genuinely different video to the run left waiting', () => {
      // The guard is about THIS video, not about the mission having a video.
      const plan = planVideoLink(claim(ANOTHER), afterLinking(twoRuns, 'r2', FILMED), undefined);

      expect(plan).toEqual({ kind: 'link', runId: 'r1', yardId: 'curiosity', completes: false });
    });

    it('knows its video in whatever form an operator pasted the link', () => {
      // Attached by hand as a share link, which is not the url the linker writes.
      const runs = [
        twoRuns[0],
        run({ ...twoRuns[1], youtubeUrl: `https://youtu.be/${FILMED}` }),
      ];

      expect(planVideoLink(claim(FILMED), runs, undefined).kind).toBe('skip');
    });

    it('will not take a video that is already on another yard\'s run', () => {
      const runs = [
        run({ runId: 'r-dbn', yardId: 'durban', completedAt: '2026-10-10T10:00:00Z', youtubeUrl: watchUrl(FILMED) }),
        run({ runId: 'r-ct', completedAt: '2026-10-10T09:00:00Z' }),
      ];

      expect(planVideoLink(claim(FILMED), runs, undefined).kind).toBe('skip');
    });

    it('does not close a re-run still waiting with the video of the run before it', () => {
      /**
       * The same fault with a worse ending. The queued run has no video, so
       * it was "the run to link", and linking an open run completes it and
       * emails the learner about a drive the rover has not done yet.
       */
      const runs = [
        run({ runId: 'r1', completedAt: '2026-10-10T09:00:00Z', youtubeUrl: watchUrl(FILMED) }),
        run({ runId: 'r2', status: 'queued', startedAt: '2026-10-10T10:00:00Z' }),
      ];
      const mission = { status: 'queued' as const, yardId: 'curiosity' };

      expect(planVideoLink(claim(FILMED), runs, undefined).kind).toBe('skip');
      expect(planVideoLink(claim(FILMED), runs, mission).kind).toBe('skip');
    });
  });

  describe('and re-uploaded', () => {
    /**
     * Unchanged by the one-video-one-run rule, and pinned here so it stays
     * that way: a re-upload has a new id, so it is a new video as far as the
     * linker can tell.
     */
    const ORIGINAL = 'wThPlyLSVmw';
    const REUPLOAD = 'reUploaded3';

    const upload = (videoId: string) => ({ videoId, title: 'm1__curiosity', description: '' });

    it('does not replace the video a run already has', () => {
      const runs = [run({ runId: 'r1', completedAt: '2026-10-10T09:00:00Z', youtubeUrl: watchUrl(ORIGINAL) })];
      const [claim] = claimedMissions([upload(REUPLOAD), upload(ORIGINAL)]);

      expect(claim.videoId).toBe(REUPLOAD);
      expect(planVideoLink(claim, runs, undefined).kind).toBe('skip');
    });

    it('goes to a run that is still waiting, as any new video would', () => {
      const runs = [
        run({ runId: 'r1', completedAt: '2026-10-10T09:00:00Z' }),
        run({ runId: 'r2', completedAt: '2026-10-10T10:00:00Z', youtubeUrl: watchUrl(ORIGINAL) }),
      ];
      const [claim] = claimedMissions([upload(REUPLOAD), upload(ORIGINAL)]);

      expect(planVideoLink(claim, runs, undefined)).toEqual({
        kind: 'link', runId: 'r1', yardId: 'curiosity', completes: false,
      });
    });
  });
});

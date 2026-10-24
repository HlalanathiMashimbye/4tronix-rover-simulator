/**
 * An automatically uploaded video is titled after its mission, in the words
 * the run station suggests for a manual upload.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { isGeneratedMissionName } from '@/core/domain/services/missionNameGenerator';
import {
  MISSION_VIDEO_TITLE_SUFFIX,
  missionFromVideo,
  missionVideoTitle,
} from '@/core/domain/services/youtubeLinking';
import { buildAutomaticUploadDescription } from '@/infrastructure/youtube/youtubeUpload';

// A name the generator gave a real mission, the first one uploaded automatically.
const NAME = 'Cheerful Pebble Ranger';
const RUN_STATION = readFileSync(join(__dirname, '../../../../yard/satellite/templates/run.html'), 'utf8');

describe('missionVideoTitle', () => {
  it('is a generated name followed by what the video is', () => {
    expect(isGeneratedMissionName(NAME)).toBe(true);
    expect(missionVideoTitle(NAME)).toBe('Cheerful Pebble Ranger · Mars Yard rover run');
  });

  it('keeps a name a child typed off YouTube', () => {
    expect(missionVideoTitle('Bobs Rover')).toBe('Rover mission · Mars Yard rover run');
  });

  it.each([null, undefined, ''])('stands in when there is no name (%p)', (name) => {
    expect(missionVideoTitle(name)).toBe('Rover mission · Mars Yard rover run');
  });

  it("matches the run station's suggestion for a manual upload", () => {
    // paintYouTube: `${name} · Mars Yard rover run`, name falling back to 'Rover mission'.
    const template = /\$\('ytTitle'\)\.value = `\$\{name\}([^`]*)`;/.exec(RUN_STATION);
    const fallback = /const name = metaValue\(missionName\) \|\| '([^']*)';/.exec(RUN_STATION);
    expect(template?.[1]).toBe(MISSION_VIDEO_TITLE_SUFFIX);
    expect(missionVideoTitle(null)).toBe(`${fallback?.[1]}${MISSION_VIDEO_TITLE_SUFFIX}`);
  });

  it('leaves the video findable by the scheduled poll, through its description', () => {
    // An id with underscores, which the old file-name title needed special care for.
    const video = {
      title: missionVideoTitle(NAME),
      description: buildAutomaticUploadDescription('U3himA_pHY0Ragj_zGYag', 'curiosity'),
    };
    expect(missionFromVideo(video)).toEqual({ missionId: 'U3himA_pHY0Ragj_zGYag', yardId: 'curiosity' });
  });
});

/**
 * AB#444's acceptance criteria, as rules over the challenge content. The
 * first case is the one that guards the shipped content; the rest each break
 * one rule on an otherwise-valid fixture, so a rule that stopped firing would
 * be caught rather than silently passing the real content.
 */

import {
  challengesPractising,
  findCurriculumProblems,
  isFirstChallengeOfLevel,
} from '@/core/domain/services/curriculumOutcomes';
import { CHALLENGE_LEVELS, CHALLENGES } from '@/infrastructure/config/challenges';
import { CSTA_STANDARDS } from '@/infrastructure/config/curriculumStandards';
import type { Challenge, ChallengeId, ChallengeLevel, CstaStandard } from '@/core/domain/entities/Challenge';

const CATALOGUE: Record<string, CstaStandard> = {
  '1B-AP-10': { code: '1B-AP-10', gradeBand: 'Grades 3-5', text: 'Create programs.' },
};

function fixture(): { levels: ChallengeLevel[]; challenges: Record<ChallengeId, Challenge> } {
  const challenge = (id: ChallengeId, outcomeIds: string[]): Challenge => ({
    id,
    levelId: 1,
    title: id,
    summary: '',
    workspaceKind: 'blockly-sim',
    steps: [],
    outcomeIds,
  });
  return {
    levels: [
      {
        id: 1,
        title: 'Level 1',
        description: '',
        challengeIds: ['basic-movement', 'loop-structures'],
        testId: 'loop-structures',
        outcomes: [
          { id: 'a', text: 'You will be able to drive.', alignment: { csta: ['1B-AP-10'] } },
          { id: 'b', text: 'You will be able to loop.', alignment: { nasaJpl: 'Grid survey' } },
        ],
      },
    ],
    challenges: {
      'basic-movement': challenge('basic-movement', ['a']),
      'loop-structures': challenge('loop-structures', ['b']),
    } as Record<ChallengeId, Challenge>,
  };
}

describe('findCurriculumProblems', () => {
  it('finds nothing wrong with the shipped challenge content', () => {
    expect(findCurriculumProblems(CHALLENGE_LEVELS, CHALLENGES, CSTA_STANDARDS)).toEqual([]);
  });

  it('accepts the valid fixture the cases below each break', () => {
    const { levels, challenges } = fixture();
    expect(findCurriculumProblems(levels, challenges, CATALOGUE)).toEqual([]);
  });

  it('rejects a level with fewer than 2 outcomes', () => {
    const { levels, challenges } = fixture();
    levels[0].outcomes = levels[0].outcomes.slice(0, 1);
    challenges['loop-structures'].outcomeIds = ['a'];
    expect(findCurriculumProblems(levels, challenges, CATALOGUE)).toEqual([
      'Level 1 has 1 outcomes; it needs 2 to 4.',
    ]);
  });

  it('rejects a level with more than 4 outcomes', () => {
    const { levels, challenges } = fixture();
    const extra = ['c', 'd', 'e'].map((id) => ({
      id,
      text: 'You will be able to do more.',
      alignment: { csta: ['1B-AP-10'] },
    }));
    levels[0].outcomes.push(...extra);
    challenges['loop-structures'].outcomeIds = ['b', 'c', 'd', 'e'];
    expect(findCurriculumProblems(levels, challenges, CATALOGUE)).toEqual([
      'Level 1 has 5 outcomes; it needs 2 to 4.',
    ]);
  });

  it('rejects an outcome not phrased "You will be able to ..."', () => {
    const { levels, challenges } = fixture();
    levels[0].outcomes[0].text = 'Learners drive the rover.';
    expect(findCurriculumProblems(levels, challenges, CATALOGUE)).toEqual([
      'Outcome "a" does not start with "You will be able to".',
    ]);
  });

  it('rejects an outcome mapped only to CAPS', () => {
    const { levels, challenges } = fixture();
    levels[0].outcomes[0].alignment = { caps: 'Coding and Robotics', csta: [] };
    expect(findCurriculumProblems(levels, challenges, CATALOGUE)).toEqual([
      'Outcome "a" is not mapped to a CSTA standard or a NASA JPL challenge.',
    ]);
  });

  it('rejects a CSTA code the catalogue does not define', () => {
    const { levels, challenges } = fixture();
    levels[0].outcomes[0].alignment = { csta: ['9Z-XX-99'] };
    expect(findCurriculumProblems(levels, challenges, CATALOGUE)).toEqual([
      'Outcome "a" cites CSTA 9Z-XX-99, which is not in the standards catalogue.',
    ]);
  });

  it('rejects a challenge mapped to no outcome', () => {
    const { levels, challenges } = fixture();
    challenges['loop-structures'].outcomeIds = [];
    expect(findCurriculumProblems(levels, challenges, CATALOGUE)).toEqual([
      'Outcome "b" on Level 1 is not practised by any of its challenges.',
      'Challenge "loop-structures" is not mapped to any outcome.',
    ]);
  });

  it('rejects a challenge mapped to an outcome outside its own level', () => {
    const { levels, challenges } = fixture();
    challenges['basic-movement'].outcomeIds = ['a', 'l3-tune'];
    expect(findCurriculumProblems(levels, challenges, CATALOGUE)).toEqual([
      'Challenge "basic-movement" maps to "l3-tune", which is not an outcome of Level 1.',
    ]);
  });

  it('rejects an outcome id used twice', () => {
    const { levels, challenges } = fixture();
    levels[0].outcomes[1].id = 'a';
    expect(findCurriculumProblems(levels, challenges, CATALOGUE)).toContain(
      'Outcome id "a" is used more than once.',
    );
  });
});

describe('isFirstChallengeOfLevel', () => {
  it("is true only for the level's first challenge", () => {
    const level = CHALLENGE_LEVELS.find((l) => l.id === 2)!;
    expect(isFirstChallengeOfLevel(level, 'drive-to-target')).toBe(true);
    expect(isFirstChallengeOfLevel(level, 'basic-movement')).toBe(false);
    expect(isFirstChallengeOfLevel(level, 'loop-structures')).toBe(false);
  });
});

describe('challengesPractising', () => {
  it('returns the challenges naming the outcome, in level order', () => {
    const { levels, challenges } = fixture();
    challenges['basic-movement'].outcomeIds = ['a', 'b'];
    expect(challengesPractising(levels[0], 'b', challenges).map((c) => c.id)).toEqual([
      'basic-movement',
      'loop-structures',
    ]);
    expect(challengesPractising(levels[0], 'a', challenges).map((c) => c.id)).toEqual(['basic-movement']);
  });
});

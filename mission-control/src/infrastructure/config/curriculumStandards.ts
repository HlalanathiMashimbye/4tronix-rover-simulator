/**
 * The CSTA K-12 Computer Science Standards that level outcomes cite (AB#444),
 * with CSTA's own wording and grade band.
 *
 * The wording is here, not just the code, because a bare code was the reason
 * standards were once taken off the challenges: nobody could vouch for
 * "CSTA 2-AP-12" and no teacher reading it could check it. Shown in full, a
 * claim can be checked by the person it is made to.
 *
 * One entry per code, cited by any number of outcomes, so two levels citing
 * the same standard cannot describe it differently. A code an outcome cites
 * that is missing here fails curriculumOutcomes.test.ts.
 *
 * Source: CSTA K-12 Computer Science Standards (revised 2017),
 * https://csteachers.org/k12standards/
 */

import type { CstaStandard } from '@/core/domain/entities/Challenge';

const standards: CstaStandard[] = [
  {
    code: '1A-CS-01',
    gradeBand: 'Grades K-2',
    text: 'Select and operate appropriate software to perform a variety of tasks, and recognize that users have different needs and preferences for the technology they use.',
  },
  {
    code: '1B-NI-05',
    gradeBand: 'Grades 3-5',
    text: 'Discuss real-world cybersecurity problems and how personal information can be protected.',
  },
  {
    code: '1B-AP-10',
    gradeBand: 'Grades 3-5',
    text: 'Create programs that include sequences, events, loops, and conditionals.',
  },
  {
    code: '1B-AP-11',
    gradeBand: 'Grades 3-5',
    text: 'Decompose (break down) problems into smaller, manageable subproblems to facilitate the program development process.',
  },
  {
    code: '1B-AP-15',
    gradeBand: 'Grades 3-5',
    text: 'Test and debug (identify and fix errors) a program or algorithm to ensure it runs as intended.',
  },
  {
    code: '2-AP-17',
    gradeBand: 'Grades 6-8',
    text: 'Systematically test and refine programs using a range of test cases.',
  },
];

export const CSTA_STANDARDS: Record<string, CstaStandard> = Object.fromEntries(
  standards.map((s) => [s.code, s]),
);

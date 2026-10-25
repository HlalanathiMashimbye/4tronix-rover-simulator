/**
 * MissionState: the one answer to what a mission's status means.
 *
 * Every status is listed, so adding a seventh without deciding what it means
 * fails here rather than in whichever screen meets it first.
 */

import type { MissionStatus } from '@/core/domain/entities/Mission';
import { MissionState } from '@/core/domain/entities/MissionState';

const ALL: MissionStatus[] = ['queued', 'processing', 'completed', 'failed', 'not_completed', 'cancelled'];

function statusesWhere(rule: (state: MissionState) => boolean): MissionStatus[] {
  return ALL.filter((status) => rule(MissionState.of(status)));
}

it('splits every status into open or settled, never both', () => {
  expect(statusesWhere((s) => s.isOpen())).toEqual(['queued', 'processing']);
  expect(statusesWhere((s) => s.isSettled())).toEqual(['completed', 'failed', 'not_completed', 'cancelled']);
  expect([...MissionState.OPEN, ...MissionState.SETTLED].sort()).toEqual([...ALL].sort());
});

it('shows a learner Completed or Pending, never Failed', () => {
  expect(ALL.map((status) => MissionState.of(status).learnerFacing())).toEqual([
    'Pending', 'Pending', 'Completed', 'Pending', 'Pending', 'Pending',
  ]);
});

it('counts every settled mission but a completed one as stopped short', () => {
  expect(statusesWhere((s) => s.stoppedShort())).toEqual(['failed', 'not_completed', 'cancelled']);
});

it('lets an operator complete or cancel only an open mission', () => {
  expect(statusesWhere((s) => s.canComplete())).toEqual(['queued', 'processing']);
  expect(statusesWhere((s) => s.canCancel())).toEqual(['queued', 'processing']);
});

it('takes a video only on a completed run, and removes one from any settled run', () => {
  expect(statusesWhere((s) => s.canAttachVideo())).toEqual(['completed']);
  expect(statusesWhere((s) => s.canRemoveVideo())).toEqual(['completed', 'failed', 'not_completed', 'cancelled']);
});

it('takes a note on any run that happened, including one that did not finish, but not on a cancelled one', () => {
  expect(statusesWhere((s) => s.canTakeFeedback())).toEqual(['completed', 'failed', 'not_completed']);
});

it('logs another run only once the current one has settled', () => {
  expect(statusesWhere((s) => s.canLogAnotherRun())).toEqual(['completed', 'failed', 'not_completed', 'cancelled']);
});

it('compares by status', () => {
  expect(MissionState.of('queued').equals(MissionState.of('queued'))).toBe(true);
  expect(MissionState.of('queued').equals(MissionState.of('processing'))).toBe(false);
  expect(`${MissionState.of('not_completed')}`).toBe('not_completed');
});

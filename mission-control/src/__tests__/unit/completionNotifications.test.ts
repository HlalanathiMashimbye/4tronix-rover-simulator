/**
 * The rule the notification bell runs on.
 *
 * Worth its own test because both failure modes are silent: a dot that never
 * appears looks like "nothing happened", and a dot that never clears trains
 * people to ignore the bell entirely.
 */

import { selectUnread } from '@/lib/useCompletionNotifications';
import type { Mission } from '@/core/domain/entities/Mission';

const SEEN_AT = '2026-08-10T12:00:00.000Z';

function completion(id: string, completedAt: string, name?: string): Mission {
  return {
    id,
    name,
    completedAt,
    status: 'completed',
    yardId: 'curiosity',
    learnerRef: 'hash',
    sessionId: 'session',
    code: 'rover.stop()',
    submittedAt: '2026-08-10T10:00:00.000Z',
  } as unknown as Mission;
}

describe('selectUnread', () => {
  it('reports a mission completed after the learner last looked', () => {
    const unread = selectUnread(
      [completion('m1', '2026-08-10T12:30:00.000Z', 'Crater Survey')],
      SEEN_AT,
      []
    );

    expect(unread).toHaveLength(1);
    expect(unread[0].missionName).toBe('Crater Survey');
  });

  it('ignores completions the learner has already seen', () => {
    expect(
      selectUnread([completion('m1', '2026-08-10T11:59:59.000Z')], SEEN_AT, [])
    ).toEqual([]);
  });

  it('ignores a completion dismissed by hand', () => {
    expect(
      selectUnread([completion('m1', '2026-08-10T12:30:00.000Z')], SEEN_AT, ['m1'])
    ).toEqual([]);
  });

  it('reports nothing until the seen marker has loaded', () => {
    // Otherwise every page load flashes a dot for a frame while localStorage
    // is still being read, which is indistinguishable from a real alert.
    expect(
      selectUnread([completion('m1', '2026-08-10T12:30:00.000Z')], null, [])
    ).toEqual([]);
  });

  it('names an unnamed mission rather than rendering an empty line', () => {
    expect(
      selectUnread([completion('m1', '2026-08-10T12:30:00.000Z', '   ')], SEEN_AT, [])[0]
        .missionName
    ).toBe('Untitled mission');
  });

  it('skips a completion with no timestamp instead of treating it as new', () => {
    // A mission with no completedAt cannot be placed against the seen marker.
    // Counting it as unread would mean a dot that never clears, because
    // marking things seen moves a marker it can never fall behind.
    const noTimestamp = { ...completion('m1', ''), completedAt: undefined } as Mission;

    expect(selectUnread([noTimestamp], SEEN_AT, [])).toEqual([]);
  });
});

import {
  automatedReason,
  isHandledAutomatically,
  type OperatorAction,
} from '@/core/domain/services/consoleMode';

describe('what automation takes over', () => {
  it.each<OperatorAction>(['complete', 'attach-video'])(
    'hands %s to the platform in auto',
    (action) => {
      expect(isHandledAutomatically(action, 'auto')).toBe(true);
    },
  );

  it.each<OperatorAction>(['cancel', 'resolve'])(
    'leaves %s with the operator, because an exception needs a person',
    (action) => {
      expect(isHandledAutomatically(action, 'auto')).toBe(false);
    },
  );

  it('never takes feedback, which was never bookkeeping', () => {
    /**
     * The one part of this job that survives automation unchanged, and the
     * reason the console is being built around a mission rather than a queue.
     */
    expect(isHandledAutomatically('feedback', 'auto')).toBe(false);
  });

  it('leaves everything with the operator in manual', () => {
    const actions: OperatorAction[] = ['complete', 'cancel', 'attach-video', 'resolve', 'feedback'];

    expect(actions.every((a) => !isHandledAutomatically(a, 'manual'))).toBe(true);
  });

  it('explains itself rather than just greying out', () => {
    expect(automatedReason('complete')).toMatch(/rover reports/i);
    expect(automatedReason('attach-video')).toMatch(/MissionID/);
  });
});

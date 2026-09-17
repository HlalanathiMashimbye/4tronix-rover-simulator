import { finishedRuns, missionsTheRoverFinished } from '@/core/domain/services/roverReports';

const history = (...entries: unknown[]) => ({ current: null, pending: [], history: entries });

describe('finishedRuns', () => {
  it('reads each finished run and the mission it was sent for', () => {
    expect(
      finishedRuns(
        history(
          { id: 'i1', status: 'completed', params: { mission_id: 'm1', code: '...' } },
          { id: 'i2', status: 'error', params: { mission_id: 'm2' } },
        ),
      ),
    ).toEqual([
      { instructionId: 'i1', missionId: 'm1', outcome: 'completed' },
      { instructionId: 'i2', missionId: 'm2', outcome: 'error' },
    ]);
  });

  it('ignores what has not finished, and what names no mission', () => {
    expect(
      finishedRuns(
        history(
          { id: 'i1', status: 'pending', params: { mission_id: 'm1' } },
          { id: 'i2', status: 'running', params: { mission_id: 'm1' } },
          { id: 'i3', status: 'completed', params: { code: 'pasted by hand, no id' } },
          { id: 'i4', status: 'completed' },
        ),
      ),
    ).toEqual([]);
  });

  it('survives whatever came back over the network', () => {
    expect(finishedRuns(null)).toEqual([]);
    expect(finishedRuns({ error: 'Cannot connect to rover server' })).toEqual([]);
    expect(finishedRuns(history('nonsense', 42, { status: 'completed', params: { mission_id: 'm1' } }))).toEqual([]);
  });
});

describe('missionsTheRoverFinished', () => {
  const queue = [
    { id: 'm1', status: 'queued' as const },
    { id: 'm2', status: 'queued' as const },
    { id: 'done', status: 'completed' as const },
  ];

  it('completes an open mission the rover finished cleanly', () => {
    const finished = [{ instructionId: 'i1', missionId: 'm1', outcome: 'completed' as const }];
    expect(missionsTheRoverFinished(finished, queue, new Set())).toEqual(finished);
  });

  it('leaves a run the rover could not execute for the operator', () => {
    const finished = [{ instructionId: 'i1', missionId: 'm1', outcome: 'error' as const }];
    expect(missionsTheRoverFinished(finished, queue, new Set())).toEqual([]);
  });

  it('ignores missions that are not open in this queue', () => {
    const finished = [
      { instructionId: 'i1', missionId: 'done', outcome: 'completed' as const },
      { instructionId: 'i2', missionId: 'another-yards', outcome: 'completed' as const },
    ];
    expect(missionsTheRoverFinished(finished, queue, new Set())).toEqual([]);
  });

  it('does not act on the same report twice', () => {
    const finished = [{ instructionId: 'i1', missionId: 'm1', outcome: 'completed' as const }];
    expect(missionsTheRoverFinished(finished, queue, new Set(['i1']))).toEqual([]);
  });

  it('completes a mission once, however many times it ran', () => {
    const finished = [
      { instructionId: 'i1', missionId: 'm1', outcome: 'completed' as const },
      { instructionId: 'i2', missionId: 'm1', outcome: 'completed' as const },
    ];
    expect(missionsTheRoverFinished(finished, queue, new Set())).toHaveLength(1);
  });
});

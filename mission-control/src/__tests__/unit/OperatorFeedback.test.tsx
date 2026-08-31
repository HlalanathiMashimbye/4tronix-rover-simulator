/**
 * @jest-environment jsdom
 */

/**
 * The learner-facing half of the feedback loop.
 *
 * An operator writing a note is only half the story: the loop closes when the
 * child reads it. These assert the reading end, including the case the design
 * exists for - a run that produced no video, which the run carousel drops and
 * which is exactly when "try 90 degrees" needs to get through.
 */

import { render, screen } from '@testing-library/react';

import { OperatorFeedback } from '@/components/mission/OperatorFeedback';
import type { MissionRun } from '@/core/domain/entities/MissionRun';

function run(over: Partial<MissionRun> = {}): MissionRun {
  return {
    yardId: 'curiosity',
    status: 'completed',
    ...over,
  } as MissionRun;
}

describe('a note from the yard', () => {
  it('holds its place when no operator has written anything', () => {
    /**
     * It used to render null. The panel then appeared out of nowhere and
     * shoved the stats up the moment an operator wrote something, and while it
     * was absent the column ended short of the code panel beside it. Saying so
     * also tells a child that a note is a thing that can arrive.
     */
    render(<OperatorFeedback runs={[run(), run({ yardId: 'other' })]} />);

    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it('treats feedback that is only whitespace as nothing written', () => {
    render(<OperatorFeedback runs={[run({ feedback: '   ' })]} />);

    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it('drops the empty state once a note arrives', () => {
    render(<OperatorFeedback runs={[run({ feedback: 'Good job!' })]} />);

    expect(screen.queryByText(/no notes yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/good job!/i)).toBeInTheDocument();
  });

  it('shows the note and who wrote it', () => {
    render(
      <OperatorFeedback
        runs={[run({ feedback: 'Nice square! Try 90 degrees to close it exactly.', feedbackBy: 'kamo@uct.ac.za' })]}
      />,
    );

    expect(screen.getByText(/try 90 degrees/i)).toBeInTheDocument();
    expect(screen.getByText(/kamo@uct.ac.za/)).toBeInTheDocument();
  });

  it('shows feedback on a run that produced no video', () => {
    /**
     * The reason this component reads every run rather than the carousel's
     * options: buildRunOptions drops runs without a video, which includes the
     * ones that did not work. A child whose mission failed sees Pending, never
     * Failed, so an operator's sentence is the only way they learn what to
     * change.
     */
    render(
      <OperatorFeedback
        runs={[run({ status: 'failed', youtubeUrl: undefined, feedback: 'The turn was too small.' })]}
      />,
    );

    expect(screen.getByText(/the turn was too small/i)).toBeInTheDocument();
  });

  it('shows the newest note when several yards have written', () => {
    /**
     * One line, one note: the height this used to take as a growing list was
     * height the player did not get. The newest wins because the older ones
     * are earlier advice about the same code.
     */
    render(
      <OperatorFeedback
        runs={[
          run({ feedback: 'Older advice.', feedbackAt: '2026-08-01T10:00:00Z' }),
          run({ yardId: 'second-yard', feedback: 'Try 90 degrees.', feedbackAt: '2026-08-30T10:00:00Z' }),
        ]}
      />,
    );

    expect(screen.getByText(/try 90 degrees/i)).toBeInTheDocument();
    expect(screen.queryByText(/older advice/i)).not.toBeInTheDocument();
  });

  it('counts the notes it is not showing rather than hiding them silently', () => {
    render(
      <OperatorFeedback
        runs={[
          run({ feedback: 'Older advice.', feedbackAt: '2026-08-01T10:00:00Z' }),
          run({ yardId: 'b', feedback: 'Try 90 degrees.', feedbackAt: '2026-08-30T10:00:00Z' }),
          run({ yardId: 'c', feedback: 'Nice one.', feedbackAt: '2026-08-20T10:00:00Z' }),
        ]}
      />,
    );

    expect(screen.getByText(/\+2/)).toBeInTheDocument();
  });

  it('says nothing about other notes when there is only one', () => {
    render(<OperatorFeedback runs={[run({ feedback: 'Good job!', feedbackBy: 'kamo@uct.ac.za' })]} />);

    expect(screen.getByText('kamo@uct.ac.za')).toBeInTheDocument();
  });
});

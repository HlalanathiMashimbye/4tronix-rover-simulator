/**
 * @jest-environment jsdom
 */

/**
 * The feedback bank's suggestion comes from the operator preview's own
 * simulation of the mission (AB#471, AB#466): MissionDetail simulates once
 * and hands the bank what that run hits.
 */

import { render, screen, within } from '@testing-library/react';

jest.mock('@/components/operator/MissionPreview', () => ({ MissionPreview: () => null }));
jest.mock('@/components/operator/MissionRuns', () => ({ MissionRuns: () => null }));
jest.mock('@/hooks/useYardLayout', () => {
  const { YARD } = jest.requireActual('@/lib/rover-physics');
  return { useYardLayout: () => ({ yardId: 'curiosity', layout: YARD }) };
});

import { MissionDetail } from '@/components/operator/MissionDetail';

function mount(code: string) {
  render(
    <MissionDetail
      mission={{ id: 'm1', name: 'Rock Lover', code, status: 'completed' }}
      runs={[]}
      yards={[]}
      yardId="curiosity"
      isAdmin={false}
      mode="manual"
      onResult={jest.fn()}
    />,
  );
}

it('suggests the crash group, naming the wall, for a mission that drives into it', () => {
  // 20 seconds at full speed is 3m: far past the front wall from the start mark.
  mount('rover.forward(100)\ntime.sleep(20)\nrover.stop()');

  const picker = screen.getByRole('combobox', { name: 'Ready-written notes' });
  expect(within(picker).getAllByRole('group')[0]).toHaveAttribute('label', 'Hit something (suggested)');
  expect(screen.getByText(/The preview hits the wall/)).toBeInTheDocument();
});

it('suggests the success group for a short mission that hits nothing', () => {
  mount('rover.forward(60)\ntime.sleep(1)\nrover.stop()');

  const picker = screen.getByRole('combobox', { name: 'Ready-written notes' });
  expect(within(picker).getAllByRole('group')[0]).toHaveAttribute('label', 'Went well (suggested)');
  expect(screen.queryByText(/The preview hits/)).not.toBeInTheDocument();
});

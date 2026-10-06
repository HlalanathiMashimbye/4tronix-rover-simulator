/**
 * @jest-environment jsdom
 */

/**
 * The Drive / Blocks / Python switch's thumb (6 Oct 2026): where a drag puts
 * it, how it stretches as it moves, and which label it lights.
 *
 * Dragging itself is a pointer gesture jsdom cannot perform; it was tried in
 * a browser. The arithmetic the drag runs on, and what the thumb lights, are
 * here.
 */

import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Blocks, Code2, Gamepad2 } from 'lucide-react';

import { ModeSwitch, thumbAt, thumbStretch, type ModeOption } from '@/components/mission/ModeSwitch';

describe('dragging the thumb', () => {
  // A 306px track: 3px padding each side, three 100px segments.
  it('centres it under the finger', () => {
    expect(thumbAt(3 + 150, 306, 3)).toBeCloseTo(1);
    expect(thumbAt(3 + 100, 306, 3)).toBeCloseTo(0.5);
  });

  it('never past either end', () => {
    expect(thumbAt(0, 306, 3)).toBe(0);
    expect(thumbAt(500, 306, 3)).toBe(2);
  });
});

describe('the stretch', () => {
  it('is round at rest and longer the faster it goes, up to a limit', () => {
    expect(thumbStretch(0)).toBe(1);
    expect(thumbStretch(2)).toBeGreaterThan(1);
    expect(thumbStretch(4)).toBeGreaterThan(thumbStretch(2));
    expect(thumbStretch(-4)).toBe(thumbStretch(4));
    expect(thumbStretch(1000)).toBeLessThanOrEqual(1.3);
  });
});

describe('the labels', () => {
  type Mode = 'manual' | 'blockly' | 'code';
  const options: ModeOption<Mode>[] = [
    { value: 'manual', label: 'Drive', Icon: Gamepad2 },
    { value: 'blockly', label: 'Blocks', Icon: Blocks },
    { value: 'code', label: 'Python', Icon: Code2 },
  ];
  function Switch() {
    const [mode, setMode] = useState<Mode>('blockly');
    return <ModeSwitch options={options} value={mode} onChange={setMode} label="How to program your rover" />;
  }
  /** How lit a label is: its light copy's opacity, 0 to 1. */
  const lit = (name: string) =>
    Number((screen.getByRole('button', { name }).querySelector('span[aria-hidden]') as HTMLElement).style.opacity);

  it('lights the one the thumb is under, and only that one', () => {
    render(<Switch />);
    expect(lit('Blocks')).toBe(1);
    expect(lit('Drive')).toBe(0);
    expect(lit('Python')).toBe(0);
  });

  it('moves the light with the thumb', async () => {
    render(<Switch />);
    fireEvent.click(screen.getByRole('button', { name: 'Python' }));
    expect(screen.getByRole('button', { name: 'Python' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(lit('Python')).toBeCloseTo(1, 1));
    expect(lit('Blocks')).toBeCloseTo(0, 1);
  });
});

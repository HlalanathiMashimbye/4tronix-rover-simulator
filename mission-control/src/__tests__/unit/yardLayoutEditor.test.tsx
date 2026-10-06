/**
 * @jest-environment jsdom
 */

/**
 * A yard's layout in the browser (AB#468): what every simulator gets, and the
 * settings form an admin edits it with. yardLayoutConfig.test.ts has the
 * server half.
 */

jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

import { forgetYardLayouts, useYardLayout } from '@/hooks/useYardLayout';
import { YardLayoutEditor } from '@/components/operator/YardLayoutEditor';
import { YARD, type Yard as YardLayout } from '@/lib/rover-physics';
import type { Yard } from '@/core/domain/entities/Yard';

const DURBAN_LAYOUT: YardLayout = {
  widthCm: 300,
  depthCm: 200,
  start: { x: 150, y: 100, facingDegrees: 0 },
  rocks: [{ name: 'D1', x: 40, y: 40, widthCm: 10, depthCm: 10 }],
  zones: [],
};

const CURIOSITY: Yard = { id: 'curiosity', formerIds: ['uct-rover-1'], name: 'Cape Town Science Centre', area: 'Observatory', city: 'Cape Town', active: true };

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => null) as unknown as HTMLCanvasElement['getContext'];
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('what a simulator gets', () => {
  beforeEach(() => forgetYardLayouts());

  it('the measured yard at once, then the yard\'s own, asked for once however many ask', async () => {
    let answer!: (value: unknown) => void;
    const fetch = jest.fn(() => new Promise((resolve) => (answer = resolve)));
    global.fetch = fetch as unknown as typeof global.fetch;

    const first = renderHook(() => useYardLayout('durban'));
    const second = renderHook(() => useYardLayout('durban'));
    expect(first.result.current.layout).toBe(YARD);
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => answer({ ok: true, json: async () => ({ yardId: 'durban', layout: DURBAN_LAYOUT }) }));
    expect(first.result.current.layout).toEqual(DURBAN_LAYOUT);
    // The same object, so a simulation and its drawing cannot disagree.
    expect(second.result.current.layout).toBe(first.result.current.layout);
  });
});

describe('the settings form', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const sent = () =>
    (global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/operator/yards').map(([, init]) => JSON.parse(init.body));

  it('saves a change on its own, a moment after the typing stops, as the whole layout', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) })) as unknown as typeof global.fetch;
    render(<YardLayoutEditor initialYards={[CURIOSITY]} />);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Rock R4, across' }), { target: { value: '150' } });
    expect(sent()).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(sent()).toHaveLength(1);
    expect(sent()[0].id).toBe('curiosity');
    expect(sent()[0].layout.rocks.find((r: { name: string }) => r.name === 'R4').x).toBe(150);
    expect(sent()[0].layout.zones).toEqual(YARD.zones);
    expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
  });

  it('marks a value that does not check out, says why, and sends nothing', async () => {
    global.fetch = jest.fn() as unknown as typeof global.fetch;
    render(<YardLayoutEditor initialYards={[CURIOSITY]} />);

    const across = screen.getByRole('spinbutton', { name: 'Rock R4, across' });
    fireEvent.change(across, { target: { value: '900' } });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(across).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Rock R4 is past the east wall');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('removes a zone from what is saved', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) })) as unknown as typeof global.fetch;
    render(<YardLayoutEditor initialYards={[CURIOSITY]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove zone 1' }));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(sent()[0].layout.zones).toHaveLength((YARD.zones ?? []).length - 1);
  });
});

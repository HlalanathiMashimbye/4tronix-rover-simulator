/**
 * @jest-environment jsdom
 */

/**
 * Typing on a phone (AB#455).
 *
 * iOS Safari, and Chrome on Android by default, open the keyboard over the
 * page without resizing it, so the bottom of the workspace sat behind the
 * keys and the docked simulator still took 30% of what was left. These pin
 * how the keyboard is recognised and what the layout does about it.
 */

import { render, screen, act, renderHook } from '@testing-library/react';
import { useOnScreenKeyboard } from '@/hooks/useIsPhoneLayout';
import { PhoneWorkspace } from '@/components/mission/PhoneWorkspace';

jest.mock('next/link', () => ({ __esModule: true, default: (props: Record<string, unknown>) => <a {...props} /> }));

/** A visualViewport we can resize, as the keyboard does to the real one. */
function fakeViewport({ innerHeight = 667, height = 667, scale = 1 } = {}) {
  const listeners: (() => void)[] = [];
  const viewport = {
    height,
    scale,
    offsetTop: 0,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: () => {},
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: innerHeight });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 375 });
  return {
    viewport,
    fire: () => act(() => listeners.forEach((l) => l())),
  };
}

describe('recognising the keyboard', () => {
  it('opens when the visible part of the page drops by a keyboard', () => {
    const { viewport, fire } = fakeViewport();
    const { result } = renderHook(() => useOnScreenKeyboard());
    expect(result.current).toEqual({ open: false, inset: 0 });

    viewport.height = 377;
    fire();
    expect(result.current).toEqual({ open: true, inset: 290 });

    viewport.height = 667;
    fire();
    expect(result.current).toEqual({ open: false, inset: 0 });
  });

  it('ignores the address bar sliding away, which is far smaller', () => {
    const { viewport, fire } = fakeViewport();
    const { result } = renderHook(() => useOnScreenKeyboard());
    viewport.height = 600;
    fire();
    expect(result.current.open).toBe(false);
  });

  it('is not fooled by pinch-zoom, which also shrinks the visible area', () => {
    const { viewport, fire } = fakeViewport();
    const { result } = renderHook(() => useOnScreenKeyboard());
    viewport.height = 300;
    viewport.scale = 2;
    fire();
    expect(result.current.open).toBe(false);
  });

  it('gives up nothing where the browser already shrank the page for it', () => {
    const { viewport, fire } = fakeViewport();
    const { result } = renderHook(() => useOnScreenKeyboard());
    viewport.height = 377;
    window.innerHeight = 377;
    fire();
    expect(result.current).toEqual({ open: true, inset: 0 });
  });
});

describe('the docked layout while typing', () => {
  function renderTyping(runningText: string | null) {
    const { viewport, fire } = fakeViewport();
    render(
      <PhoneWorkspace
        editor={<div />}
        simulator={<div data-testid="simulator" />}
        submitBar={<div />}
        onRun={() => {}}
        watched={false}
        sendReady={false}
        sendOpen={false}
        onSendOpenChange={() => {}}
        runningText={runningText}
      />,
    );
    viewport.height = 377;
    fire();
    return { viewport, fire };
  }

  it('moves the page up out from behind the keys, and back when it closes', () => {
    const { viewport, fire } = renderTyping(null);
    expect(document.documentElement.style.getPropertyValue('--app-bottom-chrome')).toBe('290px');

    viewport.height = 667;
    fire();
    expect(document.documentElement.style.getPropertyValue('--app-bottom-chrome')).toBe('');
  });

  it('keeps the simulator playing, and shows the line it is on', () => {
    renderTyping('rover.forward(60)');
    expect(screen.getByTestId('simulator')).toBeInTheDocument();
    expect(screen.getByText('rover.forward(60)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /simulator/i })).not.toBeInTheDocument();
  });
});

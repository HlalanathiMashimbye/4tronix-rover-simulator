/**
 * @jest-environment jsdom
 */

/**
 * The "now" tag beside the running block stays inside the canvas.
 *
 * In the operator console's narrow panel a wide Steer Left block pushed the
 * tag past the right edge, half of it cut away (seen on Happy Crater
 * Collector, 3 Oct 2026).
 */

import { renderHook, act } from '@testing-library/react';
import { useRunningBlockMarks } from '@/components/mission/runningBlockMarks';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function setup(blockRight: number) {
  const host = document.createElement('div');
  host.getBoundingClientRect = () => rect(0, 0, 300, 400);
  const path = document.createElement('div');
  path.className = 'blocklyPath';
  path.getBoundingClientRect = () => rect(blockRight - 200, 100, 200, 40);
  const root = document.createElement('div');
  root.appendChild(path);
  const block = { id: 'b1', addClass: () => {}, removeClass: () => {}, getSvgRoot: () => root };
  const workspace = { getBlockById: () => block, addChangeListener: () => {}, removeChangeListener: () => {} };
  // Built once, as the components that use the hook build them (useRef):
  // fresh objects each render would re-run its effect on every render.
  const workspaceRef = { current: workspace };
  const hostRef = { current: host };
  const highlight = { blockIds: ['b1'] };
  return renderHook(() => useRunningBlockMarks({ workspaceRef, hostRef, highlight, ready: true }));
}

it('sits just right of a block that leaves room', () => {
  const { result } = setup(150);
  act(() => {});
  expect(result.current?.step?.left).toBe(156);
});

it('is pulled back inside the canvas when the block reaches its edge', () => {
  const { result } = setup(290);
  act(() => {});
  const left = result.current!.step!.left;
  expect(left).toBeLessThan(290);
  expect(left + 60).toBeLessThanOrEqual(300);
});

/**
 * Blockly on a phone (AB#455).
 *
 * The phone options are the whole Blockly half of the fix, and nothing else
 * would notice them reverting: the editor still loads either way. So the
 * differences that matter are pinned here.
 */

import { blocklyInjectOptions, DESKTOP_TOOLBOX, PHONE_TOOLBOX } from '@/components/mission/blocklyInjectOptions';
import { ROVER_TOOLBOX } from '@/lib/roverBlockly';

describe('on a phone', () => {
  const phone = blocklyInjectOptions(true) as Record<string, unknown> & {
    zoom: Record<string, unknown>;
  };

  it('puts the categories in a strip along the bottom', () => {
    expect(phone.horizontalLayout).toBe(true);
    expect(phone.toolboxPosition).toBe('end');
  });

  it('zooms with two fingers, with no buttons over the blocks', () => {
    expect(phone.zoom.controls).toBe(false);
    expect(phone.zoom.pinch).toBe(true);
  });

  it('has a bin to drag blocks into, the way to delete one that a child will find', () => {
    expect(phone.trashcan).toBe(true);
  });

  it('uses the icon toolbox', () => {
    expect(phone.toolbox).toBe(PHONE_TOOLBOX);
  });
});

describe('everywhere else', () => {
  it('keeps the left-hand column, the zoom buttons and the trashcan', () => {
    const desktop = blocklyInjectOptions(false) as Record<string, unknown> & { zoom: Record<string, unknown> };
    expect(desktop.horizontalLayout).toBeUndefined();
    expect(desktop.zoom.controls).toBe(true);
    expect(desktop.trashcan).toBe(true);
    expect(desktop.toolbox).toBe(DESKTOP_TOOLBOX);
  });
});

describe.each([
  ['phone', PHONE_TOOLBOX],
  ['desktop', DESKTOP_TOOLBOX],
])('the %s icon toolbox', (_, toolbox) => {
  it('gives every category an icon id, so none shows as a bare label', () => {
    for (const category of toolbox.contents as { toolboxitemid?: string }[]) {
      expect(category.toolboxitemid).toMatch(/^roverCat-/);
    }
  });

  it('names categories in words, with the icon as the only picture', () => {
    for (const category of toolbox.contents as { name: string }[]) {
      expect(category.name).toMatch(/^[A-Za-z]+$/);
    }
  });

  it('offers exactly the same blocks, so a program is the same program everywhere', () => {
    const blocks = (box: typeof ROVER_TOOLBOX) =>
      box.contents.map((category) => JSON.stringify((category as { contents: unknown }).contents));
    expect(blocks(toolbox)).toEqual(blocks(ROVER_TOOLBOX));
  });
});

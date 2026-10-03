/**
 * Blockly on a phone (AB#455).
 *
 * The phone options are the whole Blockly half of the fix, and nothing else
 * would notice them reverting: the editor still loads either way. So the
 * differences that matter are pinned here.
 */

import { blocklyInjectOptions, PHONE_TOOLBOX } from '@/components/mission/blocklyInjectOptions';
import { ROVER_TOOLBOX } from '@/lib/roverBlockly';

describe('on a phone', () => {
  const phone = blocklyInjectOptions(true) as Record<string, unknown> & {
    zoom: Record<string, unknown>;
  };

  it('puts the categories in a strip along the bottom', () => {
    expect(phone.horizontalLayout).toBe(true);
    expect(phone.toolboxPosition).toBe('end');
  });

  it('zooms with two fingers, with no buttons or trashcan over the blocks', () => {
    expect(phone.zoom.controls).toBe(false);
    expect(phone.zoom.pinch).toBe(true);
    expect(phone.trashcan).toBe(false);
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
    expect(desktop.toolbox).toBe(ROVER_TOOLBOX);
  });
});

describe('the icon toolbox', () => {
  it('gives every category an icon id, so none shows as a bare label', () => {
    for (const category of PHONE_TOOLBOX.contents as { toolboxitemid?: string }[]) {
      expect(category.toolboxitemid).toMatch(/^roverCat-/);
    }
  });

  it('offers exactly the same blocks, so a phone program is the same program', () => {
    const blocks = (toolbox: typeof ROVER_TOOLBOX) =>
      toolbox.contents.map((category) => JSON.stringify((category as { contents: unknown }).contents));
    expect(blocks(PHONE_TOOLBOX)).toEqual(blocks(ROVER_TOOLBOX));
  });
});

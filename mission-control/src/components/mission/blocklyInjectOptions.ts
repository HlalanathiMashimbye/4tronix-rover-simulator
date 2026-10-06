import { ROVER_MAX_INSTANCES, ROVER_TOOLBOX } from '@/lib/roverBlockly';

/**
 * What the block editor is injected with, on a phone and everywhere else.
 *
 * A function rather than an object literal inside BlocklyEditor so the two
 * can be compared in a test without loading Blockly: the phone options are
 * the whole of AB#455's Blockly fix, and nothing else would notice them
 * quietly reverting to the desktop ones.
 */
export function blocklyInjectOptions(phone: boolean) {
  return {
    toolbox: phone ? PHONE_TOOLBOX : DESKTOP_TOOLBOX,
    // The actual cap - Blockly reads maxInstances only from here, never
    // from a toolbox content entry, so this must live on inject() itself.
    maxInstances: ROVER_MAX_INSTANCES,
    renderer: 'zelos',
    grid: {
      spacing: 20,
      length: 3,
      colour: '#ccc',
      snap: true,
    },
    ...(phone ? PHONE : DESKTOP),
  };
}

const DESKTOP = {
  zoom: {
    controls: true,
    wheel: true,
    startScale: 1.0,
    maxScale: 2.5,
    minScale: 0.35,
    scaleSpeed: 1.15,
  },
  trashcan: true,
  move: { drag: true, scrollbars: true, wheel: true },
};

/**
 * A phone, measured at 375px: the category column took a third of a 321px
 * canvas, blocks ran off the right edge under the zoom buttons, and the
 * trashcan sat on top of the program.
 *
 * - Categories go to a strip along the BOTTOM, where the thumb already is,
 *   and the flyout opens upward over the canvas instead of eating its width.
 * - No zoom buttons: two fingers zoom, as on every map and photo a child has
 *   used, and the buttons were the thing blocks hid under.
 * - No trashcan: dragging a block back onto the category strip deletes it,
 *   which Blockly does by default, so the can only cost canvas.
 * - Smaller to start, so a typical program fits the width without zooming.
 */
const PHONE = {
  horizontalLayout: true,
  toolboxPosition: 'end',
  zoom: {
    controls: false,
    wheel: false,
    pinch: true,
    startScale: 0.75,
    maxScale: 2,
    minScale: 0.35,
    scaleSpeed: 1.15,
  },
  trashcan: false,
  move: { drag: true, scrollbars: true, wheel: false },
};

/**
 * Each category's icon and names, by its name in ROVER_TOOLBOX.
 *
 * Icons because five worded chips did not fit a 320px phone strip, and a
 * child who cannot yet read "Movement" can still find the arrows. Each keeps
 * a label beside or under it: a bulb or a camera on its own is a guess. The
 * icon is drawn in the category's colour by globals.css (#roverCat-*), so
 * the column or strip still matches the blocks it opens, and it replaces the
 * satellite emoji Uplink wore on a laptop, which rendered differently on
 * every machine and was the one picture in a list of words.
 */
const CATEGORIES: Record<string, { name: string; phoneName: string; icon: string }> = {
  '🛰️ Uplink': { name: 'Uplink', phoneName: 'Uplink', icon: 'uplink' },
  Movement: { name: 'Movement', phoneName: 'Move', icon: 'move' },
  Mast: { name: 'Mast', phoneName: 'Mast', icon: 'mast' },
  Lights: { name: 'Lights', phoneName: 'Lights', icon: 'lights' },
  Control: { name: 'Control', phoneName: 'Control', icon: 'control' },
};

/**
 * The shared toolbox with icons, and short names for the phone strip.
 *
 * Derived here rather than written into ROVER_TOOLBOX, which the yard's
 * offline editor is built from (see src/lib/README.md): the yard has its own
 * look and no use for these. Blocks are untouched, so a program built here is
 * the same program everywhere.
 */
function withIcons(phone: boolean) {
  return {
    ...ROVER_TOOLBOX,
    contents: ROVER_TOOLBOX.contents.map((category) => {
      const look = CATEGORIES[category.name];
      if (!look) return category;
      return {
        ...category,
        name: phone ? look.phoneName : look.name,
        // An id rather than cssConfig.icon: Blockly 12 ignores category icon
        // classes in a horizontal toolbox (createIconDom_ checks isHorizontal),
        // so globals.css draws the icon on the empty icon span by this id, the
        // same way in both layouts.
        toolboxitemid: `roverCat-${look.icon}`,
      };
    }),
  };
}

export const PHONE_TOOLBOX = withIcons(true);
export const DESKTOP_TOOLBOX = withIcons(false);

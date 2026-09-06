/**
 * The clipboard payload both Copy buttons produce.
 *
 * The format is a contract with the yard's run station, which parses the two
 * header lines to fill the mission name, the mission id and the run id. The
 * run id is the recording's filename, so a header this side gets wrong is a
 * video on the satellite that cannot be matched to a mission.
 */

import { missionClipboardText } from '@/lib/missionClipboard';

const CODE = 'rover.forward(40)\ntime.sleep(0.8)\nrover.stop()';

describe('the mission clipboard payload', () => {
  it('puts the identity above the code as comments', () => {
    expect(missionClipboardText({ id: 'm1', name: 'Rock Lover', code: CODE })).toBe(
      `# Mission: Rock Lover\n# MissionID: m1\n\n${CODE}`,
    );
  });

  it('is still runnable Python: everything it adds is a comment', () => {
    const text = missionClipboardText({ id: 'm1', name: 'Rock Lover', code: CODE });
    const added = text.split('\n').slice(0, -CODE.split('\n').length);
    for (const line of added) {
      expect(line === '' || line.startsWith('#')).toBe(true);
    }
    // And the code itself arrives byte for byte, not reindented or trimmed.
    expect(text.endsWith(CODE)).toBe(true);
  });

  it('flattens a name spanning lines, which would otherwise end the comment', () => {
    // The rest of such a name would land in the code as a syntax error.
    const text = missionClipboardText({ id: 'm1', name: 'Rock\nLover\tII', code: CODE });
    expect(text).toBe(`# Mission: Rock Lover II\n# MissionID: m1\n\n${CODE}`);
    expect(text.split('\n')[0]).toBe('# Mission: Rock Lover II');
  });

  it('still carries the id when a mission has no name', () => {
    // The id is what the run station actually needs; the name is a courtesy.
    for (const name of [undefined, null, '', '   ']) {
      expect(missionClipboardText({ id: 'm1', name, code: CODE }))
        .toBe(`# MissionID: m1\n\n${CODE}`);
    }
  });

  it('flags a block-built mission without carrying the workspace', () => {
    // The yard shows a "Run Blockly" label from this. The workspace itself is
    // kilobytes of JSON and would wreck a payload meant to stay readable.
    const text = missionClipboardText({
      id: 'm1', name: 'Rock Lover', code: CODE,
      blocklyState: '{"blocks":{"languageVersion":0,"blocks":[]}}',
    });

    expect(text).toBe(`# Mission: Rock Lover\n# MissionID: m1\n# Blocks: yes\n\n${CODE}`);
    expect(text).not.toContain('languageVersion');
  });

  it('says nothing about blocks for a mission typed in Python', () => {
    for (const blocklyState of [undefined, null, '']) {
      expect(missionClipboardText({ id: 'm1', name: 'Rock Lover', code: CODE, blocklyState }))
        .not.toContain('Blocks');
    }
  });
});

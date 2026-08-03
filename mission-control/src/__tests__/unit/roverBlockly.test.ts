/**
 * Unit tests for the shared rover Blockly generators (AB#254).
 *
 * Validates that workspaceToPython emits the same low-level rover program the
 * yard runs, and that workspaceToCommands maps movement blocks for the local
 * simulator. Uses lightweight mock blocks so no browser/Blockly is required.
 */

import { mergeUplinkHats, workspaceToPython, workspaceToCommands } from '@/components/mission/roverBlockly';

type Fields = Record<string, string | number>;

interface MockBlock {
  type: string;
  _next: MockBlock | null;
  getFieldValue(name: string): string | number | undefined;
  getInputTargetBlock(name: string): MockBlock | null;
  getNextBlock(): MockBlock | null;
}

function block(type: string, fields: Fields = {}, inputs: Record<string, MockBlock> = {}): MockBlock {
  const b: MockBlock = {
    type,
    _next: null,
    getFieldValue: (n) => fields[n],
    getInputTargetBlock: (n) => inputs[n] ?? null,
    getNextBlock: () => b._next,
  };
  return b;
}

/** Link blocks into a next-chain and return the head. */
function chain(...blocks: MockBlock[]): MockBlock {
  for (let i = 0; i < blocks.length - 1; i++) blocks[i]._next = blocks[i + 1];
  return blocks[0];
}

function workspace(...top: MockBlock[]): { getTopBlocks: () => MockBlock[] } {
  return { getTopBlocks: () => top };
}

function onReceive(body: MockBlock): MockBlock {
  return block('rover_on_receive', {}, { DO: body });
}

/**
 * A richer mock than MockBlock above: mergeUplinkHats actually rewires
 * connections and disposes blocks, where the codegen tests only ever walk a
 * read-only chain. previousConnection/nextConnection model just enough of
 * Blockly's real connection objects (an `_owner` back to the block, and a
 * `connect` that records the link) for mergeUplinkHats's reconnect logic to
 * exercise the same call shape it uses against a real workspace.
 */
interface MergeConnection {
  _owner: MergeMockBlock;
  connect?: (other: MergeConnection) => void;
}

interface MergeMockBlock {
  type: string;
  _next: MergeMockBlock | null;
  _body: MergeMockBlock | null;
  _disposed: boolean;
  previousConnection: MergeConnection | null;
  nextConnection: MergeConnection | null;
  getFieldValue: () => undefined;
  getInputTargetBlock: (name: string) => MergeMockBlock | null;
  getNextBlock: () => MergeMockBlock | null;
  getInput: (name: string) => { connection: MergeConnection } | null;
  dispose: () => void;
}

function mergeBlock(type: string): MergeMockBlock {
  const merge: MergeMockBlock = {
    type,
    _next: null,
    _body: null,
    _disposed: false,
    previousConnection: null,
    nextConnection: null,
    getFieldValue: () => undefined,
    getInputTargetBlock: (name) => (name === 'DO' ? merge._body : null),
    getNextBlock: () => merge._next,
    getInput: (name) => {
      if (name !== 'DO') return null;
      return {
        connection: {
          _owner: merge,
          connect(other) {
            merge._body = other?._owner ?? null;
          },
        },
      };
    },
    dispose: () => {
      merge._disposed = true;
    },
  };

  merge.previousConnection = { _owner: merge };
  merge.nextConnection = {
    _owner: merge,
    connect(other) {
      merge._next = other?._owner ?? null;
    },
  };

  return merge;
}

function mergeWorkspace(...top: MergeMockBlock[]): { getTopBlocks: () => MergeMockBlock[] } {
  return { getTopBlocks: () => top };
}

describe('workspaceToPython', () => {
  it('emits the rover servo + forward + sleep + stop sequence', () => {
    const ws = workspace(onReceive(block('rover_forward', { TIME: 2 })));
    expect(workspaceToPython(ws)).toBe(
      [
        'rover.setServo(9, 0)',
        'rover.setServo(11, 0)',
        'rover.setServo(13, 0)',
        'rover.setServo(15, 0)',
        'rover.forward(60)',
        'time.sleep(2)',
        'rover.stop()',
      ].join('\n') + '\n'
    );
  });

  it('indents a repeat loop body with range()', () => {
    const ws = workspace(
      onReceive(block('rover_repeat', { TIMES: 3 }, { DO: block('rover_stop') }))
    );
    expect(workspaceToPython(ws)).toBe(
      ['for _ in range(3):', '    rover.stop()'].join('\n') + '\n'
    );
  });

  it('emits mast/LED/photo actions', () => {
    const ws = workspace(
      onReceive(
        chain(
          block('rover_leds_all', { COLOUR: '255, 0, 0' }),
          block('rover_take_photo'),
          block('rover_read_distance')
        )
      )
    );
    expect(workspaceToPython(ws)).toBe(
      [
        'rover.setColor(rover.fromRGB(255, 0, 0))',
        'rover.show()',
        'take_photo()',
        "print('Distance: ' + str(round(rover.getDistance())) + ' cm')",
      ].join('\n') + '\n'
    );
  });

  it('only generates code inside an On uplink hat (loose blocks ignored)', () => {
    const ws = workspace(block('rover_forward', { TIME: 1 })); // not inside on_receive
    expect(workspaceToPython(ws)).toBe('\n');
  });
});

describe('mergeUplinkHats', () => {
  it('merges extra uplink hats into the first one in canvas order', () => {
    const firstBody = mergeBlock('rover_forward');
    const secondBody = mergeBlock('rover_spin_left');
    const firstHat = mergeBlock('rover_on_receive');
    const secondHat = mergeBlock('rover_on_receive');
    firstHat._body = firstBody;
    secondHat._body = secondBody;

    const ws = mergeWorkspace(firstHat, secondHat);

    expect(mergeUplinkHats(ws)).toBe(true);
    expect(firstHat._body).toBe(firstBody);
    expect(firstBody._next).toBe(secondBody);
    expect(secondHat._disposed).toBe(true);
  });

  it('reports a change and disposes an empty spare hat, even though nothing needed relocating', () => {
    // The likely real case: a learner drags out a second uplink, never puts
    // anything in it, and leaves. There is no body to move, but the spare
    // hat still needs to disappear - and the caller still needs to know a
    // save is due, or the disposal never survives past this session.
    const firstBody = mergeBlock('rover_forward');
    const firstHat = mergeBlock('rover_on_receive');
    const emptyHat = mergeBlock('rover_on_receive');
    firstHat._body = firstBody;

    const ws = mergeWorkspace(firstHat, emptyHat);

    expect(mergeUplinkHats(ws)).toBe(true);
    expect(emptyHat._disposed).toBe(true);
    expect(firstHat._body).toBe(firstBody);
  });

  it('does nothing to a workspace with a single uplink hat', () => {
    const onlyHat = mergeBlock('rover_on_receive');
    const ws = mergeWorkspace(onlyHat);

    expect(mergeUplinkHats(ws)).toBe(false);
    expect(onlyHat._disposed).toBe(false);
  });
});

describe('workspaceToCommands', () => {
  it('maps movement blocks to simulator commands at fixed speed 60', () => {
    const ws = workspace(
      onReceive(
        chain(
          block('rover_forward', { TIME: 2 }),
          block('rover_steer_left', { DEGREES: 20, TIME: 1 }),
          block('rover_take_photo') // non-movement → skipped
        )
      )
    );
    expect(workspaceToCommands(ws)).toEqual([
      { command: 'forward', speed: 60, duration: 2 },
      { command: 'steerLeft', degrees: 20, speed: 60, duration: 1 },
    ]);
  });

  it('expands repeat loops', () => {
    const ws = workspace(
      onReceive(block('rover_repeat', { TIMES: 2 }, { DO: block('rover_stop') }))
    );
    expect(workspaceToCommands(ws)).toEqual([{ command: 'stop' }, { command: 'stop' }]);
  });
});

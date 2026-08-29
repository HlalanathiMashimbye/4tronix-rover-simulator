// GENERATED FILE - DO NOT EDIT.
// Built from mission-control/src/lib by scripts/build-roversim.mjs.
// Edit the TypeScript source and re-run `npm run build:roversim`.
import { spinDegreesPerSecond, spinSecondsForDegrees } from './rover-physics.js';
/**
 * Shared rover Blockly definitions, toolbox, and generators.
 *
 * These MUST stay compatible with the yard editor
 * (yard/satellite/templates/code.html): block type names, field names, and
 * dropdown option *values* are exactly what Blockly.serialization writes, so a
 * workspace saved in the hub loads in the yard with no unknown-block errors and
 * vice-versa. When you change a block here, mirror it there (and vice-versa).
 *
 * The Python generator mirrors the yard's so a learner's blocks produce the same
 * rover program the yard would run (low-level servo + time.sleep sequences).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// Dropdown values are "R, G, B" strings consumed by the generator.
const LED_COLOURS = [
    ['red', '255, 0, 0'],
    ['orange', '255, 96, 0'],
    ['yellow', '255, 200, 0'],
    ['green', '0, 255, 0'],
    ['blue', '0, 0, 255'],
    ['purple', '160, 0, 255'],
    ['pink', '255, 64, 160'],
    ['white', '255, 255, 255'],
    ['off', '0, 0, 0'],
];
// Pixel numbers from the 4tronix board layout.
const LED_POSITIONS = [
    ['front left', '1'],
    ['front right', '2'],
    ['rear left', '0'],
    ['rear right', '3'],
];
/**
 * Register every rover block on the given Blockly instance.
 * Safe to call more than once (definitions are idempotent assignments).
 */
export function defineRoverBlocks(Blockly) {
    Blockly.Blocks['rover_on_receive'] = {
        init: function () {
            this.appendDummyInput().appendField('🛰️ On uplink');
            this.appendStatementInput('DO').setCheck(null);
            this.setColour('#FF6D00');
            this.setTooltip('Blocks inside run when sent to the rover');
        },
    };
    Blockly.Blocks['rover_forward'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Move Forward')
                .appendField(new Blockly.FieldNumber(1, 0.1, 10, 0.1), 'TIME')
                .appendField('seconds');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#2196F3');
            this.setTooltip('Move the rover forward');
        },
    };
    Blockly.Blocks['rover_backward'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Move Backward')
                .appendField(new Blockly.FieldNumber(1, 0.1, 10, 0.1), 'TIME')
                .appendField('seconds');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#2196F3');
            this.setTooltip('Move the rover backward');
        },
    };
    Blockly.Blocks['rover_spin_left'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Spin Left')
                .appendField(new Blockly.FieldNumber(90, 15, 360, 15), 'DEGREES')
                .appendField('degrees');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#9C27B0');
            this.setTooltip('Turn left on the spot, by this many degrees');
        },
    };
    Blockly.Blocks['rover_spin_right'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Spin Right')
                .appendField(new Blockly.FieldNumber(90, 15, 360, 15), 'DEGREES')
                .appendField('degrees');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#9C27B0');
            this.setTooltip('Turn right on the spot, by this many degrees');
        },
    };
    Blockly.Blocks['rover_stop'] = {
        init: function () {
            this.appendDummyInput().appendField('Stop');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#f44336');
            this.setTooltip('Stop the rover immediately');
        },
    };
    Blockly.Blocks['rover_steer_left'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Steer Left')
                .appendField(new Blockly.FieldNumber(20, 5, 45, 5), 'DEGREES')
                .appendField('degrees for')
                .appendField(new Blockly.FieldNumber(1, 0.1, 10, 0.1), 'TIME')
                .appendField('seconds');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#00BCD4');
            this.setTooltip('Steer left while moving forward');
        },
    };
    Blockly.Blocks['rover_steer_right'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Steer Right')
                .appendField(new Blockly.FieldNumber(20, 5, 45, 5), 'DEGREES')
                .appendField('degrees for')
                .appendField(new Blockly.FieldNumber(1, 0.1, 10, 0.1), 'TIME')
                .appendField('seconds');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#00BCD4');
            this.setTooltip('Steer right while moving forward');
        },
    };
    Blockly.Blocks['rover_wait'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Wait')
                .appendField(new Blockly.FieldNumber(1, 0.1, 10, 0.1), 'TIME')
                .appendField('seconds');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#FF9800');
            this.setTooltip('Wait for specified time');
        },
    };
    Blockly.Blocks['rover_repeat'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Repeat')
                .appendField(new Blockly.FieldNumber(3, 1, 20, 1), 'TIMES')
                .appendField('times');
            this.appendStatementInput('DO').setCheck(null);
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#FF9800');
            this.setTooltip('Repeat the blocks inside');
        },
    };
    Blockly.Blocks['rover_mast_turn'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Point Mast')
                .appendField(new Blockly.FieldDropdown([
                ['left', 'LEFT'],
                ['centre', 'CENTRE'],
                ['right', 'RIGHT'],
            ]), 'DIR')
                .appendField(new Blockly.FieldNumber(45, 5, 80, 5), 'DEGREES')
                .appendField('°');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#00897B');
            this.setTooltip('Turn the mast left or right, or point it straight ahead');
        },
    };
    Blockly.Blocks['rover_read_distance'] = {
        init: function () {
            this.appendDummyInput().appendField('Read Distance');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#00897B');
            this.setTooltip('Measure how far away the nearest thing is and show it on the monitor');
        },
    };
    Blockly.Blocks['rover_take_photo'] = {
        init: function () {
            this.appendDummyInput().appendField('Take a Picture');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#00897B');
            this.setTooltip('Take a photo with the mast camera and show it on the monitor');
        },
    };
    Blockly.Blocks['rover_distance'] = {
        init: function () {
            this.appendDummyInput().appendField('distance (cm)');
            this.setOutput(true, 'Number');
            this.setColour('#00897B');
            this.setTooltip('The distance the mast sensor sees - for use with comparisons');
        },
    };
    Blockly.Blocks['rover_leds_all'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Set all LEDs')
                .appendField(new Blockly.FieldDropdown(LED_COLOURS), 'COLOUR');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#673AB7');
            this.setTooltip('Set all four LEDs to a colour (driving blocks change them back)');
        },
    };
    Blockly.Blocks['rover_led_one'] = {
        init: function () {
            this.appendDummyInput()
                .appendField('Set')
                .appendField(new Blockly.FieldDropdown(LED_POSITIONS), 'LED')
                .appendField('LED')
                .appendField(new Blockly.FieldDropdown(LED_COLOURS), 'COLOUR');
            this.setPreviousStatement(true, null);
            this.setNextStatement(true, null);
            this.setColour('#673AB7');
            this.setTooltip('Set one LED to a colour (driving blocks change them back)');
        },
    };
}
/**
 * Passed to Blockly.inject()'s `maxInstances` option - the only place Blockly
 * actually reads this from. A mission is one uplink; a second is meaningless
 * (there's nothing else to attach it to) and its execution order would
 * depend on where it happened to sit on the canvas, which nobody could see.
 */
export const ROVER_MAX_INSTANCES = { rover_on_receive: 1 };
/** Category toolbox - mirrors the yard's. */
export const ROVER_TOOLBOX = {
    kind: 'categoryToolbox',
    contents: [
        {
            kind: 'category',
            name: '🛰️ Uplink',
            colour: '#FF6D00',
            // The instance cap for this block lives on the workspace's inject
            // options (see ROVER_MAX_INSTANCES below), not here - Blockly only
            // reads maxInstances from Blockly.inject()'s options object, never
            // from a toolbox content entry. A cap placed here is silently ignored:
            // no error, the block just isn't actually capped.
            contents: [{ kind: 'block', type: 'rover_on_receive' }],
        },
        {
            kind: 'category',
            name: 'Movement',
            colour: '#2196F3',
            contents: [
                { kind: 'block', type: 'rover_forward' },
                { kind: 'block', type: 'rover_backward' },
                { kind: 'block', type: 'rover_steer_left' },
                { kind: 'block', type: 'rover_steer_right' },
                { kind: 'block', type: 'rover_spin_left' },
                { kind: 'block', type: 'rover_spin_right' },
                { kind: 'block', type: 'rover_stop' },
            ],
        },
        {
            kind: 'category',
            name: 'Mast',
            colour: '#00897B',
            contents: [
                { kind: 'block', type: 'rover_mast_turn' },
                { kind: 'block', type: 'rover_read_distance' },
                { kind: 'block', type: 'rover_take_photo' },
                { kind: 'block', type: 'rover_distance' },
            ],
        },
        {
            kind: 'category',
            name: 'Lights',
            colour: '#673AB7',
            contents: [
                { kind: 'block', type: 'rover_leds_all' },
                { kind: 'block', type: 'rover_led_one' },
            ],
        },
        {
            kind: 'category',
            name: 'Control',
            colour: '#FF9800',
            contents: [
                { kind: 'block', type: 'rover_wait' },
                { kind: 'block', type: 'rover_repeat' },
            ],
        },
    ],
};
function getOrderedUplinkHats(workspace) {
    return workspace
        .getTopBlocks(true)
        .filter((block) => block.type === 'rover_on_receive');
}
function getStatementTail(block) {
    let tail = block;
    while (tail?.getNextBlock()) {
        tail = tail.getNextBlock();
    }
    return tail;
}
/**
 * Merge any legacy duplicate uplink hats into the first one in canvas order.
 * This keeps older saved workspaces working while blocking new duplicates.
 *
 * Returns whether the workspace was mutated - callers use this to decide
 * whether to re-save. That must mean "did I dispose a hat", not "did I
 * relocate a body": an empty spare hat (dragged out, never used) still gets
 * disposed below regardless of whether it had anything inside it. Tying the
 * return value to body-relocation instead meant that exact case - the most
 * likely real one - got silently re-disposed from the live workspace on
 * every single load without the cleanup ever reaching storage.
 */
export function mergeUplinkHats(workspace) {
    const hats = getOrderedUplinkHats(workspace);
    if (hats.length <= 1)
        return false;
    const primaryHat = hats[0];
    const primaryInput = primaryHat.getInput('DO');
    let primaryBody = primaryHat.getInputTargetBlock('DO');
    for (const hat of hats.slice(1)) {
        const body = hat.getInputTargetBlock('DO');
        if (body) {
            if (!primaryBody) {
                primaryInput?.connection?.connect(body.previousConnection);
                primaryBody = body;
            }
            else {
                getStatementTail(primaryBody)?.nextConnection?.connect(body.previousConnection);
                primaryBody = getStatementTail(body);
            }
        }
        hat.dispose(false, false);
    }
    return true;
}
/**
 * Generate rover Python from the workspace. Only blocks inside an
 * `rover_on_receive` hat are emitted - matching the yard exactly.
 */
/**
 * The four wheel servos, explained once.
 *
 * They are the least readable thing the generator emits: four numbered calls
 * with no clue that 9, 11, 13 and 15 are wheels. A learner moving from Blocks
 * to Python meets them in the first program they ever look at.
 */
const STRAIGHTEN_NOTE = '# Point all four wheels straight ahead';
/** "1 second", not "1 seconds". This card is about language, so it matters. */
function seconds(value) {
    return `${value} second${String(value) === '1' ? '' : 's'}`;
}
export function workspaceToPython(workspace) {
    const lines = [];
    function blockToLines(block, indent) {
        if (!block)
            return;
        const pad = '    '.repeat(indent);
        const type = block.type;
        switch (type) {
            case 'rover_on_receive': {
                blockToLines(block.getInputTargetBlock('DO'), indent);
                return; // hat block - no next block to follow
            }
            case 'rover_forward': {
                const t = block.getFieldValue('TIME');
                lines.push(`${pad}# Drive forward for ${seconds(t)}`);
                lines.push(`${pad}${STRAIGHTEN_NOTE}`);
                lines.push(`${pad}rover.setServo(9, 0)`);
                lines.push(`${pad}rover.setServo(11, 0)`);
                lines.push(`${pad}rover.setServo(13, 0)`);
                lines.push(`${pad}rover.setServo(15, 0)`);
                lines.push(`${pad}rover.forward(60)`);
                lines.push(`${pad}time.sleep(${t})`);
                lines.push(`${pad}rover.stop()`);
                break;
            }
            case 'rover_backward': {
                const t = block.getFieldValue('TIME');
                lines.push(`${pad}# Drive backwards for ${seconds(t)}`);
                lines.push(`${pad}${STRAIGHTEN_NOTE}`);
                lines.push(`${pad}rover.setServo(9, 0)`);
                lines.push(`${pad}rover.setServo(11, 0)`);
                lines.push(`${pad}rover.setServo(13, 0)`);
                lines.push(`${pad}rover.setServo(15, 0)`);
                lines.push(`${pad}rover.reverse(60)`);
                lines.push(`${pad}time.sleep(${t})`);
                lines.push(`${pad}rover.stop()`);
                break;
            }
            case 'rover_spin_left': {
                const deg = spinDegrees(block);
                const t = spinSecondsForDegrees(deg, SPIN_SPEED);
                lines.push(`${pad}# Turn left ${deg} degrees on the spot`);
                lines.push(`${pad}rover.stop()`);
                lines.push(`${pad}# Turn the wheels sideways so the rover turns instead of driving`);
                lines.push(`${pad}rover.setServo(9, 50)`);
                lines.push(`${pad}rover.setServo(15, -50)`);
                lines.push(`${pad}rover.setServo(11, -50)`);
                lines.push(`${pad}rover.setServo(13, 50)`);
                lines.push(`${pad}rover.spinLeft(60)`);
                lines.push(`${pad}time.sleep(${t})`);
                lines.push(`${pad}rover.stop()`);
                break;
            }
            case 'rover_spin_right': {
                const deg = spinDegrees(block);
                const t = spinSecondsForDegrees(deg, SPIN_SPEED);
                lines.push(`${pad}# Turn right ${deg} degrees on the spot`);
                lines.push(`${pad}rover.stop()`);
                lines.push(`${pad}# Turn the wheels sideways so the rover turns instead of driving`);
                lines.push(`${pad}rover.setServo(9, 50)`);
                lines.push(`${pad}rover.setServo(15, -50)`);
                lines.push(`${pad}rover.setServo(11, -50)`);
                lines.push(`${pad}rover.setServo(13, 50)`);
                lines.push(`${pad}rover.spinRight(60)`);
                lines.push(`${pad}time.sleep(${t})`);
                lines.push(`${pad}rover.stop()`);
                break;
            }
            case 'rover_stop':
                lines.push(`${pad}# Stop moving`);
                lines.push(`${pad}rover.stop()`);
                break;
            case 'rover_steer_left': {
                const d = block.getFieldValue('DEGREES');
                const t = block.getFieldValue('TIME');
                lines.push(`${pad}# Steer left ${d} degrees while driving for ${seconds(t)}`);
                lines.push(`${pad}# Angle the wheels, drive, then straighten up again`);
                lines.push(`${pad}rover.setServo(9, -${d})`);
                lines.push(`${pad}rover.setServo(15, -${d})`);
                lines.push(`${pad}rover.setServo(11, ${d})`);
                lines.push(`${pad}rover.setServo(13, ${d})`);
                lines.push(`${pad}rover.forward(60)`);
                lines.push(`${pad}time.sleep(${t})`);
                lines.push(`${pad}rover.stop()`);
                lines.push(`${pad}rover.setServo(9, 0)`);
                lines.push(`${pad}rover.setServo(11, 0)`);
                lines.push(`${pad}rover.setServo(13, 0)`);
                lines.push(`${pad}rover.setServo(15, 0)`);
                break;
            }
            case 'rover_steer_right': {
                const d = block.getFieldValue('DEGREES');
                const t = block.getFieldValue('TIME');
                lines.push(`${pad}# Steer right ${d} degrees while driving for ${seconds(t)}`);
                lines.push(`${pad}# Angle the wheels, drive, then straighten up again`);
                lines.push(`${pad}rover.setServo(9, ${d})`);
                lines.push(`${pad}rover.setServo(15, ${d})`);
                lines.push(`${pad}rover.setServo(11, -${d})`);
                lines.push(`${pad}rover.setServo(13, -${d})`);
                lines.push(`${pad}rover.forward(60)`);
                lines.push(`${pad}time.sleep(${t})`);
                lines.push(`${pad}rover.stop()`);
                lines.push(`${pad}rover.setServo(9, 0)`);
                lines.push(`${pad}rover.setServo(11, 0)`);
                lines.push(`${pad}rover.setServo(13, 0)`);
                lines.push(`${pad}rover.setServo(15, 0)`);
                break;
            }
            case 'rover_wait': {
                const t = block.getFieldValue('TIME');
                lines.push(`${pad}# Wait ${seconds(t)} before the next step`);
                lines.push(`${pad}time.sleep(${t})`);
                break;
            }
            case 'rover_mast_turn': {
                // Mast servo is 0; positive degrees = left, negative = right
                const dir = block.getFieldValue('DIR');
                const deg = block.getFieldValue('DEGREES');
                const angle = dir === 'LEFT' ? deg : dir === 'RIGHT' ? -deg : 0;
                lines.push(`${pad}# Turn the camera mast to ${angle} degrees`);
                lines.push(`${pad}rover.setServo(0, ${angle})`);
                lines.push(`${pad}time.sleep(0.5)`);
                break;
            }
            case 'rover_read_distance': {
                lines.push(`${pad}# Measure how far away the nearest thing is, and print it`);
                lines.push(`${pad}print('Distance: ' + str(round(rover.getDistance())) + ' cm')`);
                break;
            }
            case 'rover_take_photo': {
                lines.push(`${pad}# Take a photo with the rover camera`);
                lines.push(`${pad}take_photo()`);
                break;
            }
            case 'rover_leds_all': {
                const rgb = block.getFieldValue('COLOUR');
                lines.push(`${pad}# Light up every LED in this colour`);
                lines.push(`${pad}rover.setColor(rover.fromRGB(${rgb}))`);
                lines.push(`${pad}rover.show()`);
                break;
            }
            case 'rover_led_one': {
                const led = block.getFieldValue('LED');
                const rgb = block.getFieldValue('COLOUR');
                lines.push(`${pad}# Light up LED number ${led} in this colour`);
                lines.push(`${pad}rover.setPixel(${led}, rover.fromRGB(${rgb}))`);
                lines.push(`${pad}rover.show()`);
                break;
            }
            case 'rover_repeat': {
                const times = block.getFieldValue('TIMES');
                lines.push(`${pad}# Do the next steps ${times} times over`);
                lines.push(`${pad}for _ in range(${times}):`);
                const inner = block.getInputTargetBlock('DO');
                if (inner) {
                    blockToLines(inner, indent + 1);
                }
                else {
                    lines.push(`${pad}    pass`);
                }
                break;
            }
        }
        blockToLines(block.getNextBlock(), indent);
    }
    workspace
        .getTopBlocks(true)
        .filter((b) => b.type === 'rover_on_receive')
        .forEach((b) => blockToLines(b, 0));
    return lines.join('\n') + '\n';
}
/**
 * Turning is expressed in DEGREES, and converted to seconds here.
 *
 * The blocks used to ask for seconds, which made the most obvious thing a child
 * would ever try - drive a square - impossible. A 90 degree corner needs 2.736
 * seconds at speed 60, the field's step was 0.1, and nothing in the interface
 * told them the rate. Four corners of 2.7s left the square 1.1cm open and the
 * rover 4.5 degrees off; 2.8s overshot the other way. They were being asked to
 * solve 90 / 32.9 with a number they had never been given.
 *
 * Steer Left and Steer Right already took degrees. Turning on the spot was the
 * one motion that did not, and the one a square needs.
 */
const SPIN_SPEED = 60;
/**
 * The turn angle on a spin block, tolerating workspaces saved before this
 * changed.
 *
 * Old missions stored `TIME` in seconds. Blockly drops a field it does not
 * recognise on load, so without this an archived mission would silently render
 * as the 90 degree default and its blocks would no longer match the Python
 * stored alongside them. Converting keeps the picture honest.
 */
function spinDegrees(block) {
    const degrees = block.getFieldValue('DEGREES');
    if (degrees !== null && degrees !== undefined && degrees !== '')
        return Number(degrees);
    const legacySeconds = Number(block.getFieldValue('TIME'));
    if (Number.isFinite(legacySeconds) && legacySeconds > 0) {
        return Math.round(legacySeconds * spinDegreesPerSecond(SPIN_SPEED));
    }
    return 90;
}
/**
 * Rewrite a saved workspace's spin blocks from seconds to degrees.
 *
 * Blockly serialises fields by name and silently drops any it does not
 * recognise, so a workspace saved before this change would load with its spin
 * blocks reset to the 90 degree default - and an archived mission would render
 * as blocks that no longer match the Python stored beside them.
 *
 * Converting at load time keeps every existing mission truthful. Returns the
 * input untouched if it is not JSON we recognise: a mission that will not parse
 * is better rendered empty than half-rewritten.
 */
export function migrateSpinBlocks(serialised) {
    let parsed;
    try {
        parsed = JSON.parse(serialised);
    }
    catch {
        return serialised;
    }
    let changed = false;
    const walk = (node) => {
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (!node || typeof node !== 'object')
            return;
        const block = node;
        if ((block.type === 'rover_spin_left' || block.type === 'rover_spin_right') &&
            block.fields &&
            block.fields.DEGREES === undefined &&
            block.fields.TIME !== undefined) {
            const seconds = Number(block.fields.TIME);
            if (Number.isFinite(seconds) && seconds > 0) {
                block.fields.DEGREES = Math.round(seconds * spinDegreesPerSecond(SPIN_SPEED));
                delete block.fields.TIME;
                changed = true;
            }
        }
        Object.values(node).forEach(walk);
    };
    walk(parsed);
    return changed ? JSON.stringify(parsed) : serialised;
}
/** The rover has four corner lamps. LED_POSITIONS above is the same order. */
export const LED_COUNT = 4;
/**
 * Map the workspace to local-simulator commands. Speed is fixed at 60 to match
 * the Python the rover actually runs. Only blocks inside `rover_on_receive`
 * counts.
 *
 * LEDs used to be dropped here, on the grounds that the 2D sim had no concept
 * of them. It does now: a child who lights the rover up should see it light up,
 * and there are four real lamps on the corners of the chassis to match.
 */
export function workspaceToCommands(workspace) {
    const commands = [];
    function processChain(block, out) {
        while (block) {
            processOne(block, out);
            block = block.getNextBlock();
        }
    }
    function processOne(block, out) {
        switch (block.type) {
            case 'rover_on_receive':
                processChain(block.getInputTargetBlock('DO'), out);
                break;
            case 'rover_forward':
                out.push({ command: 'forward', speed: 60, duration: Number(block.getFieldValue('TIME')) });
                break;
            case 'rover_backward':
                out.push({ command: 'reverse', speed: 60, duration: Number(block.getFieldValue('TIME')) });
                break;
            case 'rover_spin_left':
                out.push({
                    command: 'spinLeft',
                    speed: SPIN_SPEED,
                    duration: spinSecondsForDegrees(spinDegrees(block), SPIN_SPEED),
                });
                break;
            case 'rover_spin_right':
                out.push({
                    command: 'spinRight',
                    speed: SPIN_SPEED,
                    duration: spinSecondsForDegrees(spinDegrees(block), SPIN_SPEED),
                });
                break;
            case 'rover_steer_left':
                out.push({
                    command: 'steerLeft',
                    degrees: Number(block.getFieldValue('DEGREES')),
                    speed: 60,
                    duration: Number(block.getFieldValue('TIME')),
                });
                break;
            case 'rover_steer_right':
                out.push({
                    command: 'steerRight',
                    degrees: Number(block.getFieldValue('DEGREES')),
                    speed: 60,
                    duration: Number(block.getFieldValue('TIME')),
                });
                break;
            case 'rover_stop':
                out.push({ command: 'stop' });
                break;
            case 'rover_leds_all': {
                const rgb = block.getFieldValue('COLOUR');
                out.push({ command: 'leds', leds: Array(LED_COUNT).fill(rgb) });
                break;
            }
            case 'rover_led_one': {
                const rgb = block.getFieldValue('COLOUR');
                const which = Number(block.getFieldValue('LED'));
                // Only the chosen lamp changes; the others keep whatever they were.
                const leds = Array(LED_COUNT).fill(null);
                if (which >= 0 && which < LED_COUNT)
                    leds[which] = rgb;
                out.push({ command: 'leds', leds });
                break;
            }
            case 'rover_wait':
                // Time passes, and the lamps stay lit through it. Dropping this made a
                // "lights on, wait, lights off" program flash past in one frame.
                out.push({ command: 'wait', duration: Number(block.getFieldValue('TIME')) });
                break;
            case 'rover_repeat': {
                const times = Number(block.getFieldValue('TIMES'));
                const loop = [];
                processChain(block.getInputTargetBlock('DO'), loop);
                for (let i = 0; i < times; i++)
                    out.push(...loop);
                break;
            }
            // mast / photo / distance still have no 2D-sim effect
            default:
                break;
        }
    }
    workspace
        .getTopBlocks(true)
        .filter((b) => b.type === 'rover_on_receive')
        .forEach((b) => processOne(b, commands));
    return commands;
}

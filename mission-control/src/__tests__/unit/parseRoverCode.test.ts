import { parseRoverCode } from '@/lib/parseRoverCode';

describe('parseRoverCode', () => {
  describe('real low-level rover API (blocks + real rover)', () => {
    it('reads forward(speed) + time.sleep + stop as one forward command', () => {
      const code = ['rover.forward(60)', 'time.sleep(1.5)', 'rover.stop()'].join('\n');
      expect(parseRoverCode(code)).toEqual([{ command: 'forward', speed: 60, duration: 1.5 }]);
    });

    it('reads reverse and spins', () => {
      const code = [
        'rover.reverse(80)',
        'time.sleep(1)',
        'rover.stop()',
        'rover.spinLeft(60)',
        'time.sleep(0.5)',
        'rover.stop()',
      ].join('\n');
      expect(parseRoverCode(code)).toEqual([
        { command: 'reverse', speed: 80, duration: 1 },
        { command: 'spinLeft', speed: 60, duration: 0.5 },
      ]);
    });

    it('reads a steered move from the wheel servos (front-left negative = steer left)', () => {
      const code = [
        'rover.setServo(9, -20)',
        'rover.setServo(15, -20)',
        'rover.setServo(11, 20)',
        'rover.setServo(13, 20)',
        'rover.forward(60)',
        'time.sleep(1)',
        'rover.stop()',
      ].join('\n');
      expect(parseRoverCode(code)).toEqual([
        { command: 'steerLeft', degrees: 20, speed: 60, duration: 1 },
      ]);
    });

    it('reads steer right (front-left positive)', () => {
      const code = [
        'rover.setServo(9, 30)',
        'rover.forward(60)',
        'time.sleep(2)',
        'rover.stop()',
      ].join('\n');
      expect(parseRoverCode(code)).toEqual([
        { command: 'steerRight', degrees: 30, speed: 60, duration: 2 },
      ]);
    });

    it('straightens between moves so a later forward is not a steer', () => {
      const code = [
        'rover.setServo(9, -20)',
        'rover.forward(60)',
        'time.sleep(1)',
        'rover.stop()',
        'rover.setServo(9, 0)',
        'rover.forward(60)',
        'time.sleep(1)',
        'rover.stop()',
      ].join('\n');
      const out = parseRoverCode(code);
      expect(out[0].command).toBe('steerLeft');
      expect(out[1]).toEqual({ command: 'forward', speed: 60, duration: 1 });
    });

    it('ignores the mast and a bare wait (no movement)', () => {
      const code = [
        'rover.setServo(0, 30)', // mast, no effect on a 2D sim
        'time.sleep(1)', // bare wait, no active motion
        'rover.forward(60)',
        'time.sleep(1)',
        'rover.stop()',
      ].join('\n');
      expect(parseRoverCode(code)).toEqual([{ command: 'forward', speed: 60, duration: 1 }]);
    });

    it('lights the lamps, because a child who turns them on should see them', () => {
      // This used to assert LEDs were IGNORED. They were dropped on the way to
      // the simulator, so "set all LEDs to red" did nothing a learner could
      // see, on a rover that has four real lamps on its corners.
      const code = [
        'rover.setColor(rover.fromRGB(255, 0, 0))',
        'rover.show()',
        'rover.forward(60)',
        'time.sleep(1)',
        'rover.stop()',
      ].join('\n');

      expect(parseRoverCode(code)).toEqual([
        { command: 'leds', leds: ['255, 0, 0', '255, 0, 0', '255, 0, 0', '255, 0, 0'] },
        { command: 'forward', speed: 60, duration: 1 },
      ]);
    });

    it('waits for show() before lighting anything', () => {
      // setColor stages, show commits. The editor's own help promises this
      // ("Nothing changes until you call this"), so the simulator has to agree
      // or it teaches a child something untrue about their rover.
      const code = ['rover.setColor(rover.fromRGB(0, 255, 0))'].join('\n');

      expect(parseRoverCode(code)).toEqual([]);
    });

    it('changes only the lamp setPixel names', () => {
      const code = [
        'rover.setPixel(2, rover.fromRGB(0, 0, 255))',
        'rover.show()',
      ].join('\n');

      // null means "leave that one alone", so the other three keep whatever
      // they already were rather than being switched off.
      expect(parseRoverCode(code)).toEqual([
        { command: 'leds', leds: [null, null, '0, 0, 255', null] },
      ]);
    });
  });

  describe('for-loops', () => {
    it('expands range loops, repeating the body', () => {
      const code = [
        'for _ in range(3):',
        '    rover.forward(60)',
        '    time.sleep(1)',
        '    rover.stop()',
      ].join('\n');
      const out = parseRoverCode(code);
      expect(out).toHaveLength(3);
      expect(out.every((c) => c.command === 'forward')).toBe(true);
    });
  });

  describe('legacy high-level form still replays', () => {
    it('reads forward(speed, duration)', () => {
      expect(parseRoverCode('rover.forward(80, 1.5)')).toEqual([
        { command: 'forward', speed: 80, duration: 1.5 },
      ]);
    });

    it('reads steerLeft(degrees, speed, duration)', () => {
      expect(parseRoverCode('rover.steerLeft(20, 60, 1)')).toEqual([
        { command: 'steerLeft', degrees: 20, speed: 60, duration: 1 },
      ]);
    });
  });

  it('skips comments and blank lines', () => {
    const code = ['# drive forward', '', 'rover.forward(60)', 'time.sleep(1)'].join('\n');
    expect(parseRoverCode(code)).toEqual([{ command: 'forward', speed: 60, duration: 1 }]);
  });
});

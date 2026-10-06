/**
 * What a mission card shows of its code (MissionCard's codePeek).
 *
 * A mission built with blocks opens with the generator's notes and four
 * setServo(n, 0) calls that straighten the wheels, so every block-built card
 * showed the same four lines. The peek is the part that drives.
 */

import { codePeek } from '@/components/MissionCard/MissionCard';

const BLOCKS = [
  '# Drive forward for 5 seconds',
  '# Point all four wheels straight ahead',
  'rover.setServo(9, 0)',
  'rover.setServo(11, 0)',
  'rover.setServo(13, 0)',
  'rover.setServo(15, 0)',
  'rover.forward(60)',
  'time.sleep(5)',
  'rover.stop()',
  '# Turn left 135 degrees on the spot',
  'rover.stop()',
  'rover.setServo(9, 50)',
  'rover.spinLeft(60)',
  'time.sleep(2.982)',
  'rover.stop()',
].join('\n');

it('shows what the rover does, not the comments and wheel setup that open it', () => {
  expect(codePeek(BLOCKS).split('\n')).toEqual(['rover.forward(60)', 'time.sleep(5)', 'rover.stop()', 'rover.spinLeft(60)']);
});

it('tells two block-built missions apart', () => {
  const other = BLOCKS.replace('time.sleep(5)', 'time.sleep(2)');
  expect(codePeek(other)).not.toEqual(codePeek(BLOCKS));
});

it('still pads a short mission to the same four lines as every other card', () => {
  expect(codePeek('rover.forward(60)\ntime.sleep(3)').split('\n')).toHaveLength(4);
});

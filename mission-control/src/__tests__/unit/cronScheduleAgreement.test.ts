/**
 * The YouTube auto-link cadence is stated in two places that cannot read each
 * other: Cloud Scheduler's cron expression, owned by Terraform, and the
 * admin-set interval's floor in runtimeSettings.ts, owned by the app. Nothing
 * stops those drifting apart the way the yard's clipboard regexes could, so
 * this parses both out of their real source (yard/satellite/tests/test_mission_import.py
 * does the equivalent across Python and JS) and checks they still agree,
 * rather than restating either number as a literal.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function namedBlock(source: string, needle: string): string {
  const start = source.indexOf(needle);
  if (start === -1) throw new Error(`"${needle}" is gone from its source file`);
  return source.slice(start, source.indexOf('\n}', start));
}

/** Minutes between Cloud Scheduler ticks, from the `cron_schedule` default. */
function schedulerCadenceMinutes(): number {
  const tf = readFileSync(
    join(REPO_ROOT, 'infra/modules/mission-control/variables.tf'),
    'utf8',
  );
  const block = namedBlock(tf, 'variable "cron_schedule"');
  const match = block.match(/default\s*=\s*"\*\/(\d+) \* \* \* \*"/);
  if (!match) throw new Error('cron_schedule no longer defaults to a plain */N minute schedule');
  return Number(match[1]);
}

/** The floor the app enforces on the admin-set check interval. */
function intervalFloorMinutes(): number {
  const settings = readFileSync(
    join(REPO_ROOT, 'mission-control/src/core/domain/services/runtimeSettings.ts'),
    'utf8',
  );
  const block = namedBlock(settings, 'youtubeLinkIntervalMinutes:');
  const match = block.match(/n < (\d+)/);
  if (!match) throw new Error('youtubeLinkIntervalMinutes lost its floor check');
  return Number(match[1]);
}

describe('the YouTube auto-link cadence', () => {
  it('has Cloud Scheduler firing exactly as often as the app assumes it does', () => {
    expect(schedulerCadenceMinutes()).toBe(intervalFloorMinutes());
  });
});

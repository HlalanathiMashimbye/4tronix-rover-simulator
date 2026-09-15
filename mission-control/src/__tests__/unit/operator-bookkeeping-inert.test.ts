/**
 * Operator bookkeeping cannot move a rover (AB#379, acceptance criterion 4).
 *
 * This is a safety property rather than a behaviour, so it is asserted against
 * the source. The route settles records: complete, cancel, attach a video,
 * resolve a review, delete. It must never gain the ability to dispatch, stop or
 * drive anything, and the failure mode if it does is not a broken test suite
 * somewhere else, it is a rover moving near children because somebody clicked
 * a button on a laptop in another building.
 *
 * Stop is the sharpest case and stays on the satellite permanently. A cloud
 * stop would take up to a sync interval to arrive and do nothing at all when
 * the yard is offline, which is precisely the thing a stop control must never
 * do. See operator_console.py.
 *
 * If cloud dispatch is ever built, it belongs in its own route with its own
 * arming precondition, and this test should keep passing untouched.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTE = 'src/app/api/operator/missions/[id]/route.ts';

/**
 * What the commands do moved out of the route into an application service, so
 * the property has to hold there as well. A route that cannot reach a rover
 * proves nothing if the service it calls can.
 */
const SERVICE = 'src/core/application/services/OperatorMissionCommands.ts';

/**
 * Comments stripped before asserting.
 *
 * Both files explain at length why they never touch a rover, using every word
 * this test forbids. Matching prose would fail them for saying the right thing,
 * and the only way to pass would be to delete the explanation.
 */
function code(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const source = code(ROUTE);
const routeAndService = `${source}\n${code(SERVICE)}`;

describe('the bookkeeping route is inert', () => {
  // Every way the codebase currently has of reaching a rover or a satellite.
  const forbidden = [
    'dispatch',
    'rover',
    'ROVER_URL',
    'satellite',
    'armed',
    'camera',
    '/stop',
  ];

  it.each(forbidden)('never mentions %s', (term) => {
    expect(routeAndService.toLowerCase()).not.toContain(term.toLowerCase());
  });

  it('makes no outbound network call of its own', () => {
    // The one exception is the learner's completion email, which goes through
    // MissionNotificationService rather than a bare fetch. A raw fetch here
    // would be the first step towards talking to a yard directly.
    expect(routeAndService).not.toMatch(/\bfetch\s*\(/);
  });

  it('writes only through the repository', () => {
    // No direct Firestore handle means no path to a collection this route has
    // no business in.
    expect(routeAndService).not.toContain('.collection(');
  });

  it('restricts delete to an admin, and nothing else to an admin', () => {
    // AB#379 puts delete alone behind the admin role. Getting this backwards
    // would either lock operators out of their own job or hand everyone the
    // one irreversible action.
    const deleteHandler = source.slice(source.indexOf('export async function DELETE'));
    expect(deleteHandler).toContain('requireAdmin()');

    const postHandler = source.slice(
      source.indexOf('export async function POST'),
      source.indexOf('export async function DELETE'),
    );
    expect(postHandler).toContain('requireOperator()');
    expect(postHandler).not.toContain('requireAdmin()');
  });
});

"""The rover and Mission Control must agree on what is legal.

limits.py and mission-control/src/core/domain/safety/limits.ts both say
"change both". Nothing checked that anyone did. A ceiling raised on one side
only would mean missions accepted in the browser and refused on the rover -
the "Elsje" failure again, where a child's mission queued cleanly and then
never moved - or the reverse, the rover driving a speed the cloud promised it
would never be sent.

Read as text rather than imported, because the other half is TypeScript.
"""

import os
import re

import limits

LIMITS_TS = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', '..', 'mission-control', 'src', 'core', 'domain', 'safety', 'limits.ts',
)


def _ts_constant(name: str) -> int:
    with open(LIMITS_TS, encoding='utf-8') as f:
        source = f.read()
    match = re.search(rf'export const {name} = (\d+);', source)
    assert match, f'{name} is no longer a literal in limits.ts; update this test'
    return int(match.group(1))


def test_the_speed_ceiling_is_the_same_on_both_sides():
    assert limits.MAX_ROVER_SPEED == _ts_constant('MAX_ROVER_SPEED')


def test_the_slowest_speed_is_the_same_on_both_sides():
    assert limits.MIN_ROVER_SPEED == _ts_constant('MIN_ROVER_SPEED')


def test_the_mission_time_limit_is_the_same_on_both_sides():
    assert limits.MISSION_TIME_LIMIT_SECONDS == _ts_constant('MISSION_TIME_LIMIT_SECONDS')

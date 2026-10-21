"""The scripts a person runs on the satellite and the rover, in the room.

They are run once, by hand, often over an SSH session the script itself is
about to cut, so a mistake in one is found at the worst moment. These check
what can be checked from here: that each parses, and that the yard's wifi
password is asked for rather than written into the one that joins the router.
"""

import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / 'docs' / 'setup-scripts'


@pytest.mark.skipif(not shutil.which('bash'), reason='bash is not installed here')
@pytest.mark.parametrize('script', sorted(SCRIPTS.glob('*.sh')), ids=lambda p: p.name)
def test_each_setup_script_parses(script):
    result = subprocess.run(['bash', '-n', str(script)], capture_output=True, text=True)

    assert result.returncode == 0, result.stderr


def test_joining_the_router_asks_for_its_password():
    """A copy of the yard's password in a script is one more place for it to
    go stale, or to leak with the repository."""
    script = (SCRIPTS / 'satellite-join-relay.sh').read_text()

    assert 'read -rsp' in script
    assert 'PSK="${PSK:-}"' not in script and 'PSK="${PSK:-' not in script


def test_joining_the_router_checks_before_it_goes_back():
    """It goes back to the network it was on only if the satellite did not
    join, never on a timer alone: after the switch nobody can reach it to
    cancel."""
    script = (SCRIPTS / 'satellite-join-relay.sh').read_text()
    check = script[script.index('cat > /usr/local/sbin/yard-relay-check'):script.index('CHECK\nchmod')]

    assert check.index('grep -qx "${CLIENT_CON}"') < check.index('nmcli con up "${PREVIOUS}"')
    assert 'exit 0' in check

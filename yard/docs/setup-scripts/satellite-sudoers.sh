#!/usr/bin/env bash
# Lets the satellite restart its own services and shut itself down without the
# mars password. Run once on the Pi, from the repo checkout:
#
#   sudo bash yard/docs/setup-scripts/satellite-sudoers.sh
#
# That one sudo asks for the password; nothing after it does. The rule itself,
# and why it is exactly what it is, is yard/deploy/satellite.sudoers.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Run it with sudo: sudo bash $0" >&2
    exit 1
fi

rule="$(cd "$(dirname "$0")/../../deploy" && pwd)/satellite.sudoers"
target=/etc/sudoers.d/satellite

# sudo compares full paths, and the rule names /usr/bin/systemctl. On a box
# where it lives elsewhere the rule would install cleanly and match nothing.
found="$(command -v systemctl || true)"
if [ "$found" != /usr/bin/systemctl ]; then
    echo "systemctl is at '${found:-nowhere}', not /usr/bin/systemctl. Change satellite.sudoers to match first." >&2
    exit 1
fi

# A sudoers file with a syntax error can lock everyone out of sudo, so it is
# checked before it goes in, and the whole set is checked after.
visudo -cf "$rule"
install -o root -g root -m 0440 "$rule" "$target"
visudo -c >/dev/null

echo "Installed $target. Checking as mars, with no password:"
for cmd in "restart satellite-web" "restart satellite-camera" "stop satellite-camera" "poweroff"; do
    if sudo -u mars sudo -n -l /usr/bin/systemctl $cmd >/dev/null 2>&1; then
        echo "  ok    systemctl $cmd"
    else
        echo "  FAIL  systemctl $cmd" >&2
        exit 1
    fi
done

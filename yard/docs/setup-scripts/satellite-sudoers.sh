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

# Read from sudo's own list of what mars may run with no password. Not with
# `sudo -n -l <command>`: once any entry is passwordless that says yes to
# everything mars may run at all, password or not, so it cannot catch a
# missing entry (it said yes to reboot on 21 October 2026).
listing="$(sudo -u mars sudo -n -l 2>/dev/null || true)"
nopasswd() {
    grep 'NOPASSWD:' <<<"$listing" | sed 's/.*NOPASSWD://' | tr ',' '\n' \
        | sed 's/^ *//; s/ *$//' | grep -Fxq "/usr/bin/systemctl $1"
}
echo "Installed $target. Passwordless for mars:"
for cmd in "restart satellite-web" "restart satellite-camera" "stop satellite-camera" "poweroff"; do
    if nopasswd "$cmd"; then
        echo "  ok    systemctl $cmd"
    else
        echo "  FAIL  systemctl $cmd" >&2
        exit 1
    fi
done
# And nothing more than the rule says.
if nopasswd reboot; then
    echo "  FAIL  systemctl reboot is passwordless too, which the rule does not allow" >&2
    exit 1
fi
echo "  ok    systemctl reboot still needs the password"

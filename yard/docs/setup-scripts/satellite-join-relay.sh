#!/usr/bin/env bash
#
# Make the satellite a client of the yard's router, mars-relay-network, and
# stop it serving marsyard itself.
#
# The satellite served the yard's wifi (satellite-as-access-point.sh), and one
# radio cannot be both: as the access point it had no internet, so neither did
# anything joined to it. The yard now has a router, a Cudy LT300, that joins
# the venue's wifi and serves mars-relay-network from it. Joined to that, the
# satellite has internet as well as the rover: its clock sets itself, a git
# pull works in the room, and recordings can upload.
#
# The access point profile is kept, with autoconnect off, as the way back if
# the router is ever missing: run satellite-as-access-point.sh again, or let
# the check below do it.
#
# NOTHING TO CANCEL AFTERWARDS, for the access point script's reason: the SSH
# session running this is cut when the satellite changes network, so the person
# who would cancel a rollback has no route to the machine. The check instead
# asks whether the satellite actually joined, and goes back only if it did not.
#
# Run it on the satellite, with the router on and mars-relay-network up:
#   sudo bash yard/docs/setup-scripts/satellite-join-relay.sh
#
# The network's password is asked for, not written here: it is the yard's, and
# a copy in a script is one more place for it to go stale or leak.
#
set -euo pipefail

SSID="${SSID:-mars-relay-network}"
CLIENT_CON="${CLIENT_CON:-mars-relay-network}"
AP_CON="${AP_CON:-yard-ap}"
WIFI_DEV="${WIFI_DEV:-wlan0}"
CHECK_MIN="${CHECK_MIN:-3}"

if [[ $EUID -ne 0 ]]; then
    echo "Run this with sudo: sudo bash $0" >&2
    exit 1
fi

if [[ -z "${PSK:-}" ]]; then
    read -rsp "Password for ${SSID}: " PSK
    echo
fi
if [[ ${#PSK} -lt 8 ]]; then
    echo "A WPA2 password is at least 8 characters." >&2
    exit 1
fi

# Serving marsyard, the radio cannot scan, so the router is only looked for
# when the satellite is a client already. Otherwise the check below is what
# finds out.
SERVING=no
if nmcli -t -f NAME con show --active | grep -qx "${AP_CON}"; then
    SERVING=yes
elif ! nmcli -t -f SSID dev wifi list ifname "${WIFI_DEV}" --rescan yes | grep -Fxq "${SSID}"; then
    echo "${SSID} is not in range. Is the router on, and in WISP mode? Nothing was changed." >&2
    exit 1
fi

echo "== plan =="
echo "  device        : ${WIFI_DEV}"
echo "  joins         : ${SSID}, as profile '${CLIENT_CON}'"
echo "  stops serving : ${AP_CON} (kept, autoconnect off)   currently serving: ${SERVING}"
echo "  check in      : ${CHECK_MIN} min, goes back to ${AP_CON} only if ${SSID} did not join"
echo

# ---- 1. The profiles ------------------------------------------------------
# Replaced rather than edited, so a profile left half-written by an earlier
# attempt cannot carry a wrong setting through.
nmcli con delete "${CLIENT_CON}" >/dev/null 2>&1 || true
nmcli con add type wifi ifname "${WIFI_DEV}" con-name "${CLIENT_CON}" \
    autoconnect no ssid "${SSID}" >/dev/null
nmcli con modify "${CLIENT_CON}" \
    802-11-wireless-security.key-mgmt wpa-psk \
    802-11-wireless-security.psk "${PSK}" \
    connection.autoconnect yes \
    connection.autoconnect-priority 30

# Off, not deleted: it is the yard's way back when the router is missing.
if nmcli -t -f NAME con show | grep -qx "${AP_CON}"; then
    nmcli con modify "${AP_CON}" connection.autoconnect no
fi

echo "== profile '${CLIENT_CON}' written, autoconnect on; '${AP_CON}' autoconnect off =="

# ---- 2. The check that goes back only on real failure ---------------------
# systemd-run rather than a backgrounded sleep: it has to outlive the SSH
# session that is about to be cut.
cat > /usr/local/sbin/yard-relay-check <<CHECK
#!/usr/bin/env bash
# Go back to serving marsyard, but only if the satellite never joined ${SSID}.
if nmcli -t -f NAME con show --active | grep -qx "${CLIENT_CON}"; then
    logger -t yard-relay-check "joined ${SSID}, leaving it alone"
    exit 0
fi
logger -t yard-relay-check "did NOT join ${SSID}, serving ${AP_CON} again"
if nmcli -t -f NAME con show | grep -qx "${AP_CON}"; then
    nmcli con modify "${AP_CON}" connection.autoconnect yes || true
    nmcli con up "${AP_CON}" || true
fi
CHECK
chmod +x /usr/local/sbin/yard-relay-check
systemctl stop yard-relay-check.timer >/dev/null 2>&1 || true
systemd-run --unit=yard-relay-check --on-active="${CHECK_MIN}min" \
    /usr/local/sbin/yard-relay-check >/dev/null
echo "== safety check in ${CHECK_MIN} min: goes back ONLY if ${SSID} did not join =="

# ---- 3. The switch --------------------------------------------------------
cat <<BANNER

Joining ${SSID}. If this SSH session came in over marsyard, it drops now.

  1. Put your laptop or tablet on ${SSID}.
  2. Within a minute the satellite answers at:
         http://mro.local:3001/
  3. On it, Settings shows the rover once the rover is on ${SSID} too.
  4. If it never appears, wait ${CHECK_MIN} minutes: the satellite goes back to
     serving ${AP_CON} by itself, and you can join that to look.

BANNER

# Detached, so the switch is not killed halfway by its own SSH session dying.
systemd-run --unit=yard-relay-up --collect \
    /usr/bin/nmcli con up "${CLIENT_CON}" >/dev/null

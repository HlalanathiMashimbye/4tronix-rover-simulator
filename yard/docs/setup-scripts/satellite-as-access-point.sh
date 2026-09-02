#!/usr/bin/env bash
#
# Make the satellite serve the yard's wifi, instead of a laptop hotspot.
#
# The yard ran on a Windows laptop sharing "marsyard" over ICS: the laptop was
# the access point, the DHCP server and the gateway, so nothing in the yard
# worked unless somebody's laptop was open and in the room. This moves that job
# onto the satellite, which is the machine that is meant to be there anyway.
#
# ONE RADIO CANNOT BE BOTH. The satellite loses internet when it becomes the
# access point, and so does anything that joins it. Missions do not care: the
# yard talks to nothing but the rover, and Firestore was removed from it. What
# it does mean is that the operator uploads to YouTube from a device on some
# other network, and that nobody can SSH in from the internet to fix this
# afterwards. Hence everything below runs unattended.
#
# NOTHING TO CANCEL AFTERWARDS. An earlier version of this armed a rollback you
# had to cancel by hand within five minutes. That is wrong here: after the
# switch the person who would cancel it has no route to the machine, so the
# rollback would fire on a perfectly good access point and take the yard down
# with it. The rollback below instead CHECKS whether the access point actually
# came up, and reverts only if it did not. Success needs no human.
#
# Run it on the satellite:
#   sudo bash satellite-as-access-point.sh
#
set -euo pipefail

SSID="${SSID:-marsyard}"
PSK="${PSK:-curiousinternet}"
AP_ADDR="${AP_ADDR:-192.168.137.1/24}"
AP_CON="${AP_CON:-yard-ap}"
WIFI_DEV="${WIFI_DEV:-wlan0}"
CHECK_MIN="${CHECK_MIN:-3}"

if [[ $EUID -ne 0 ]]; then
    echo "Run this with sudo: sudo bash $0" >&2
    exit 1
fi

# The BSSID the rover is pinned to. The rover carries a connection locked to
# this exact address so that a laptop still broadcasting "marsyard" cannot
# quietly steal it: same name, different radio. Pinning the AP's MAC here is
# what makes that address a promise rather than a guess, because NetworkManager
# is otherwise free to hand the interface a generated one.
PERM_MAC="$(cat "/sys/class/net/${WIFI_DEV}/address")"

# Where to fall back to if the access point does not come up. Found rather than
# hardcoded: netplan names it, and the name carries a uuid on some images.
CLIENT_CON="$(nmcli -t -f NAME,TYPE con show \
    | awk -F: '$2=="802-11-wireless"{print $1}' \
    | grep -v "^${AP_CON}$" | head -1 || true)"

echo "== plan =="
echo "  device       : ${WIFI_DEV}"
echo "  serving      : ${SSID}, 2.4GHz channel 6, WPA2"
echo "  address      : ${AP_ADDR}"
echo "  BSSID        : ${PERM_MAC}   (the rover is pinned to this)"
echo "  falls back to: ${CLIENT_CON:-<none found>}"
echo

# ---- 1. The profile -------------------------------------------------------
# WPA2 only, band and channel pinned, all for the same reason: the rover is a
# Pi Zero W. It is 2.4GHz only, so a 5GHz access point is simply invisible to
# it, and it cannot complete a WPA3 handshake offered in a transition-mode
# beacon. None of these are defaults worth trusting.
nmcli con delete "${AP_CON}" >/dev/null 2>&1 || true
nmcli con add type wifi ifname "${WIFI_DEV}" con-name "${AP_CON}" \
    autoconnect no ssid "${SSID}" >/dev/null
nmcli con modify "${AP_CON}" \
    802-11-wireless.mode ap \
    802-11-wireless.band bg \
    802-11-wireless.channel 6 \
    802-11-wireless.cloned-mac-address "${PERM_MAC}" \
    802-11-wireless-security.key-mgmt wpa-psk \
    802-11-wireless-security.proto rsn \
    802-11-wireless-security.pairwise ccmp \
    802-11-wireless-security.group ccmp \
    802-11-wireless-security.psk "${PSK}" \
    ipv4.method shared \
    ipv4.addresses "${AP_ADDR}" \
    ipv6.method disabled \
    connection.autoconnect yes \
    connection.autoconnect-priority 20

# The client profile stays, at a lower priority, as the way back. With the
# laptop hotspot off it cannot connect to anything, which is fine - it is there
# for the recovery case, where somebody turns that hotspot back on.
if [[ -n "${CLIENT_CON}" ]]; then
    nmcli con modify "${CLIENT_CON}" \
        connection.autoconnect yes \
        connection.autoconnect-priority 0
fi

echo "== profile '${AP_CON}' written, autoconnect on =="

# ---- 2. The check that reverts only on real failure -----------------------
# systemd-run rather than a backgrounded sleep: this has to outlive the SSH
# session that is about to be cut, and a child of that session would die with
# it. The check is a no-op when the access point is up, so there is nothing to
# remember to cancel.
if [[ -n "${CLIENT_CON}" ]]; then
    cat > /usr/local/sbin/yard-ap-check <<CHECK
#!/usr/bin/env bash
# Revert to being a wifi client, but only if the access point never came up.
if nmcli -t -f NAME con show --active | grep -qx "${AP_CON}"; then
    logger -t yard-ap-check "access point is up, leaving it alone"
    exit 0
fi
logger -t yard-ap-check "access point did NOT come up, reverting to ${CLIENT_CON}"
nmcli con modify "${AP_CON}" connection.autoconnect no || true
nmcli con up "${CLIENT_CON}" || true
CHECK
    chmod +x /usr/local/sbin/yard-ap-check
    systemctl stop yard-ap-check.timer >/dev/null 2>&1 || true
    systemd-run --unit=yard-ap-check --on-active="${CHECK_MIN}min" \
        /usr/local/sbin/yard-ap-check >/dev/null
    echo "== safety check in ${CHECK_MIN} min: reverts ONLY if the AP failed =="
else
    echo "!! no client profile found - NO SAFETY CHECK ARMED."
fi

# ---- 3. The switch --------------------------------------------------------
cat <<BANNER

Bringing up the access point. This SSH session will drop now.

  1. Turn the laptop hotspot OFF and leave it off.
  2. Within a minute, "${SSID}" should appear in the wifi list on your phone.
     That is the whole test. If it never appears, turn the laptop hotspot back
     on and wait ${CHECK_MIN} minutes - the satellite reverts to it by itself.
  3. Join a device to "${SSID}" and open:
         http://mro.local:3001/        or   http://${AP_ADDR%/*}:3001/
  4. The rover joins on its own. It is pinned to this satellite's radio, so a
     laptop broadcasting the same name cannot take it.

There is nothing to cancel and nothing further to run. The access point is
already set to come back after a reboot.

BANNER

# Detached, so the switch is not killed halfway by its own SSH session dying.
systemd-run --unit=yard-ap-up --collect \
    /usr/bin/nmcli con up "${AP_CON}" >/dev/null

#!/usr/bin/env bash
#
# A flight recorder for the rover's wifi.
#
# THE PROBLEM THIS EXISTS FOR. The rover is only reachable over wifi, so the
# moment you switch it to the network you are trying to debug, you lose the
# ability to watch it. Every question you actually want answered - did it see
# the satellite, did it try, what did the satellite say back - happens inside
# the window where you cannot SSH in. Turning the laptop hotspot back on to
# regain access also destroys the condition you were testing.
#
# So this stops trying to watch live. Install it while the rover IS reachable,
# switch networks, let it run blind, then come back and read what it saw.
#
# WHAT IT RECORDS, every SAMPLE_SECS, to ROVER_LOG:
#   - which connection is active, and the device state
#   - every access point in scan range named SSID, with BSSID, channel, signal
#   - whether wifi power save is on (the documented cause of the rover going
#     unreachable one way after a few idle minutes)
#   - the tail of wpa_supplicant's own words, which is where association
#     rejections appear with a reason code
#
# It is deliberately dumb and append-only. No rotation, no network calls, no
# cleverness that could itself fail and take the evidence with it.
#
# INSTALL (on the rover, while it is on a network you can reach):
#   sudo bash rover-wifi-blackbox.sh install
#
# READ (after switching back to a network you can reach):
#   sudo bash rover-wifi-blackbox.sh read
#   sudo bash rover-wifi-blackbox.sh read 200      # last 200 lines
#
# REMOVE, once the fault is found:
#   sudo bash rover-wifi-blackbox.sh remove
#
set -euo pipefail

SSID="${SSID:-marsyard}"
WIFI_DEV="${WIFI_DEV:-wlan0}"
SAMPLE_SECS="${SAMPLE_SECS:-15}"
ROVER_LOG="${ROVER_LOG:-/var/log/rover-wifi-blackbox.log}"
COLLECTOR=/usr/local/sbin/rover-wifi-sample
UNIT=rover-wifi-blackbox

need_root() {
    if [[ $EUID -ne 0 ]]; then
        echo "Run this with sudo: sudo bash $0 ${1:-install}" >&2
        exit 1
    fi
}

install_recorder() {
    need_root install

    cat > "${COLLECTOR}" <<COLLECT
#!/usr/bin/env bash
# One sample of what the rover's wifi can see and is doing. Never fails hard:
# a missing tool must not stop the next sample being taken.
exec >>"${ROVER_LOG}" 2>&1
echo "===== \$(date -Is) ====="

echo "-- device --"
nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device 2>/dev/null | grep "^${WIFI_DEV}:" || echo "  no ${WIFI_DEV}"

echo "-- addresses --"
ip -brief addr show "${WIFI_DEV}" 2>/dev/null || true

echo "-- power save (on = the documented one-way-unreachable fault) --"
iw dev "${WIFI_DEV}" get power_save 2>/dev/null || echo "  iw unavailable"

echo "-- every '${SSID}' in range --"
# --rescan no: forcing a rescan every sample would itself disrupt association.
nmcli -t -f SSID,BSSID,CHAN,FREQ,SIGNAL,SECURITY,IN-USE device wifi list --rescan no 2>/dev/null \\
    | grep -i "${SSID}" || echo "  none visible"

echo "-- supplicant, last 15 lines --"
journalctl -u wpa_supplicant -n 15 --no-pager 2>/dev/null | tail -15 || echo "  unavailable"

echo "-- NetworkManager wifi lines, last 15 --"
journalctl -u NetworkManager -n 200 --no-pager 2>/dev/null \\
    | grep -iE "${WIFI_DEV}|${SSID}|assoc|supplicant|secrets" | tail -15 || echo "  unavailable"
COLLECT
    chmod +x "${COLLECTOR}"

    # A timer rather than a sleep loop: it survives the service being killed,
    # starts itself at boot, and cannot leave a runaway process behind.
    cat > /etc/systemd/system/${UNIT}.service <<UNITFILE
[Unit]
Description=Record what the rover's wifi can see

[Service]
Type=oneshot
ExecStart=${COLLECTOR}
UNITFILE

    cat > /etc/systemd/system/${UNIT}.timer <<TIMERFILE
[Unit]
Description=Sample the rover's wifi every ${SAMPLE_SECS}s

[Timer]
OnBootSec=20s
OnUnitActiveSec=${SAMPLE_SECS}s
AccuracySec=1s

[Install]
WantedBy=timers.target
TIMERFILE

    systemctl daemon-reload
    systemctl enable --now ${UNIT}.timer >/dev/null

    echo "Recording to ${ROVER_LOG} every ${SAMPLE_SECS}s, and after every reboot."
    echo
    echo "Now: switch the rover to the network you are testing and LEAVE IT."
    echo "Give it at least 10 minutes so an idle-timeout fault has time to show."
    echo "Then bring the rover back to a network you can reach and run:"
    echo "    sudo bash $0 read"
}

read_recorder() {
    need_root read
    local lines="${1:-120}"
    if [[ ! -f "${ROVER_LOG}" ]]; then
        echo "Nothing recorded yet at ${ROVER_LOG}." >&2
        exit 1
    fi
    echo "===== last ${lines} lines of ${ROVER_LOG} ====="
    tail -n "${lines}" "${ROVER_LOG}"
    echo
    echo "===== summary ====="
    echo -n "samples taken      : "; grep -c "^===== 2" "${ROVER_LOG}" || true
    echo -n "saw '${SSID}'      : "; grep -ci "${SSID}" "${ROVER_LOG}" || true
    echo -n "association rejects: "; grep -c "ASSOC-REJECT" "${ROVER_LOG}" || true
    echo -n "handshake failures : "; grep -ciE "4WAY|WRONG_KEY|pre-shared" "${ROVER_LOG}" || true
    echo -n "power save on      : "; grep -c "Power save: on" "${ROVER_LOG}" || true
}

remove_recorder() {
    need_root remove
    systemctl disable --now ${UNIT}.timer >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/${UNIT}.service /etc/systemd/system/${UNIT}.timer "${COLLECTOR}"
    systemctl daemon-reload
    echo "Recorder removed. ${ROVER_LOG} is left in place - delete it yourself when done."
}

case "${1:-install}" in
    install) install_recorder ;;
    read)    read_recorder "${2:-120}" ;;
    remove)  remove_recorder ;;
    *) echo "usage: sudo bash $0 [install|read [lines]|remove]" >&2; exit 1 ;;
esac

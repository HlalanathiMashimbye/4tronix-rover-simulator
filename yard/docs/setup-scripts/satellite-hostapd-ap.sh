#!/usr/bin/env bash
#
# Serve the yard's wifi with hostapd instead of NetworkManager's AP mode.
#
# WHY THIS EXISTS, and it is not a preference.
#
# satellite-as-access-point.sh makes NetworkManager serve "marsyard". That
# access point works: a MacBook, a Samsung A05s and an iPhone each associated,
# completed the four-way handshake and took a DHCP lease in about one second.
# The rover cannot join it at all. Measured 8 September 2026, with the rover
# FIVE CENTIMETRES from the satellite and seeing it at signal 100, five
# consecutive attempts:
#
#   wlan0: Trying to associate with 88:a2:9e:05:50:21 (SSID='marsyard' freq=2437 MHz)
#   wlan0: CTRL-EVENT-ASSOC-REJECT ... status_code=16
#
# Status 16 is "timeout waiting for the next frame in sequence". The rover
# raises it itself when the access point never answers its authentication
# frame. Authentication happens BEFORE any WPA2 negotiation, so this is not the
# key, the cipher, PMF or fast transition. The satellite's logs show no record
# of the rover's MAC at all, across its whole uptime.
#
# The same rover joins a Windows laptop hotspot and two different Android phone
# hotspots without trouble, including one deliberately put on channel 6. So the
# rover is not fragile and channel 6 is not the problem.
#
# What is unusual here is the satellite. A phone hotspot and a travel router
# are purpose-built access points that advertise as little as possible, because
# a hotspot that refuses somebody's cheap gadget is a support call.
# wpa_supplicant's AP mode is a minimal access point that grew out of the
# Wi-Fi Direct code, gives almost no control over the beacon, and inherits
# whatever capabilities a 6.18 kernel and a Pi 5 radio advertise. The rover is
# a 2016 Pi Zero W. It is the only client in the yard that predates most of
# them.
#
# hostapd is the real implementation and lets the beacon be pinned to something
# a 2016 client certainly understands: plain 802.11g, no HT, WPA2-PSK with CCMP
# and nothing else. That is what a phone hotspot looks like on the air, and the
# rover already works with three of those.
#
# AN EARLIER FIX WAS REAL BUT INCOMPLETE. The NetworkManager script sets
# pmf 1 (disabled) and documents this same status_code=16 as the reason. PMF
# was a genuine cause and disabling it was correct. The symptom came back with
# PMF already off, and everyone reasonably assumed that box was ticked. If this
# script is ever revisited, treat "we fixed that before" as a hypothesis.
#
#   sudo bash satellite-hostapd-ap.sh            # switch to hostapd
#   sudo bash satellite-hostapd-ap.sh --revert   # put NetworkManager back
#
set -euo pipefail

SSID="${SSID:-marsyard}"
AP_ADDR="${AP_ADDR:-192.168.137.1}"
AP_CIDR="${AP_CIDR:-24}"
DHCP_FROM="${DHCP_FROM:-192.168.137.50}"
DHCP_TO="${DHCP_TO:-192.168.137.200}"
CHANNEL="${CHANNEL:-6}"
COUNTRY="${COUNTRY:-ZA}"
WIFI_DEV="${WIFI_DEV:-wlan0}"
NM_AP_CON="${NM_AP_CON:-yard-ap}"
CHECK_MIN="${CHECK_MIN:-3}"

if [[ $EUID -ne 0 ]]; then
    echo "Run this with sudo: sudo bash $0 ${1:-}" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Revert
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--revert" ]]; then
    echo "== reverting to NetworkManager's access point =="
    systemctl disable --now hostapd yard-ap-ip 2>/dev/null || true
    rm -f /etc/dnsmasq.d/yard-ap.conf
    systemctl restart dnsmasq 2>/dev/null || true
    rm -f /etc/NetworkManager/conf.d/99-yard-unmanaged.conf
    systemctl reload NetworkManager
    sleep 3
    nmcli con up "${NM_AP_CON}" || true
    echo "== reverted. '${NM_AP_CON}' should be serving ${SSID} again =="
    exit 0
fi

# ---------------------------------------------------------------------------
# The passphrase comes from the access point that already exists
# ---------------------------------------------------------------------------
# Read rather than asked for or hardcoded. Two copies of a wifi password is how
# the rover ends up holding one the access point does not use, and that failure
# looks identical to this one from the outside.
PSK="$(nmcli -s -g 802-11-wireless-security.psk con show "${NM_AP_CON}" 2>/dev/null || true)"
if [[ -z "${PSK}" ]]; then
    echo "Could not read the passphrase from the '${NM_AP_CON}' connection." >&2
    echo "Set it explicitly:  sudo PSK=... bash $0" >&2
    exit 1
fi
if [[ ${#PSK} -eq 64 ]]; then
    echo "The stored key is a 64-hex PMK, which hostapd needs as wpa_psk." >&2
    USE_RAW_PSK=1
else
    USE_RAW_PSK=0
fi

echo "== plan =="
echo "  device   : ${WIFI_DEV}"
echo "  serving  : ${SSID}, 802.11g only, channel ${CHANNEL}, WPA2-PSK/CCMP"
echo "  address  : ${AP_ADDR}/${AP_CIDR}, DHCP ${DHCP_FROM}-${DHCP_TO}"
echo "  reverts  : automatically after ${CHECK_MIN} min if hostapd is not up"
echo

# ---------------------------------------------------------------------------
# 1. hostapd
# ---------------------------------------------------------------------------
if ! command -v hostapd >/dev/null; then
    echo "== installing hostapd =="
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq hostapd
fi

# ieee80211n=0 and wmm_enabled=0 are the whole point of this file.
#
# HT (802.11n) capabilities in the beacon are the most likely thing the rover's
# 2016 firmware mishandles, and WMM is required for HT so it goes too. The cost
# is a slower link, capped around 54 Mbps. The yard sends rover commands and a
# JPEG stream, so it does not care, and a link that works slowly beats one that
# does not associate.
#
# auth_algs=1 is Open System only. Shared Key is a WEP relic and offering both
# gives an old client one more thing to get wrong at exactly the stage that is
# failing.
#
# No ieee80211w line at all: absent means PMF disabled, which is what the rover
# needs and what NetworkManager's pmf 1 was already doing.
cat > /etc/hostapd/hostapd.conf <<CONF
interface=${WIFI_DEV}
driver=nl80211
ssid=${SSID}
country_code=${COUNTRY}
ieee80211d=1
hw_mode=g
channel=${CHANNEL}
ieee80211n=0
wmm_enabled=0
auth_algs=1
ignore_broadcast_ssid=0
macaddr_acl=0
wpa=2
wpa_key_mgmt=WPA-PSK
wpa_pairwise=CCMP
rsn_pairwise=CCMP
CONF

if [[ "${USE_RAW_PSK}" == "1" ]]; then
    echo "wpa_psk=${PSK}" >> /etc/hostapd/hostapd.conf
else
    echo "wpa_passphrase=${PSK}" >> /etc/hostapd/hostapd.conf
fi
chmod 600 /etc/hostapd/hostapd.conf

sed -i 's|^#*DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd 2>/dev/null || true

# ---------------------------------------------------------------------------
# 2. Take the radio off NetworkManager
# ---------------------------------------------------------------------------
# NetworkManager and hostapd both driving one interface is a fight neither
# wins: NM tears the interface down to reconfigure it while hostapd is
# beaconing on it. Marked unmanaged by device name rather than by disabling NM,
# because NM still owns eth0, which is the satellite's internet and the way
# back in when the wifi is wrong.
cat > /etc/NetworkManager/conf.d/99-yard-unmanaged.conf <<UNMANAGED
[keyfile]
unmanaged-devices=interface-name:${WIFI_DEV}
UNMANAGED

nmcli con modify "${NM_AP_CON}" connection.autoconnect no 2>/dev/null || true

# ---------------------------------------------------------------------------
# 3. The address, and DHCP
# ---------------------------------------------------------------------------
# Its own unit rather than a line in hostapd's: unmanaged means nobody assigns
# this address, and hostapd will happily beacon on an interface with no IP,
# which looks like a working access point that hands out nothing.
cat > /etc/systemd/system/yard-ap-ip.service <<UNIT
[Unit]
Description=Address for the yard access point
Before=hostapd.service
Wants=hostapd.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/sbin/ip link set ${WIFI_DEV} up
ExecStart=/sbin/ip addr replace ${AP_ADDR}/${AP_CIDR} dev ${WIFI_DEV}

[Install]
WantedBy=multi-user.target
UNIT

# bind-interfaces so this instance cannot answer on eth0. Without it dnsmasq
# binds the wildcard and a second DHCP server appears on whatever network the
# satellite is plugged into, which is somebody else's very bad afternoon.
cat > /etc/dnsmasq.d/yard-ap.conf <<DNS
interface=${WIFI_DEV}
bind-interfaces
dhcp-range=${DHCP_FROM},${DHCP_TO},12h
dhcp-option=option:router,${AP_ADDR}
dhcp-option=option:dns-server,${AP_ADDR}
DNS

systemctl daemon-reload
systemctl unmask hostapd 2>/dev/null || true
systemctl enable yard-ap-ip hostapd >/dev/null
systemctl reload NetworkManager
sleep 2
systemctl restart yard-ap-ip
systemctl restart hostapd
systemctl restart dnsmasq

# ---------------------------------------------------------------------------
# 4. Revert only on real failure
# ---------------------------------------------------------------------------
# Same shape as satellite-as-access-point.sh, and for the same reason: after
# this runs, whoever would cancel a rollback may have no route to the machine.
# So the check reverts only if hostapd is genuinely not running. A working
# access point with no clients yet is not a failure.
# Quoted heredoc: this file must reach disk verbatim. Unquoted, the $0 below
# expands to THIS script's path while it is being written, and the check would
# later re-run the installer instead of the revert.
cat > /usr/local/sbin/yard-hostapd-check <<'CHECK'
#!/usr/bin/env bash
if systemctl is-active --quiet hostapd; then
    logger -t yard-hostapd-check "hostapd is up, leaving it alone"
    exit 0
fi
logger -t yard-hostapd-check "hostapd is NOT up, reverting to NetworkManager"
bash /usr/local/sbin/yard-hostapd-revert
CHECK
cat > /usr/local/sbin/yard-hostapd-revert <<REVERT
#!/usr/bin/env bash
systemctl disable --now hostapd yard-ap-ip 2>/dev/null || true
rm -f /etc/dnsmasq.d/yard-ap.conf /etc/NetworkManager/conf.d/99-yard-unmanaged.conf
systemctl restart dnsmasq 2>/dev/null || true
systemctl reload NetworkManager
sleep 3
nmcli con modify "${NM_AP_CON}" connection.autoconnect yes || true
nmcli con up "${NM_AP_CON}" || true
REVERT
chmod +x /usr/local/sbin/yard-hostapd-check /usr/local/sbin/yard-hostapd-revert
systemd-run --on-active="${CHECK_MIN}m" --unit=yard-hostapd-check \
    /usr/local/sbin/yard-hostapd-check >/dev/null 2>&1 || true

echo
echo "== status =="
systemctl is-active hostapd  | sed 's/^/  hostapd : /'
systemctl is-active dnsmasq  | sed 's/^/  dnsmasq : /'
ip -brief addr show "${WIFI_DEV}" | sed 's/^/  addr    : /'
echo
echo "The beacon is now plain 802.11g, WPA2-PSK/CCMP, no HT, no PMF, no FT."
echo "Power-cycle the rover next to the satellite and watch:"
echo "  sudo journalctl -fu hostapd | grep -i b8:27:eb"

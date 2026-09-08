# Handover: getting the rover onto the satellite

**To:** Konke
**From:** Hlalanathi
**Status:** unsolved. Everything below is what is known, what is ruled out, and
the one technique that makes the problem observable at all.

---

## Status, 8 September 2026

**Not resolved.** An earlier version of this section was headed "RESOLVED" and
was wrong. What it got right is kept below, because the reasoning is still
sound and only the evidence under it was bad.

### The retracted claim

That section rested on five consecutive attempts with the rover "five
centimetres from the satellite, seeing it at signal 100". **The rover was
powered off for that test.** Its own journal recorded no disconnect, because
there was nothing connected to disconnect. The measurement was void, and so was
the conclusion drawn from it.

What survives: the `status_code=16` captures are real, they came from earlier
runs, and the reading of them holds.

```
wlan0: Trying to associate with 88:a2:9e:05:50:21 (SSID='marsyard' freq=2437 MHz)
wlan0: CTRL-EVENT-ASSOC-REJECT bssid=00:00:00:00:00:00 status_code=16
```

Status 16 is "timeout waiting for the next frame in sequence", raised by the
ROVER when the access point never answers its authentication frame. The
all-zero BSSID means wpa_supplicant generated the failure locally rather than
receiving a reject frame. Authentication precedes all WPA2 negotiation, so the
key, the cipher, PMF and fast transition cannot be the cause. `freq=2437` is
also proof the rover heard the satellite's beacon at that moment: a client
cannot report a frequency for a network it cannot hear.

### Why the satellite cannot diagnose this on its own

This is the most useful thing learned, and it invalidates most of the method
used before it.

```
$ readlink -f /sys/class/net/wlan0/device/driver
/sys/bus/sdio/drivers/brcmfmac
```

**brcmfmac is FullMAC.** Authentication and association are handled inside the
chip firmware, not by hostapd. With `driver=nl80211` on a FullMAC part, hostapd
only hears about a client after the firmware has already accepted it. So "the
satellite's logs contain no record of the rover's MAC" does **not** mean the
rover's frames never arrived. The firmware can drop them and nothing on the
satellite will ever say so.

Nearly every experiment in this document was a satellite-side change judged by
a satellite-side test that is structurally incapable of seeing the fault. That
is why so many came back inconclusive. **Measure at the rover.**

### What is built and working

`setup-scripts/satellite-hostapd-ap.sh` replaces NetworkManager's AP mode with
hostapd, on a beacon pinned to plain 802.11g: no HT, no WMM, WPA2/CCMP only,
`wpa_key_mgmt=WPA-PSK WPA-PSK-SHA256`. It works, for other clients, verified in
the satellite's own journal:

```
09:17:31  STA e6:2e:aa:76:e5:7a  WPA: pairwise key handshake completed (RSN)
09:18:01  STA 4e:08:7f:77:8c:96  WPA: pairwise key handshake completed (RSN)
```

Both took DHCP leases. A MacBook, an iPhone and a Samsung A05s have all
associated with it.

**The rover has never been observed attempting to join it.** Every rover
observation in this document was taken against NetworkManager's AP mode. The
hostapd work may well be the fix; it is untested against the one client it was
written for. That is the gap.

---

## Next actions, in order

**1. Run the flight recorder.** Nothing else should happen first. It answers
three open questions in one pass: does the rover see the satellite's beacon,
at what signal, and what does wpa_supplicant say when it tries.

```bash
# rover on the laptop hotspot
scp yard/docs/setup-scripts/rover-wifi-blackbox.sh mars@curiosity.local:/tmp/
ssh mars@curiosity.local 'sudo bash /tmp/rover-wifi-blackbox.sh install'
# laptop hotspot OFF, hostapd up, a phone joined so the check keeps it alive
# rover powered ON within a metre of the satellite, left 5 minutes
# laptop hotspot ON again, wait for the rover
ssh mars@curiosity.local 'sudo bash /tmp/rover-wifi-blackbox.sh read 200'
```

Then branch on what it shows:

| Reading | Conclusion |
|---|---|
| `88:a2:9e:05:50:21` never appears in any scan | The beacon does not reach the rover. Radio or range, not configuration. Stop editing `hostapd.conf`. |
| Appears, weak (worse than about -75 dBm at a metre) | Link budget. The Pi 5's internal antenna is the suspect, and an external adapter becomes the honest answer. |
| Appears strong, association still fails | The association path. wpa_supplicant's tail in the same log names the reason, and it is the first time we will have that under hostapd. |

**2. Take `ieee80211n=0` back out** once the rover joins. It is the most
conservative beacon setting and it has a cost: wpa_supplicant ranks candidate
BSSIDs for one SSID by estimated throughput once signal is adequate, so an
802.11g-only satellite loses to any HT-capable laptop hotspot **regardless of
which is closer**. That is why the rover walked past the satellite to the
laptop with both up. It is a confound in every side-by-side test taken while it
was set, and it must not ship.

**3. Open the PR** for `fix/satellite-hostapd-ap` once there is a rover
observation to put in it.

---

## Dead ends, confirmed so we stop revisiting them

| Checked | Result |
|---|---|
| **David's original repo** (`4tronix-rover-simulator-main`) | Contains **no access point configuration at all**. Zero matches for hostapd, dnsmasq, `802-11-wireless.mode`, `nmcli con add`, `ipv4.method shared`. `mars-relay-network` appears four times and every one is "make sure everything is on the same wifi", never a thing the repo builds. If the satellite ever served that SSID, the config was made by hand and died with the reflash. **We are not restoring a known-good setup, we are the first to build one.** |
| **Regulatory domain** | Global domain is `ZA` and `raspi-config` agrees, but `phy#0` is self-managed and reports `country 99`, Broadcom's internal world table (the giveaway is the `2474 - 2494` row, which is channel 14 and exists only in Japan). Non-blocking: that table permits 2402-2482 with no `NO-IR` flag, so channel 6 beacons legally. It does explain the nonsense `txpower 31.00 dBm` reading, which is above the table's own 20 dBm cap. |
| **`nmcli device wifi hotspot`** | This is NetworkManager AP mode, which is what `satellite-as-access-point.sh` already builds, in a more careful form (band and channel pinned, `proto rsn`, `pairwise ccmp`, `pmf 1`). It is the configuration the `status_code=16` failures were recorded against. Running the one-liner is a step backwards. |
| **The official Raspberry Pi networking docs** | Cover joining networks, not serving one. No AP guidance in them. |

One live difference from the working laptop hotspot, parked rather than
dismissed: `ieee80211d=1` puts a Country IE in our beacon and Windows ICS does
not send one. NetworkManager's AP mode does not send one either and also
failed, so it cannot be the whole story, but it is untried.

---

## The problem in one paragraph

The rover joins `marsyard` when a Windows laptop is serving it, reliably. The
rover does **not** join `marsyard` when the Raspberry Pi satellite is serving
it. Same network name, same password. That is the whole bug.

## Why the name is the same on purpose

This is the part worth protecting, because the obvious "fix" destroys it.

The rover is not tied to a device. It is tied to a **name**. Anything that
serves a network called `marsyard` with the password `curiousinternet` becomes
the yard, and the rover joins it without being told anything:

- normally the satellite serves it
- if the satellite dies, a laptop hotspot serves it and the rover follows
- at a venue with neither, somebody's phone serves it and the rover follows

That property is why the rover has never needed reflashing to move between
sites. **Do not pin the rover to a BSSID, a MAC, or a specific device to make
this work.** That was tried, it does work, and it was deliberately reverted -
it couples the rover to one radio, so replacing the satellite's wifi card
strands it, and it throws away the only reason the naming scheme exists. If a
fix requires the rover to know which machine is serving `marsyard`, it is the
wrong fix.

See [yard-network.md](yard-network.md) for the full design.

---

## The thing that makes this hard

**You cannot watch the failure while it happens.**

The rover has no screen, no ethernet, and no serial console set up. The only
way in is SSH over wifi. So:

- To reach the rover, it must be on the laptop hotspot.
- To reproduce the bug, it must be trying to join the satellite.
- Those are mutually exclusive, and turning the hotspot on to regain access
  destroys the condition you were testing.

Worse, both cannot be on at once. Two access points serving the same name with
the same password are not a conflict to a client - they look like **one roaming
network**, and the rover silently picks whichever is stronger. So "just leave
the laptop on as a backdoor" produces a rover that may be on either one, and
you will not know which. Never run both.

### The way around it: record, switch, retrieve

`setup-scripts/rover-wifi-blackbox.sh` installs a flight recorder on the rover.
It samples every 15 seconds - what it can see, what it is associated to,
whether power save is on, and what wpa_supplicant actually said - and appends
to a file. It survives reboots.

The loop is:

1. Rover on the **laptop hotspot**. SSH in, install the recorder.
2. Turn the laptop hotspot **off**. The rover is now blind to you, and trying
   to find the satellite. Leave it at least 10 minutes.
3. Turn the laptop hotspot **back on**. Wait for the rover to reappear.
4. SSH in and read the recording. It contains the window you could not watch.

That is the core technique. Everything below is what to look for in step 4.

---

## What is already ruled out

Do not spend time re-testing these. Each cost hours.

| Ruled out | Evidence |
|---|---|
| **Wrong password** | Failure was at *association*, which happens before the password is exchanged. A wrong key fails later, at the four-way handshake, and says so. |
| **Protected Management Frames** | Was a real cause and disabling it was correct: the AP sets `pmf 1`. NOT the whole story. The identical `status_code=16` returned with PMF already off, and everyone reasonably assumed that box was ticked. Treat "we fixed that before" as a hypothesis. |
| **Wrong password** (again, properly) | The rover's stored key is a 64-hex PMK equal to `PBKDF2("curiousinternet", "marsyard")`, verified by hash. And status 16 happens before the key is used. |
| **5GHz / wrong band** | The Pi Zero W is 2.4GHz only. The AP is pinned to band `bg`, channel 6. |
| **WPA3 / SAE** | AP is forced WPA2-only: `proto rsn`, `pairwise ccmp`, `group ccmp`. |
| **The AP being broken generally** | An iPhone, a Samsung and a MacBook have all associated with it and completed the four-way handshake. It works for other clients. |
| **A BSSID pin on the rover** | Was added, then deliberately removed. The rover's profile is unpinned. Do not re-add it. |

## What is NOT ruled out, in the order I would check

### 0. Range, which this document wrongly claimed was ruled out

The row said "tested at five centimetres". That test is worthless: the rover
was powered off for it, which its own journal shows - no disconnect was ever
recorded, because there was nothing to disconnect. It was retracted verbally
and the row was left standing, which is the worse of the two mistakes.

So range is open. The Pi 5's internal antenna has a small footprint, no MIMO
and no beam steering, and Raspberry Pi's own forums describe the onboard radio
as a "mini-AP" suited to a handful of nearby devices. A phone with a far better
antenna and far more aggressive retry behaviour joining happily says less about
the link budget than it appears to.

Re-test it properly: rover powered ON, confirmed drawing power, within a metre
of the satellite, with the laptop hotspot OFF so there is nothing else to join.


### 1. Is the rover even trying?

The last time this was captured, the satellite's logs contained **no mention of
the rover's MAC at all** - not a failed association, nothing. The rover was not
knocking. At the time that was explained by a flat battery, and a Pi Zero W
browning out loses its radio first.

So establish this before anything else, from the recording:

- Does `marsyard` appear in the rover's scan results at all while the satellite
  is serving it? If not, this is **range or radio**, not configuration. The Pi
  Zero W has a weak antenna. Put the rover next to the satellite and retry.
- If it appears but there is no association attempt, look at signal strength in
  the samples.

Cross-check from the satellite side, which *is* observable live (see below):

```bash
journalctl -b --no-pager | grep -i "b8:27:eb"      # the rover's MAC prefix
journalctl -b --no-pager | grep -oE "AP-STA-CONNECTED [0-9a-f:]+" | sort -u
```

### 2. Is it associating and then being dropped?

Reported symptom, not yet confirmed against the satellite: *"connects to the
laptop then drops after a certain time."*

That is the fingerprint of a **documented** fault - see the "Wi-Fi power save"
section of [bring-up.md](bring-up.md). A Pi Zero W with power save on sleeps its
radio when idle and stops answering ARP. It does not actually disconnect: from
the rover's own side everything looks fine, but nothing else can reach it. It
looks exactly like "it dropped".

The recorder captures `Power save: on` in every sample, so this is answered
directly. The fix, and making it survive a reboot:

```bash
sudo iw dev wlan0 set power_save off
printf '[connection]\nwifi.powersave = 2\n' | \
  sudo tee /etc/NetworkManager/conf.d/10-no-wifi-powersave.conf
```

This was applied once during bring-up. It may not have survived a reflash.
**Check whether that file exists before assuming it is in place.**

Be careful not to conflate two faults. "Cannot join the satellite" and "drops
off the laptop after a while" may be entirely separate problems, and the second
one being real does not mean it explains the first.

### 3. Does the rover's profile still say what we think?

```bash
sudo nmcli connection show preconfigured | grep -iE "ssid|autoconnect|bssid|key-mgmt|psk"
```

Expected: ssid `marsyard`, autoconnect yes, key-mgmt `wpa-psk`, **bssid empty**.
A non-empty bssid means the pin came back - remove it, do not work around it.

Also check nothing else is competing:

```bash
nmcli -t -f NAME,TYPE,AUTOCONNECT connection show
```

There should be exactly one wifi profile. Extra saved networks are how a rover
ends up on somebody's phone hotspot instead.

### 4. Compare the two access points directly

Still unrun on the rover side, which is the half that matters. The rover joins
one access point and not the other, so **diff them** as the rover sees them. From any laptop, with each one serving
in turn:

```bash
nmcli device wifi list --rescan yes | grep -i marsyard
```

Note channel, security column, and signal for each. Then, more precisely, from
the rover itself while each is up:

```bash
sudo iw dev wlan0 scan | grep -A 25 -i marsyard
```

Look at the RSN/WPA information elements: cipher suites, AKM suites, and the
capabilities field. Whatever differs between the laptop's beacon and the
satellite's beacon is almost certainly the answer, because that difference is
the only thing the rover is reacting to.

---

## Switching between the two: the discipline

Getting this wrong wastes a whole session, so be strict about it.

**Only one thing serves `marsyard` at a time.** Never both.

**To debug the rover** (SSH access, install things, read the recorder):
1. Laptop hotspot **on**.
2. Wait for the rover to appear: `ping curiosity.local`.
3. Do the work.

**To test the satellite** (reproduce the bug):
1. Laptop hotspot **off**. Confirm it is off - not just disconnected.
2. Satellite serves `marsyard` on its own.
3. Do NOT "wait 10 minutes and see". That advice was here for a year and it
   made this unfalsifiable. Each failure doubles wpa_supplicant's backoff and
   blacklists a BSSID for up to 600 seconds, so after a few minutes the rover
   is sitting silent and you conclude it will not join. Force ONE attempt and
   read the supplicant log, which says exactly what happened:

   ```bash
   sudo nmcli con modify preconfigured 802-11-wireless.bssid <ap-bssid>
   sudo nmcli con up preconfigured
   sudo journalctl -u wpa_supplicant -n 30 --no-pager
   sudo nmcli con modify preconfigured 802-11-wireless.bssid ""
   ```

**The satellite is observable throughout**, which the rover is not. Plug the
satellite into ethernet and it keeps serving `marsyard` on wifi while being
reachable over the wired LAN, with internet. That is the one asymmetry in your
favour: you can watch the access point live even while the rover is dark.

```bash
ssh mars@mro.local
journalctl -f -u NetworkManager        # watch association attempts arrive
ip neigh show dev wlan0                # who is actually on the network
```

---

## Ground truth

| | |
|---|---|
| Network name | `marsyard` |
| Password | `curiousinternet` |
| Satellite | Raspberry Pi 5, hostname `mro`, user `mars` |
| Satellite AP address | `192.168.137.1`, console at `http://mro.local:3001/` |
| **Address collision, read this** | `192.168.137.1` is ALSO the fixed gateway Windows Internet Connection Sharing uses. The satellite picks it deliberately so nothing else has to change, but it means pinging `192.168.137.1` does not tell you which machine answered. Check the gateway's MAC instead: `88:a2:9e:...` is the satellite, a locally-administered address like `ba:d5:...` is a laptop or phone hotspot. |
| Satellite wifi MAC | `88:A2:9E:05:50:21`, channel 6 (2437 MHz), 20 MHz, 2.4GHz, WPA2, PMF off. The OUI is a Raspberry Pi allocation, checked: this is the onboard radio, not a dongle. |
| Satellite wifi driver | `brcmfmac` on SDIO. **FullMAC**, so association happens in firmware and hostapd cannot see a client the firmware rejected. |
| Rover | Raspberry Pi Zero W, hostname `curiosity`, user `mars` |
| Rover MAC prefix | `b8:27:eb:` |
| Rover service | port 8523, `curl http://curiosity.local:8523/health` |
| Rover wifi profile | `preconfigured`, unpinned, autoconnect |

Sudo differs between the two machines, which is confusing until you know:

- **Rover:** passwordless sudo for everything.
- **Satellite:** sudo needs a password, except specific systemctl commands.
  Restarts must be **two separate commands** - `systemctl restart a b` matches
  no sudoers rule and silently prompts for a password:
  ```bash
  sudo systemctl restart satellite-web
  sudo systemctl restart satellite-camera
  ```

## Keeping the satellite current

The satellite runs from a git checkout and has repeatedly been found serving
stale code, which produces faults that exist nowhere in the repository. Check
before debugging anything:

```bash
ssh mars@mro.local 'cd ~/4tronix-rover-simulator && git log --oneline -1 && git status --porcelain'
```

`git status` must be **empty**. Do not `scp` single files onto it - that is how
it ended up in a state matching no commit. Push a branch and check it out.

---

## A prompt for Claude

Paste this at the start of a session, with the repo open:

> I am debugging why a Raspberry Pi Zero W ("the rover", hostname `curiosity`,
> user `mars`) will not join a wifi network called `marsyard` served by a
> Raspberry Pi 5 ("the satellite", hostname `mro`, user `mars`), even though it
> joins a Windows laptop hotspot with the same name and password
> (`curiousinternet`) reliably.
>
> Read `yard/docs/rover-join-handover.md` first. It has the full context, what
> is already ruled out, and the ground truth for both machines. Also read
> `yard/docs/yard-network.md` for why the network name is deliberately not tied
> to a device.
>
> Constraints you must work within:
>
> - The rover is only reachable over wifi, so I can only SSH it while the
>   laptop hotspot is on. I cannot watch it while it tries to reach the
>   satellite. Use `yard/docs/setup-scripts/rover-wifi-blackbox.sh` for that
>   window - install it while the rover is reachable, I switch networks, then
>   we read the recording afterwards.
> - Only one device may serve `marsyard` at a time. Ask me to switch, and wait
>   for me to confirm; do not assume a switch happened.
> - The satellite is reachable over ethernet while it serves wifi, so its logs
>   are live-observable. Prefer evidence from there over guessing.
> - Do not pin the rover to a BSSID or a specific device. That breaks the
>   design on purpose and was already reverted once.
>
> Do not re-test what the handover lists as ruled out. Start by establishing
> whether the rover is even attempting to associate, since the last capture
> showed no trace of its MAC in the satellite's logs at all.
>
> Tell me what evidence you want before you change anything, and tell me
> explicitly when you need me to switch networks and which way.

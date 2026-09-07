# Handover: getting the rover onto the satellite

**To:** Konke
**From:** Hlalanathi
**Status:** unsolved. Everything below is what is known, what is ruled out, and
the one technique that makes the problem observable at all.

**Updated 7 September, by Konke.** The rover has been reflashed since this was
written and its wifi was rebuilt by hand afterwards, so some of what follows
describes an install that no longer exists. Read "Update, 7 September" before
trusting the ruled-out table. The problem itself is still open.

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

## Update, 7 September

### A BSSID pin had been re-added

The rover had **two** profiles for `marsyard`, not one:

```
yard-satellite   bssid 88:A2:9E:05:50:21   autoconnect-priority 20
preconfigured    bssid --                  autoconnect-priority 0
```

Nothing in this repository creates `yard-satellite`. It was added by hand after
the reflash - the pin this document tells you not to re-add, back again,
because whoever rebuilt the rover had no reason to know that.

It is worth recognising how it fails, because it does not look like a pin
problem. With the satellite not beaconing, NetworkManager still auto-activates
the pinned profile first - it has the higher priority - and spends 25 seconds
failing to associate with a BSSID that is not on the air before falling back:

```
policy: auto-activating connection 'yard-satellite'
device (wlan0): supplicant interface state: associating -> disconnected     (x5)
device (wlan0): Activation: (wifi) association took too long
device (wlan0): Activation: failed for connection 'yard-satellite'
device (wlan0): supplicant interface state: associating -> 4way_handshake
device (wlan0): Connected to wireless network "marsyard"
```

The last two lines are `preconfigured` succeeding, two seconds after the pinned
profile gave up. So the rover worked - it just went deaf for half a minute
first, every time NetworkManager re-evaluated. That is a better account of the
"connects to the laptop then drops" report in section 2 than power save, which
is off. Note also what is *absent*: no `status_code=16`, so this is not the PMF
fault, however much it resembles it.

Removed with `nmcli connection delete yard-satellite`. Check for it again after
any reflash.

### The two access points are indistinguishable by address

Both the satellite and a Windows ICS hotspot serve the yard on
**192.168.137.1** - the satellite took that address deliberately, so that
nothing needed reconfiguring when the yard moved off the laptop. The
consequence is that the gateway tells you nothing about which one you are on,
and most of a session went into debugging "the satellite" that was a laptop
hotspot throughout.

BSSID and channel are what separate them:

| | BSSID | Channel |
|---|---|---|
| Satellite | `88:a2:9e:05:50:21` | 6 |
| Windows ICS hotspot | locally administered, varies per session | whatever Windows picks |

```bash
iw dev wlan0 link                # on the rover
netsh wlan show interfaces       # on Windows
```

A `marsyard` on any channel but 6 is not the satellite. Check this before
concluding anything at all, including that the bug reproduced.

### The satellite can quietly stop being an access point

`satellite-as-access-point.sh` arms a check that reverts to client mode if the
access point never came up. That revert is **permanent** - it sets
`connection.autoconnect no` on `yard-ap` and nothing re-arms it - so a single
transient failure leaves the satellite booting as a client from then on,
silently, until somebody re-runs the script by hand. If `marsyard` is simply
not on the air, look here first:

```bash
journalctl -t yard-ap-check
nmcli -t -f NAME,TYPE,AUTOCONNECT,AUTOCONNECT-PRIORITY connection show
```

### Anything ruled out before the reflash needs re-checking

The table below was written against an install that no longer exists. The
entries resting on rover-side configuration are the ones to distrust. Host keys
are generated on first boot, so they date the reflash:

```bash
ls -l --time-style=long-iso /etc/ssh/ssh_host_ed25519_key
```

### Where it stands

With the pin removed and the satellite serving `marsyard` correctly on
`88:a2:9e:05:50:21` channel 6, two other devices joined it and the rover did
not appear on it at all. So the pin was a real fault masking the original one,
and removing it puts you back at exactly the problem this handover describes -
with several suspects now properly eliminated rather than assumed.

The rover's own software survived the reflash: `/health` reports
`RealRoverDriver`, `hardware: true`, `processor_alive: true`. The camera did
not - it reports `detected: false`, which is almost certainly the reflash and
is a separate job.

### What to do next

In this order. The first is a process point rather than a test, and skipping it
costs a whole session:

1. **Install the flight recorder before switching networks.** The rover is only
   reachable with the hotspot on, and turning it on ends the test. Plan the
   session backwards: get in, install, switch, wait, switch back, read. Check
   whether it is already there rather than assuming - nobody recorded whether
   it survived the reflash.
2. **Confirm which access point is serving `marsyard`,** by BSSID and channel.
3. **Ask the satellite whether the rover is knocking at all,** with the
   `journalctl` grep in section 1. This splits the problem in half and nothing
   else does. A MAC that appears is a negotiation fault the logs will name; a
   MAC that appears nowhere is range or power, and no amount of reconfiguring
   will help.
4. **Fresh batteries, and the rover 30cm from the satellite.** Minutes to do,
   nothing to undo, and it addresses the two most likely remaining causes.
5. **Then the beacon diff in section 4,** which is still the highest-value
   experiment in this document and has still never been run.

### Do not reflash the rover to fix this

It is a tempting move and it does not follow. On 7 September the rover
completed a full WPA2 four-way handshake against a laptop hotspot in two
seconds: the `brcmfmac` driver, the firmware, wpa_supplicant and NetworkManager
all demonstrably work, and a fresh image ships the same driver and the same
firmware. Reflashing replaces software that is not broken.

What it does do is destroy a working `rover-server`, the I2C and SPI setup and
the power-save fix, and leave somebody rebuilding the wifi by hand under time
pressure. That is how the BSSID pin came back, and most likely why the camera
is no longer detected. The remaining suspects are range, power, and whatever is
in the satellite's beacon - a reflash touches none of them.

---

## What is already ruled out

Do not spend time re-testing these. Each cost hours.

| Ruled out | Evidence |
|---|---|
| **Wrong password** | Failure was at *association*, which happens before the password is exchanged. A wrong key fails later, at the four-way handshake, and says so. |
| **Protected Management Frames** | Was a real cause, now fixed. The satellite's AP sets `pmf 1` (disabled). Before that fix: `CTRL-EVENT-ASSOC-REJECT ... status_code=16`. |
| **5GHz / wrong band** | The Pi Zero W is 2.4GHz only. The AP is pinned to band `bg`, channel 6. |
| **WPA3 / SAE** | AP is forced WPA2-only: `proto rsn`, `pairwise ccmp`, `group ccmp`. |
| **The AP being broken generally** | An iPhone, a Samsung and a MacBook have all associated with it and completed the four-way handshake. It works for other clients. |
| **A BSSID pin on the rover** | Was added, then deliberately removed. Re-added by hand after the reflash and removed again on 7 Sep - see the update above. The rover's profile is unpinned. Do not re-add it. |
| **Wifi power save** | Ruled out 7 Sep: `10-no-wifi-powersave.conf` is present and `iw dev wlan0 get power_save` reports off. Section 2 below is answered, not open. |
| **A wrong or mismatched PSK** | `preconfigured` stores a 64-hex raw PMK rather than a passphrase, which looks wrong and is not - it equals `PBKDF2-HMAC-SHA1("curiousinternet", "marsyard", 4096, 32)`. The PMK is a function of passphrase and SSID only, so it authenticates against the satellite and a laptop identically. |

## What is NOT ruled out, in the order I would check

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

**Answered on 7 September, and the answer was no.** Power save was off and the
conf file below was in place. The section is kept because the reasoning is
still how you would check it after the next reflash - but the symptom it was
written to explain turned out to be the BSSID pin taking the radio down for 25
seconds at a time. Read the update above before spending time here.

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

Do not skip that second command, and do not trust the first one on its own.
On 7 September the pin was not on `preconfigured` at all - it was on a second
profile for the same SSID, at a higher priority, and inspecting
`preconfigured` showed exactly what this section says to expect while the rover
was still being broken by the profile next to it. Read every profile:

```bash
sudo grep -H -iE "^\[|ssid|bssid|autoconnect|priority|key-mgmt|pmf" \
  /etc/NetworkManager/system-connections/*
```

### 4. Compare the two access points directly

This is the highest-value experiment and nobody has run it yet. The rover joins
one and not the other, so **diff them**. From any laptop, with each one serving
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
3. Wait a full 10 minutes before concluding anything. NetworkManager backs off
   after failed attempts, so an immediate check tells you nothing.

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
| Satellite AP address | `192.168.137.1`, console at `http://mro.local:3001/`. A Windows ICS hotspot uses the same address - it does not identify the AP |
| Satellite wifi MAC | `88:A2:9E:05:50:21`, channel 6, 2.4GHz, WPA2, PMF off |
| Rover | Raspberry Pi Zero W, hostname `curiosity`, user `mars` |
| Rover MAC prefix | `b8:27:eb:`, in full `b8:27:eb:ef:4e:c7` as of 7 Sep |
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
>   design on purpose and has now been reverted twice.
> - Confirm which access point is actually serving `marsyard` before drawing
>   any conclusion from a test. Both the satellite and a Windows hotspot answer
>   on `192.168.137.1`; only BSSID and channel tell them apart.
> - The rover was reflashed after this handover was written, so treat
>   rover-side entries in the ruled-out table as needing confirmation.
>
> Do not re-test what the handover lists as ruled out. Start by establishing
> whether the rover is even attempting to associate, since the last capture
> showed no trace of its MAC in the satellite's logs at all.
>
> Tell me what evidence you want before you change anything, and tell me
> explicitly when you need me to switch networks and which way.

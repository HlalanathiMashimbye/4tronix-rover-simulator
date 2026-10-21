# The yard's network

The yard used to run on a Windows laptop. It shared a hotspot called `marsyard`
over ICS, which made the laptop the access point, the DHCP server, the gateway
and the internet uplink all at once. Nothing in the yard worked unless somebody
brought that laptop and opened it, and the demo depended on a machine that was
never part of the design.

Then the satellite served it, which took the laptop out but cost the yard its
internet: one radio cannot be an access point and a client at once (below).

Now the yard has a router of its own. A Cudy LT300 joins the venue's wifi and
serves **`mars-relay-network`** from it, so the rover, the satellite and every
tablet are on one network that also reaches the internet. `marsyard` and the
satellite's access point stay, as the fallback when the router is missing.

## The router: mars-relay-network

```
   venue wifi, 2.4GHz              SIM, 4G (optional backup)
              \                    /
               Cudy LT300, WISP mode
        serves mars-relay-network (2.4GHz, WPA2-PSK)
          DHCP, gateway, internet for the yard
                       |
      +----------------+----------------+
      |                |                |
  satellite         rover           operator's
  mro               curiosity       tablet or laptop
  client            client          client
```

What the internet buys the yard: the satellite's clock sets itself (the Pi
has no clock battery, so offline it carries on from the last time it saved),
`git pull` works in the room, and recordings can go to YouTube from where they
were made. Nothing in a run needs it: if the venue's wifi drops, the rover,
the satellite and the tablets carry on as before, on the router's own network.

### What the router has to be set to, and why

1. **2.4GHz.** The LT300 is a 2.4GHz-only (N300) router, and the rover is a Pi
   Zero W, which cannot see 5GHz at all. So the venue's network has to offer
   2.4GHz too: a 5GHz-only venue network is one the router cannot join.
2. **WPA2-PSK, not WPA3 and not WPA2/WPA3 mixed.** The rover's firmware cannot
   negotiate WPA3 or Protected Management Frames, and is rejected before the
   password is ever checked; see "Why the rover could not join at first"
   below. It is the same reason the satellite's access point sets `pmf 1`.
3. **AP isolation off, guest network off.** The devices find each other by
   name (`mro.local`, `curiosity.local`) over multicast, which isolation stops.
4. **A LAN address that is not the venue's.** Cudy's default is
   `192.168.10.1`. If the venue's own network is also `192.168.10.x`, change
   the router's LAN address (to `192.168.20.1`, say) or the two collide.
5. **Its channel is the venue's.** One radio joins the venue and serves the
   yard, so in WISP mode it cannot pick its own channel. That is fine for the
   rover on any 2.4GHz channel, and it is why the venue's network decides
   when the yard's wifi is crowded.

### Setting it up

The menu names are Cudy's WISP guide's, written for their routers generally;
the LT300's may differ a little between hardware versions (2.0 and 3.0).

1. Connect a laptop to the router, by cable to a LAN port or over its wifi,
   and open `http://cudy.net` or `http://192.168.10.1`.
2. **General Settings, WISP, Enable** (or Quick Setup, then WISP). Pick the
   venue's network from the scan, type its password, and Save & Apply. It
   reboots and takes about a minute to join.
3. **Wireless:** name `mars-relay-network`, its existing password unchanged
   (the rover and the satellite already have it), security **WPA2-PSK**, not
   hidden. Guest network off, AP isolation off.
4. **Check the LAN address** against the address the router was given by the
   venue (on its status page). Change the LAN side if they share a range.
5. **SIM, if there is one:** Cudy's failover order is cable, then WISP, then
   cellular, so a SIM keeps the yard online when the venue's wifi drops. Mind
   the data: a recording is about 10MB.
6. **The test:** a laptop on `mars-relay-network` opens any website, and then
   `http://mro.local:3001/` once the satellite has joined.

### Ask the venue first

- **Is there 2.4GHz?** See above.
- **Is it a password, or a sign-in page?** WISP joins a network with a
  password. A sign-in page (terms to accept, a voucher) has to be answered from
  a laptop on `mars-relay-network`, because the page sees the router, and
  again whenever it expires. Better: ask the venue to allow the router's MAC
  address, which is on its status page. A username-and-password login
  (WPA2-Enterprise) is not something the router's WISP mode is documented to
  do; ask for a guest network with a plain password instead.
- **Do they block devices behind another router?** Some venue networks do.

### The satellite joins it

On the satellite, with the router up:

```bash
sudo bash yard/docs/setup-scripts/satellite-join-relay.sh
```

It asks for `mars-relay-network`'s password, writes a client profile for it,
turns the satellite's own access point (`yard-ap`, `marsyard`) off without
deleting it, and switches. Like the access point script, it arms a check that
goes back only on real failure: if after three minutes the satellite has not
joined, it serves `marsyard` again by itself.

Then, on the satellite: `nmcli -t -f NAME con show --active` lists
`mars-relay-network`, and `timedatectl` says `System clock synchronized: yes`.

### The rover joins it

The rover keeps its `marsyard` profile and needs one for `mars-relay-network`
as well. Look first, over ssh while it is still reachable on `marsyard`:

```bash
nmcli -t -f NAME,TYPE con show
```

If `mars-relay-network` is not listed, add it, with PMF off for the same
reason as above:

```bash
sudo nmcli con add type wifi ifname wlan0 con-name mars-relay-network ssid mars-relay-network wifi-sec.key-mgmt wpa-psk wifi-sec.psk 'THE-PASSWORD' 802-11-wireless-security.pmf 1 connection.autoconnect yes
```

The rover has passwordless sudo. With both profiles it joins whichever network
is up, which is what lets the satellite's `marsyard` stay as the fallback.

## The fallback: the satellite serves marsyard

Everything from here on describes the satellite as the access point. It is
how the yard ran before the router, and how it runs again if the router is
missing: run `satellite-as-access-point.sh` on the satellite, or let
`satellite-join-relay.sh`'s check do it.

### What talks to what

```
        marsyard  (2.4GHz, WPA2, no PMF, channel 6)
          served by the satellite - or by anything
                       |
      +----------------+----------------+
      |                |                |
  satellite         rover           operator's
  mro               curiosity       tablet or laptop
  192.168.137.1     DHCP            DHCP
  serves the name   joins the name, whoever serves it
```

The satellite is reachable at `http://mro.local:3001/`, or at
`http://192.168.137.1:3001/` when mDNS is not cooperating. The rover keeps its
own name, `curiosity.local`, which is why `rover_url` in
`satellite_config.json` needed no change when the addressing moved.

### One radio cannot be both

The satellite has one wifi interface. As an access point it is not also a
client, so **it has no internet**, and neither does anything joined to it.

This is survivable because the yard talks to nothing but the rover: Firestore
was removed from the satellite (see
[what-the-yard-no-longer-does.md](what-the-yard-no-longer-does.md)), and the
run station's whole job is local. What it does mean:

- The operator uploads to YouTube from a device on some other network, or from
  the same device once it has left the yard wifi.
- Nobody can SSH in from elsewhere to fix the satellite. Anything that needs
  doing has to be done before the switch, or in the room.

`eth0` is the way out of this when a venue has a wired drop: plug it in and
NetworkManager's shared mode routes the yard network out through it, so the
access point keeps working and everything on it gets internet. That is the only
change needed, and no configuration goes with it.

### "marsyard" is a contract, not a device

The rover joins `marsyard` and does not care what is serving it. That is the
whole design, and it is what keeps the rover reachable without ever reflashing
it:

- normally, the satellite serves it
- if the satellite is dead, a laptop hotspot serves it and the rover follows
- a spare Pi, or somebody's phone, works just as well in an emergency

Any box that offers that name and password becomes the yard. The rover has one
connection, unpinned, set to autoconnect, and it needs nothing else:

```
preconfigured   ssid marsyard   wpa-psk   autoconnect yes
```

**The one case this cannot get right is two of them at once.** Two access
points with the same name and password are not a conflict to a client, they
are one roaming network, and the rover takes whichever is stronger. So the rule
is simply: only one thing serves `marsyard` at a time. Turn the laptop hotspot
off when the satellite is up.

An earlier version of this locked the rover to the satellite's BSSID to enforce
that. It was the wrong trade. It coupled the rover to one specific radio, so
replacing the satellite's wifi would have stranded it, and it destroyed the
property that makes the name worth having - that anything can serve it. The
laptop being able to take over is a feature, not a bug to be designed out.

### Currently unsolved: the rover will not join the satellite

The rover joins `marsyard` when a laptop serves it and not when the satellite
does, and that is open. Do not start from scratch on it -
[rover-join-handover.md](rover-join-handover.md) has what is ruled out, the
flight-recorder technique for observing a rover you cannot SSH into, and the
discipline for switching between the two access points without confusing
yourself.

### Why the rover could not join at first

The access point came up correctly and the rover was still refused. It is worth
recording exactly what that looked like, because it reads like a wrong password
and is not one:

```
wlan0: Trying to associate with 88:a2:9e:05:50:21 (SSID='marsyard' freq=2437 MHz)
wlan0: CTRL-EVENT-ASSOC-REJECT bssid=00:00:00:00:00:00 status_code=16
```

Everything before the rejection is good news: the satellite was beaconing, on
the right BSSID, on channel 6, and the rover found it and tried. The rejection
is at **association**, which happens before the password is ever exchanged - a
wrong PSK fails later, at the four-way handshake, and says so. The all-zero
BSSID means wpa_supplicant generated the failure locally rather than receiving
a reject frame from the access point.

The cause is Protected Management Frames. NetworkManager offers PMF by default
and the Pi Zero W's `brcmfmac` firmware cannot negotiate it. Windows ICS does
not offer it, which is why the rover joined the laptop hotspot instantly and
made this look like a satellite-only fault.

`802-11-wireless-security.pmf 1` (1 means disabled) on the access point profile
is the fix, and the setup script sets it.

### Making the switch

On the satellite:

```
sudo bash satellite-as-access-point.sh
```

It writes the access point profile, arms a check, and switches. The SSH session
running it dies at that moment, which is expected.

Then: **turn the laptop hotspot off and leave it off.** Within a minute
`marsyard` should appear in the wifi list on a phone. That is the whole test.

There is nothing to cancel. An earlier version of the script armed a rollback
that had to be cancelled by hand within five minutes, which is exactly wrong
here - after the switch the person who would cancel it has no route to the
machine, so a healthy access point would be torn down by its own safety net.
The check instead asks whether the access point actually came up and reverts
only if it did not.

### When it does not come up

Turn the laptop hotspot back on and wait three minutes. The satellite's check
finds no access point running, disables its autoconnect and brings the client
profile back up, and the rover follows it there on `preconfigured`. That puts
everything back exactly as it was, without a screen or a keyboard.

If that fails too, the satellite needs a monitor. There is no remote path in;
that is the cost of the yard owning its own network.

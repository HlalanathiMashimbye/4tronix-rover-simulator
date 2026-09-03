# The yard's network

The yard used to run on a Windows laptop. It shared a hotspot called `marsyard`
over ICS, which made the laptop the access point, the DHCP server, the gateway
and the internet uplink all at once. Nothing in the yard worked unless somebody
brought that laptop and opened it, and the demo depended on a machine that was
never part of the design.

The satellite serves the wifi now. It is the machine that is meant to be in the
room anyway.

## What talks to what

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

## One radio cannot be both

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

## "marsyard" is a contract, not a device

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

## Why the rover could not join at first

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

## Making the switch

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

## When it does not come up

Turn the laptop hotspot back on and wait three minutes. The satellite's check
finds no access point running, disables its autoconnect and brings the client
profile back up, and the rover follows it there on `preconfigured`. That puts
everything back exactly as it was, without a screen or a keyboard.

If that fails too, the satellite needs a monitor. There is no remote path in;
that is the cost of the yard owning its own network.

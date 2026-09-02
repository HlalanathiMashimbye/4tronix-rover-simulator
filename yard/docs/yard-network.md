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
        marsyard  (2.4GHz, WPA2, channel 6)
              served by the satellite
                       |
      +----------------+----------------+
      |                |                |
  satellite         rover           operator's
  mro               curiosity       tablet or laptop
  192.168.137.1     DHCP            DHCP
  the AP itself     pinned to the AP's BSSID
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

## Why the rover is pinned to a BSSID

Two access points broadcasting `marsyard` with the same password do not look
like a conflict to a client. They look like one roaming network, and the rover
picks whichever is stronger. A laptop hotspot left switched on out of habit can
therefore take the rover onto a different subnet, where the satellite cannot
reach it, intermittently and by signal strength. It is the worst kind of fault:
silent, and dependent on where somebody is standing.

So the rover carries a connection locked to the satellite's radio:

```
yard-satellite   priority 20   ssid marsyard   bssid 88:A2:9E:05:50:21
preconfigured    priority 0    ssid marsyard   (no bssid)
```

`yard-satellite` wins whenever the satellite is up, and no other access point
can satisfy it whatever it calls itself. The satellite pins its own MAC onto
the access point profile (`802-11-wireless.cloned-mac-address`) so that address
is a promise rather than a guess.

This is the rule in [bring-up.md](bring-up.md) - give the rover exactly one
network, and let it fail visibly rather than attach itself to the wrong thing -
applied one level down, to the access point rather than the name.

`preconfigured` is left behind it as the way back. It cannot connect to
anything while the laptop hotspot is off, which is the point: it exists for the
recovery case below.

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

# Bringing a yard up from nothing

Two Pis and a network. Written for the case where both cards are being
flashed fresh.

## What actually has to talk to what

Worth reading before flashing anything, because it is smaller than it used to
be. Since the Firestore mirror was removed, **the satellite needs the rover and
its own camera and nothing else.** No internet, no Mission Control, no
credentials. A yard with no uplink at all runs missions.

```
  laptop hotspot "marsyard"
        |
        +-- rover Pi        :8523   the only thing that moves
        +-- satellite Pi    :3001   the pages, :8890 the camera
```

Mission Control is not on this diagram on purpose. It runs in a browser, the
operator copies a mission out of it, and it never speaks to the satellite. If
the laptop has internet to share, that is for the operator's browser, not for
the yard.

## The network

`marsyard` with the password in [rover-server.md](rover-server.md) is already
the documented yard network, and was already configured on the old rover card.
Nothing new to invent.

The problem is not the password, it is that the rover card carries **several**
networks - a phone hotspot among them - and wpa_supplicant picks whichever it
can see. If a phone is in the room, the rover joins the phone.

**Fix: give the rover exactly one network.** Not a priority ordering; one
entry. A rover that cannot see `marsyard` should fail visibly rather than
quietly attach itself to somebody's phone and disappear off the yard network.

### Set wifi in the Imager, for both cards

Use Raspberry Pi Imager's **OS Customisation** (the gear) on both: hostname,
user and password, wifi with country ZA, SSH on, and paste your public key.
That is the whole of it.

Do it in the app rather than by hand and the next paragraph stops being your
problem.

**Why it matters.** The two Pis do not use the same wifi mechanism. The rover
is pinned to Bullseye Legacy - `rpi_ws281x` and 4tronix's `rover.py` are only
tested there - which takes `wpa_supplicant.conf` on the `bootfs` partition. A
Bookworm satellite **ignores that file completely** and uses NetworkManager.
Write the wrong one and you get a Pi that boots, joins nothing, and says
nothing about the file you wrote. Imager knows which image it just wrote, so
it picks correctly and the question never comes up.

Two other things the app gets right that are easy to get wrong by hand: the
password (`userconf.txt` is processed once on first boot, so a card that has
already booted cannot be fixed by putting it back), and the SSH key, which is
what stops the password mattering at all.

A clean flash also starts the card with **only** the network you typed. That is
the fix for a rover that keeps joining somebody's phone hotspot: it is not that
the password is wrong, it is that the card still has the other network on it.

## Order

Do them in this order, and verify each before moving on. Each step fails in a
way you can see, which is the point of splitting them up.

**1. Hotspot.** Laptop serving `marsyard`. Note the address it gives itself -
macOS Internet Sharing usually takes `192.168.2.1`.

**2. Rover.** Flash Bullseye Legacy via **Use custom**, and set hostname, the
`mars` user, `marsyard` wifi, SSH and your public key in **OS Customisation**.
Boot, then find it:

```bash
ping -c1 marspi.local || arp -a | grep -i b8:27:eb   # Pi MAC prefix
ssh mars@<rover>
curl -s localhost:8523/health
```

Do not continue until `/health` answers. Everything after this assumes a rover
that responds.

**3. Satellite.** Flash Bookworm, same OS Customisation screen, same details.
Boot, find it, then:

```bash
git clone <repo> ~/4tronix-rover-simulator
cd ~/4tronix-rover-simulator/yard/satellite
python3 -m venv ~/satellite-env --system-site-packages   # picamera2 comes from apt
~/satellite-env/bin/pip install -r requirements.txt
~/satellite-env/bin/python web_server.py
```

No `.env` is needed. An empty one runs, and there is nothing secret to put in
it. Open `http://<satellite>:3001/` from the laptop.

**4. Point the satellite at the rover.** Settings, then the rover path at the
top. The default is `http://marspi.local:8523`, which is right only if the
rover is still called `marspi`. **Use the IP if `.local` is unreliable** -
macOS Internet Sharing does not always carry mDNS between clients, and this is
the most common way bring-up stalls.

The rover chip in the nav turns green when this is right. That is the check.

**5. Camera.** Settings, Start camera. Then confirm frames are actually
arriving, which is a different question from the port being open:

```bash
curl -s http://<satellite>:3001/api/camera/ready
```

`{"ready": true}` or the run station will refuse to record, correctly.

**6. Run one.** `/run/`, both lamps green, paste some Python, Send. Recording
starts, the rover moves a second later, and when it finishes the camera is
released on its own and the file appears in step 2.

## Names, which are confusing on purpose-free grounds

Three things are called some variant of the same word and they are not the same
thing:

- **Rover hostname** - `marspi` on the old card, possibly `curiosity` on a new
  one. This is what goes in the rover path in Settings.
- **`YARD_ID`** - `curiosity`. Identifies the *yard*, not the rover. It is half
  of what names a recording (`<mission>__<yard>.mp4`) and it must match the
  yard in Mission Control or uploads will not attach.
- **Satellite hostname** - whatever you set. Only used to reach the pages.

Setting `YARD_ID` to the rover's hostname because they happen to match on one
card is how the wrong yard ends up on a video.

## When something does not work

- **Satellite loads but the rover chip is red.** Wrong rover path, or mDNS.
  `curl http://<rover-ip>:8523/health` from the satellite over SSH settles
  which.
- **Send is greyed out.** One of the two lamps is not green. That is the gate
  doing its job; the sub-text says which.
- **Camera says listening but not ready.** The process is up and no frames are
  coming. On a Pi that is usually the ribbon; on a laptop it is the OS refusing
  camera access to a process that cannot show a prompt.
- **The rover joins the wrong network.** It still has more than one configured.
  See above.

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

**Why it matters.** The two Pis do not use the same wifi mechanism. An older
image takes `wpa_supplicant.conf` on the `bootfs` partition; a Bookworm or
Trixie one **ignores that file completely** and uses NetworkManager. Write the
wrong one and you get a Pi that boots, joins nothing, and says nothing about
the file you wrote. Imager knows which image it just wrote, so it picks
correctly and the question never comes up.

### Which image for the rover

**Not "Raspberry Pi OS (32-bit)".** That is the default in the app and it
currently gives you Trixie, on which the rover cannot move: no PWM chips at
all, no `/dev/i2c-1`, no SPI. Two flashes were lost to this - the default
option is the wrong one, and nothing on the flashing screen says so.

**Bookworm works.** Measured on a Pi Zero W Rev 1.1, kernel 6.12: the 4tronix
library imports and initialises, the PCA9685 answers at `0x40`, and
`rpi_ws281x` drives the LEDs. The docs previously said Bullseye was required
because `rpi_ws281x` and 4tronix's `rover.py` were only tested there. They are
tested on Bookworm now.

One rough edge to know about rather than fear: `rover.cleanup()` raises inside
`RPi.GPIO`'s PWM destructor, because Bookworm's `RPi.GPIO` is a shim over
`lgpio` and its `tx_pwm` gets `None`. Python ignores exceptions in `__del__`,
so nothing breaks, but it fills the service log with tracebacks and can bury a
real error.

Bullseye Legacy 32-bit remains the fallback if anything hardware-side
misbehaves. It is the configuration with the longest history.

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

## Three things that each cost an afternoon

All three were found bringing a real yard up. Each is invisible beforehand and
obvious once seen, and none of them says what is actually wrong.

### I2C and SPI are off by default

**Symptom:** the rover boots, joins wifi, answers SSH, and cannot move. No
servos, no LEDs.

**Check:**
```bash
ssh mars@curiosity.local 'ls /dev/i2c-* /dev/spidev*'
```
You want `/dev/i2c-1` and `/dev/spidev0.0`. `/dev/i2c-2` alone is not enough -
that is a different bus and the rover board is not on it.

**Fix**, then reboot:
```bash
sudo raspi-config nonint do_i2c 0
sudo raspi-config nonint do_spi 0
sudo reboot
```

**Confirm the board is really there**, which `ls` cannot tell you:
```bash
sudo apt install -y i2c-tools && sudo i2cdetect -y 1
```
`40` is the PCA9685 that drives the servos, `70` its all-call address, `50` the
HAT EEPROM. If `40` is missing, the problem is the ribbon or the board, not the
software.

### Wi-Fi power save makes the rover unreachable one way

**Symptom:** the worst of the three, because everything looks fine from the
rover. It reaches the satellite, browses the internet, holds an SSH session -
but the satellite cannot reach *it*. The rover chip stays red on a yard where
both machines are plainly on the network.

**Tell:** ARP never resolves in that direction.
```bash
ssh mars@mro.local 'ping -c2 curiosity.local; ip neigh | grep 192.168'
```
`INCOMPLETE` against the rover's address is the fingerprint. A Pi Zero W with
power save on sleeps its radio and does not answer ARP, so the side that
transmits first can always reach the other and never the reverse. Signal
strength is irrelevant - this was measured at -28 dBm, which is as good as it
gets.

**Fix**, and make it survive a reboot:
```bash
sudo iw dev wlan0 set power_save off
printf '[connection]\nwifi.powersave = 2\n' | \
  sudo tee /etc/NetworkManager/conf.d/10-no-wifi-powersave.conf
```

### The rover service owns the GPIO

**Symptom:** any 4tronix test script fails with something that reads like a
library incompatibility:
```
lgpio.error: 'GPIO not allocated'
```

It is not. `rover-server` runs as root and holds those lines, and only one
process can. The message says nothing about a conflict, which is why this
looks like a Bookworm problem and is not.

**Fix:** stop the service, and put it back afterwards even if you Ctrl-C out:
```bash
ssh -t mars@curiosity.local \
  'sudo systemctl stop rover-server && cd ~/marsrover && sudo python3 motorTest.py; \
   sudo systemctl start rover-server'
```
`-t` because it reads arrow keys and needs a terminal.

**Better:** do not stop it at all. Driving through the platform is the thing
worth testing anyway, and it exercises the recording and the watcher with it -
paste the Python into `/run/` and press Send.

### One more, on the satellite

Do not run `pip install --upgrade pip` inside the virtualenv on these boxes. It
left the venv with no pip at all, and the requirements install then silently
never ran - imports kept working only because `--system-site-packages` was
falling through to the system copies, so nothing looked wrong until something
needed a package that was not there.

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

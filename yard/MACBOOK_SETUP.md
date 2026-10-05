# MacBook Satellite Setup

How to run the Mars Yard **satellite** on a MacBook instead of a Raspberry Pi. The rover
is unchanged: it still runs on its own Pi at `marspi.local`/`curiosity.local:8523`.

David Campey wrote the original MacBook mode upstream in June 2026, with its own camera
server. When it was merged into this fork the satellite's own `camera_server.py` already
fell back to a Mac webcam, so his camera list and launcher now drive that one camera
server instead of a second one. The steps below are his, updated to match.

## When to use this

- No spare satellite Pi, or using a laptop as a quick demo rig.
- You want a better overhead camera than the Pi AI cam (a good USB webcam on a
  gooseneck gives a better classroom shot).
- Running the system entirely on a desk without any extra Pi hardware.

**What changes:** the satellite host (Mac instead of Pi) and its overhead camera (Mac webcam
instead of the IMX500 Pi AI cam).

**What doesn't change:** the rover Pi, the mast camera (still the Pi's CSI camera), the
take-a-picture block, the tablet and TV pages, and their URLs.

## Requirements

- macOS (tested on Ventura / Sonoma)
- Python 3.10+
- A webcam: built-in FaceTime HD, Continuity Camera, or any USB camera
- Terminal (or iTerm2) with **Camera permission** (below)
- The rover Pi on the same WiFi

## Install

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r yard/satellite/requirements.txt
```

The same `requirements.txt` as the Pi. `picamera2` is skipped off Linux, and the
package that names your cameras (`pyobjc-framework-AVFoundation`) installs only on a Mac.

### Grant camera permission

The first time the camera starts, macOS shows a **Camera access** dialog. Grant it to
Terminal (or iTerm2). If you miss it:

**System Settings -> Privacy & Security -> Camera -> enable Terminal / iTerm2**

You only need to do this once. If the camera will not start, this is almost always why,
and Settings says so.

## Running

```bash
yard/satellite/start-mac.sh
```

This starts the web server, waits for it, then asks it to start the camera:

| Service | Port | URL |
|---------|------|-----|
| Web server (`web_server.py`) | 3001 | `http://localhost:3001` |
| Camera stream (`camera_server.py`) | 8890 | `ws://localhost:8890` |

Press **Ctrl-C** to stop both. `VENV=...` uses another venv, and an existing
`yard/satellite/mac-env` from the original setup is picked up automatically.

The web server starts the camera rather than the script starting it directly because the
web server has to own that process to switch cameras: a camera it did not start is one it
cannot restart.

## Connecting tablets and TV

Make sure the Mac, tablets, TV, and rover Pi are all on the same WiFi:
**`marsyard`** or **`mars-relay-network`**.

The Mac is reachable via its Bonjour name (usually `<your-mac-name>.local`) or its IP:

```bash
ipconfig getifaddr en0    # or en1 for some Macs
```

| Device | URL |
|--------|-----|
| **Tablets** | `http://<mac-name>.local:3001/code/` |
| **TV** | `http://<mac-name>.local:3001/monitor/` |
| **Settings** | `http://<mac-name>.local:3001/settings` |

The TV connects its camera stream to whatever host served the page, so it uses the Mac's
camera with no `mro.local` alias.

## Setting the rover

On `http://localhost:3001/settings`, use **Find rover**, or type the address
(`http://marspi.local:8523`, or `http://curiosity.local:8523` for the Bookworm card).
It is saved to `satellite_config.json` and survives restarts.

## Picking the camera

On Settings, the **Camera** card shows a **Camera** dropdown listing your cameras by name.
Pick one and the camera restarts on it within a couple of seconds. The choice survives
restarts.

The dropdown appears only on a Mac: on the Pi there is one camera and nothing to choose.
If it is missing on a Mac, `pyobjc-framework-AVFoundation` is not installed in the venv;
re-run the install step.

## Offline UI testing (no rover needed)

Turn on **Simulator** on Settings, or open `http://localhost:3001/code/?spy=true`, which
uses a fake rover in the browser.

## Differences from the Pi satellite

| | Pi satellite (`mro.local`) | Mac satellite |
|--|--|--|
| Camera server | `camera_server.py` (IMX500/picamera2) | `camera_server.py` (OpenCV webcam fallback) |
| Object detection | Yes (IMX500 neural network) | No |
| Service management | systemd (`satellite-web.service`, `satellite-camera.service`) | Foreground via `start-mac.sh` |
| Auto-start on boot | Yes | No (run manually, or add a launchd plist) |
| Camera dropdown on Settings | No | Yes |

## Optional: auto-start on login (launchd)

```bash
# Create ~/Library/LaunchAgents/mars.satellite.plist
# (adjust the paths for your setup)
cat > ~/Library/LaunchAgents/mars.satellite.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>mars.satellite</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/path/to/yard/satellite/start-mac.sh</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/tmp/mars-satellite.log</string>
    <key>StandardErrorPath</key><string>/tmp/mars-satellite.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/mars.satellite.plist
```

macOS camera permission must be granted to the launching app, which may need one
interactive run first.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Camera will not start; Settings mentions permission | Camera permission denied | System Settings -> Privacy -> Camera -> enable Terminal |
| Settings Camera badge red | Camera not running | **Start camera** on Settings; check `start-mac.sh` output |
| No Camera dropdown on Settings | pyobjc not installed | Re-run the install step |
| Wrong camera after picking one | Index order changed (a camera was unplugged) | Pick it again |
| Tablets can't reach Mac | Different WiFi subnet | Join `marsyard` / `mars-relay-network` on both |

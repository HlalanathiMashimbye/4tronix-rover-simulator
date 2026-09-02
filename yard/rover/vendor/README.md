# Vendored 4tronix `rover` library

`rover.py` is the 4tronix M.A.R.S. Rover motor/servo/LED control library
("This code is in the public domain and may be freely copied and used. No
warranty is provided or implied."). It used to live at `real-rover/rover.py`
in this repository; it is now vendored here because `yard/rover/drivers.py`
is what actually imports it (`import rover`, inside `RealRoverDriver`), and
keeping the library next to its only importer means one `git clone` is
enough to rebuild the rover Pi.

## Why this exists

Before this move, the rover Pi needed a *second*, separate checkout of the
4tronix library on its filesystem (`/home/mars/marsrover`), resolved via
`PYTHONPATH`. Vendoring `rover.py` here means:

- The library is version-controlled alongside the code that depends on it,
  reviewable in the same PRs.
- `yard/docs/trixie-led-rewrite-plan.md`, which plans to add
  `led_driver.py` / `led_factory.py` beside `rover.py` and patch it,
  now edits the file the Pi actually imports.

**This does NOT eliminate the second install entirely.** `rover.py` itself
imports a sibling module, `pca9685` (`import pca9685` at the top, called
from `init()` and every `setServo()`), which is a separate low-level I2C PWM
driver installed by 4tronix's own `rover.sh` script. It is not part of this
repository - nobody has a verified copy to vendor safely, and hand-typing a
replacement for code that drives real motor PWM is not something to do
without a Pi to test it against. So `/home/mars/marsrover` still needs to
exist on the rover Pi, and `pca9685.py` still resolves from there.

What changes is which copy of `rover.py` actually runs: with this directory
ahead of `/home/mars/marsrover` on `PYTHONPATH`, `import rover` finds the
vendored, version-controlled copy, while `import pca9685` (triggered from
inside that copy) keeps searching the path and finds the one true copy that
still lives in the 4tronix install. One clone gets you the rover *logic*;
`rover.sh` is still how the Pi gets its I2C driver.

## How it's wired

`yard/rover/drivers.py`'s `RealRoverDriver` does a bare `import rover`, and
`yard/rover/service.py`'s `run_python` fallback resolves the same import for
learner-submitted Python. Both rely on `PYTHONPATH` at runtime carrying this
directory ahead of the `pca9685`-only install:

- The systemd unit `yard/deploy/rover-server.service` sets
  `PYTHONPATH=<repo>/yard/rover/vendor:/home/mars/marsrover` - vendor first,
  so `rover.py` there wins; `marsrover` second, so `pca9685` still resolves.
- `service.py`'s fallback computes its default for the vendored half from its
  own file location (`os.path.dirname(__file__)/vendor`), overridable with
  `ROVER_LIB_PATH`, so nothing in Python hardcodes an absolute path to this
  directory. It does not, and cannot, remove the need for `pca9685.py`.

## Updating

This is a plain copy, not a submodule. To pick up a newer 4tronix release,
replace `rover.py` with the new version and verify `drivers.py`'s calls
(`init`, `forward`, `reverse`, `spinLeft`, `spinRight`, `setServo`, `stop`,
`cleanup`, `setPixel`, `show`, `fromRGB`) are all still present with the same
signatures.

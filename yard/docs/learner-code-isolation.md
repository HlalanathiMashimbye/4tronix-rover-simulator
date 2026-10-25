# Learner code isolation (planned, not yet built)

Status: **not implemented.** This is a handoff note so someone can pick the
work up. It is the one security item from the iteration 4 review that was
deferred: the three smaller fixes shipped as their own PRs (the satellite and
rover same-origin gate, the Mission Control rate limits, and the camera-stream
origin check), and this, the largest, was left for later because it is not a
blocker for the deadline it was written against.

A fuller execution brief may exist locally as `SECURITY_BRIEF.md` at the repo
root (an untracked working note, not committed). This file stands on its own if
that note is gone.

## The hole

`yard/rover/python_runner.py` (`StudentCodeRunner.run`) compiles a learner's
program and `exec`s it inside the rover server's own process, with a reduced
`__builtins__` (`SAFE_BUILTINS`) and `sys.settrace` for the stop button and the
120 s timeout. A reduced builtins dict is not an isolation boundary in CPython:
a determined program can still reach out of it. And `yard/deploy/rover-server.service`
runs the server as `User=root`, with the GPIO hardware in the same process. So
a learner program today can do whatever that process can, which is everything.

Keep the allowlist validators (`mission-control/src/core/domain/safety` and
`yard/rover/mission_validator.py`) and the reduced builtins. They are the first
line and give learners good error messages. The new boundary goes underneath
them, it does not replace them.

## The planned design

Run each learner program in a separate child process that has nothing worth
having, with the root parent keeping everything real.

- **Started by the root parent, then unprivileged.** `subprocess.Popen` with
  `user=`/`group=` (Python 3.9+) set to a dedicated no-login account (`learner`,
  created by the setup step below), or `nobody` as a fallback. No supplementary
  groups (`extra_groups=[]`), so the child is not in `gpio`, `i2c` or `video`.
- **No network.** A new network namespace for the child: the parent is root, so
  `os.unshare(os.CLONE_NEWNET)` in a `preexec_fn`, before the user is dropped,
  works without user namespaces. (`os.unshare` is Linux-only and needs the
  parent's privilege, so this only takes effect on the Pi.)
- **Resource limits** via `resource.setrlimit` in the same `preexec_fn`: address
  space (for example 256 MB), CPU seconds a little over the 120 s cap, no core
  files, a small `RLIMIT_NOFILE`, and `RLIMIT_NPROC` so it cannot fork.
- **Nothing inherited.** Empty environment, `-I -S` interpreter flags, a
  throwaway working directory (`tempfile.mkdtemp`, removed after),
  `close_fds=True`, no inherited stdin. Set `PR_SET_NO_NEW_PRIVS`.
- **The child is a small fixed runner** (for example `yard/rover/learner_child.py`)
  that reads the program and the allowed API from the parent, runs it with the
  same reduced builtins, and gives it a `rover` object whose methods are a
  proxy: each call (`forward(speed)`, `setServo(n, deg)`, `stop()`, and the rest
  `LearnerRover` exposes) is written as one JSON line to the parent and waits
  for the reply. `time.sleep` happens in the child. `print` output goes back to
  the parent the same way, for the monitor.
- **The parent owns everything real.** It executes each call on
  `self.driver.learner_rover()` (`yard/rover/drivers.py`, `LearnerRover`, which
  holds speeds to 0-100), so the fake and real drivers keep working unchanged
  and `test_driver_contract.py` stays the contract. It answers `take_photo` the
  same way, and rejects any call not on the allowlist.
- **Stop and timeout become a kill.** The stop button and the 120 s wall clock
  (`service.py` passes `timeout`) kill the child (SIGKILL) and stop the driver.
  This is simpler and stronger than the trace function, which can only interrupt
  Python frames. Keep the existing behaviour that a stop lands within a fraction
  of a second.

## What must not change

Existing tests in `yard/rover` pin most of this; read `test_service.py`,
`test_integration.py`, `test_sse.py`, `test_motion_commands.py`,
`test_steering_reaches_the_wheels.py` and `test_driver_contract.py` first.

- A learner's program drives the rover exactly as before, with the library's
  semantics (forward does not straighten the wheels; see `LearnerRover`'s
  docstring).
- Console output reaches the instruction and the monitor.
- An error in the program marks the instruction `error` with a readable message,
  and the driver is stopped.
- The stop button and the timeout still work, and still stop the motors.
- Tests that inject a `rover_module` into `RoverQueueService` keep working: the
  injected object is used on the parent side, where calls are executed.

## Setup on the Pi (a person runs it once)

Create the no-login `learner` user, in no hardware groups. Write it as a script
under `yard/docs/setup-scripts/` in the style of `satellite-sudoers.sh`, and
document it here and in [rover-server.md](rover-server.md). The runner must fall
back to `nobody` with a logged warning if the account is missing, rather than
refuse to run missions. It needs the `mars` password once (SSH access is in
rover-server.md). The rover Pi is `marspi.local` / `curiosity.local`.

## Testing notes for whoever picks this up

- **Boundary tests are Linux-only and need privilege.** Start a child the way
  the runner does, with a program that only sleeps, and while it runs read
  `/proc/<pid>/`: `status` (uid/gid not 0, empty `Groups:`, `NoNewPrivs` 1),
  `ns/net` differs from the parent's, `limits` match, `environ` empty, `cwd` is
  the throwaway dir and is gone after. Mark them to skip on macOS. Note that
  dropping to another user and unsharing a net namespace both need the parent to
  be root (CAP_SYS_ADMIN): the CI `yard-rover` job runs on `ubuntu-latest` as a
  non-root user, so these tests must skip cleanly when the privilege is absent,
  or they will fail in CI. They are proven for real on the Pi.
- **Behaviour through the proxy runs on every OS:** a program's calls reach the
  driver in order; a disallowed call name is refused by the parent; a speed of
  500 is refused by `LearnerRover` before the driver; the stop button stops the
  motors and ends the child within half a second; output reaches the
  instruction.
- Prove a boundary holds by what the isolated process is allowed to do, never by
  breaking out of it. Do not write or commit escape payloads.

## How to land it

One PR, as its own branch off `main`. **Do not merge it until a person has run
real missions on the rover:** two or three runs, including one stopped mid-run
with the stop button, confirming the rover moves as before and stops when told.
Never dispatch to the rover unattended. Then deploy to the rover Pi (not the
satellite) per [rover-server.md](rover-server.md). Add a `CHANGELOG.md` entry
and rows in `docs/test-cases.md` for the new test files, per `AGENTS.md`.

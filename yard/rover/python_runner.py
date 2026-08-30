"""
Running learner-submitted Python on the rover.

Split out of service.py, where this lived as roughly sixty lines inside one
branch of a nine-branch elif chain. RoverQueueService's job is to take an
instruction off the queue and make the rover carry it out. Sandboxing an
arbitrary program, tracing it so the stop button can interrupt a `while True`,
and capturing its stdout for the monitor are a different job, changing for
different reasons, and they were the reason _execute_instruction was 130 lines
long.

The runner takes what it needs as constructor arguments rather than reaching
into a service, so it can be exercised without a queue, a driver or a thread.
"""

import contextlib
import io
import os
import sys
import time


# Filename given to compiled student code so the trace function can
# distinguish student frames from rover module / service internals
STUDENT_CODE_FILENAME = '<student-code>'


class StudentCodeInterrupted(Exception):
    """Raised inside student run_python code to stop it (stop button or timeout)."""


# The only names learner code can reach besides `rover`, `time` and
# `take_photo`. Everything absent is absent deliberately: no __import__, no
# open, no eval, no getattr.
SAFE_BUILTINS = {
    'range': range, 'len': len, 'print': print,
    'int': int, 'float': float, 'str': str,
    'list': list, 'dict': dict, 'tuple': tuple,
    'True': True, 'False': False, 'None': None,
    'enumerate': enumerate, 'zip': zip, 'abs': abs,
    'min': min, 'max': max, 'round': round,
}


def rover_lib_path() -> str:
    """Directory holding the 4tronix `rover` library on the Pi.

    Defaults to the copy vendored beside this file rather than a hardcoded
    absolute path, so nothing here bakes in a machine layout. ROVER_LIB_PATH
    overrides it; yard/deploy/rover-server.service sets it explicitly.

    Note this is only half of what the Pi needs on its path: rover.py imports
    `pca9685`, which is not vendored and still comes from the 4tronix install.
    See yard/rover/vendor/README.md.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    return os.environ.get('ROVER_LIB_PATH', os.path.join(here, 'vendor'))


def simulator_path() -> str:
    """Directory holding roversimulator.py, the off-Pi stand-in for `rover`."""
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(os.path.dirname(here))
    return os.path.join(repo_root, 'legacy', 'simulator')


def import_rover_module():
    """Import the rover hardware library, or the simulator standing in for it.

    On the Pi, `rover` drives real motors. Off it, that import fails (no
    RPi.GPIO) and legacy/simulator/roversimulator.py takes over with the same
    API, which is the whole reason that file is kept rather than deleted.

    This is a module-level function, not inline in the caller, so both paths
    are reachable from a test. They were not, and it cost us: when the
    simulator moved into legacy/simulator/, the fallback kept pointing at the
    repo root and raised ModuleNotFoundError on every machine without the
    4tronix library, while all the rover tests stayed green because each one
    injects a rover_module and never reaches this code.
    """
    try:
        lib_path = rover_lib_path()
        if lib_path not in sys.path:
            sys.path.insert(0, lib_path)
        import rover as rover_module
        if not hasattr(rover_module, 'forward'):
            raise ImportError('rover module missing hardware API')
        return rover_module
    except (ImportError, AttributeError):
        sim_path = simulator_path()
        if sim_path not in sys.path:
            sys.path.insert(0, sim_path)
        import roversimulator as rover_module
        return rover_module


class StudentCodeRunner:
    """Executes one learner program against a rover module.

    Collaborators are injected rather than pulled off a service:

      interruptible_wait  the service's sleep, which returns early when the
                          stop button is pressed. Learner `time.sleep` is
                          routed through it so a long sleep is interruptible.
      stop_requested      threading.Event the stop button sets.
      photo_provider      callable returning a path to a freshly taken still.
      timeout             wall-clock seconds before the program is killed.
    """

    def __init__(self, *, interruptible_wait, stop_requested, photo_provider, timeout):
        self._interruptible_wait = interruptible_wait
        self._stop_requested = stop_requested
        self._photo_provider = photo_provider
        self._timeout = timeout

    def run(self, code: str, instruction: dict, rover_module) -> None:
        """Run `code`, recording photo attempts and stdout on `instruction`.

        Mutates `instruction` rather than returning a result because the queue
        record is what the monitor reads, and callers already hold it. Raises
        on any failure in the learner's program, including
        StudentCodeInterrupted for a stop or a timeout, so the caller can mark
        the instruction errored and halt the rover.
        """
        interruptible_time = self._interruptible_time()
        take_photo = self._photo_hook(instruction)

        # Trace each line of student code (only - other frames return None) so
        # the stop button and a wall-clock deadline can break out of loops like
        # `while True: pass`. Blocking C calls are not interruptible mid-call.
        compiled = compile(code, STUDENT_CODE_FILENAME, 'exec')
        trace = self._tracer(deadline=time.monotonic() + self._timeout)

        # Capture print() output so distance readings etc. reach the monitor
        # via the instruction record
        stdout_buf = io.StringIO()
        sys.settrace(trace)
        try:
            with contextlib.redirect_stdout(stdout_buf):
                exec(compiled, {
                    'rover': rover_module,
                    'time': interruptible_time,
                    'take_photo': take_photo,
                    '__builtins__': SAFE_BUILTINS,
                })
        finally:
            sys.settrace(None)
            captured = stdout_buf.getvalue().strip()
            if captured:
                instruction['output'] = captured[:2000]

    def _interruptible_time(self):
        """A stand-in for the `time` module exposing only an interruptible sleep."""
        wait = self._interruptible_wait

        class _InterruptibleTime:
            sleep = staticmethod(lambda s: wait(s))

        return _InterruptibleTime

    def _photo_hook(self, instruction: dict):
        provider = self._photo_provider

        def take_photo():
            # Mark the attempt first so a failed capture is distinguishable
            # from "no photo block" on the monitor
            instruction['photo_attempted'] = True
            path = provider()
            # photo=True means a photo is available to fetch at /photo
            instruction['photo'] = True
            print('Photo taken')
            return path

        return take_photo

    def _tracer(self, deadline: float):
        stop_requested = self._stop_requested
        timeout = self._timeout

        def trace(frame, event, arg):
            if frame.f_code.co_filename != STUDENT_CODE_FILENAME:
                return None
            if stop_requested.is_set():
                raise StudentCodeInterrupted('Stopped')
            if time.monotonic() > deadline:
                raise StudentCodeInterrupted(
                    f'Code ran longer than {timeout:.0f}s and was stopped')
            return trace

        return trace

"""A recording being stopped must not crash the process.

WHAT HAPPENED. The satellite died with SIGSEGV inside libavcodec. The crash
report named both sides of it:

    Thread 1  cv::VideoWriter::release()  <- stop_recording, on a Flask thread
    Thread 3  cv::VideoWriter::write()    <- the consumer's asyncio loop

release() frees the FFmpeg encoder context inside the cv2 object. The consumer
took a snapshot of the writer table under the lock, dropped the lock, and then
wrote to the writers in that snapshot - so a stop landing in that gap released
a writer the consumer was about to use, and the write reached into freed
memory. Not an exception: the whole process goes, taking the camera stream and
the web server with it mid-run.

These tests force that interleaving rather than hoping to hit it. A racy test
that fails "usually" is worse than none, because the one green run is the one
that gets believed.
"""

import threading

import pytest

import recording_control


class SpyWriter:
    """Stands in for cv2.VideoWriter, and refuses to be used after release.

    The real object does not refuse - it segfaults - which is exactly why the
    fault reached production. This one raises instead, so the same misuse is
    visible in a test rather than as a dead process.
    """

    def __init__(self, on_write=None):
        self.released = False
        self.writes = 0
        self._on_write = on_write

    def write(self, frame):
        if self.released:
            raise AssertionError('wrote a frame to a writer that was released')
        self.writes += 1
        if self._on_write:
            self._on_write()

    def release(self):
        self.released = True


@pytest.fixture(autouse=True)
def clean_table(monkeypatch):
    """A private writer table per test, and no real consumer thread."""
    monkeypatch.setattr(recording_control, '_writers', {})
    monkeypatch.setattr(recording_control, '_paths', {})
    monkeypatch.setattr(recording_control, '_lock', threading.Lock())
    yield


def test_a_stop_cannot_release_a_writer_mid_write():
    """The exact interleaving from the crash report, forced.

    Two recordings are open. Writing to the first one triggers a stop of the
    SECOND from another thread, and waits for that thread to finish. Without
    the lock held across the loop, the stop completes, releases the second
    writer, and the loop then writes to it.
    """
    stopper_done = threading.Event()
    stopper_started = threading.Event()

    def stop_the_other_one():
        def target():
            stopper_started.set()
            recording_control.stop_recording('m2', 'curiosity', keep=False)
            stopper_done.set()

        thread = threading.Thread(target=target)
        thread.start()
        # Give it every chance to get in: with the bug there is nothing
        # holding it back, and it will release the second writer here.
        stopper_started.wait(2)
        stopper_done.wait(0.3)
        stop_the_other_one.thread = thread

    first = SpyWriter(on_write=stop_the_other_one)
    second = SpyWriter()

    recording_control._writers[('m1', 'curiosity')] = first
    recording_control._paths[('m1', 'curiosity')] = '/tmp/m1.mp4'
    recording_control._writers[('m2', 'curiosity')] = second
    recording_control._paths[('m2', 'curiosity')] = '/tmp/m2.mp4'

    # Raises AssertionError from SpyWriter.write if the second writer was
    # released while this loop was still going to use it.
    recording_control._write_frame_to_all(_frame())

    stop_the_other_one.thread.join(2)
    assert first.writes == 1
    assert second.writes == 1


def test_the_stop_still_happens_afterwards():
    """The fix must not turn the race into a lost stop."""
    writer = SpyWriter()
    recording_control._writers[('m1', 'curiosity')] = writer
    recording_control._paths[('m1', 'curiosity')] = '/tmp/m1.mp4'

    ok, detail = recording_control.stop_recording('m1', 'curiosity', keep=True)

    assert ok
    assert detail == '/tmp/m1.mp4'
    assert writer.released
    assert not recording_control.is_recording('m1', 'curiosity')


def test_a_released_writer_is_never_written_to_again():
    """After a stop, later frames must not reach the closed writer."""
    writer = SpyWriter()
    recording_control._writers[('m1', 'curiosity')] = writer
    recording_control._paths[('m1', 'curiosity')] = '/tmp/m1.mp4'

    recording_control.stop_recording('m1', 'curiosity', keep=True)
    recording_control._write_frame_to_all(_frame())  # would raise if it did

    assert writer.writes == 0


def test_one_writer_failing_does_not_stop_the_others():
    """A per-writer error is logged, not propagated: one bad recording must
    not take down the consumer loop and end every other recording."""
    class Broken(SpyWriter):
        def write(self, frame):
            raise RuntimeError('encoder gone')

    broken = Broken()
    healthy = SpyWriter()
    recording_control._writers[('m1', 'curiosity')] = broken
    recording_control._paths[('m1', 'curiosity')] = '/tmp/m1.mp4'
    recording_control._writers[('m2', 'curiosity')] = healthy
    recording_control._paths[('m2', 'curiosity')] = '/tmp/m2.mp4'

    recording_control._write_frame_to_all(_frame())

    assert healthy.writes == 1


def _frame():
    numpy = pytest.importorskip('numpy')
    return numpy.zeros((4, 6, 3), dtype=numpy.uint8)

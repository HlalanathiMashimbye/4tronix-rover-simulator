"""Colour fidelity of the camera pipeline.

This shipped, reached a demo, and was reported as "red and green are swapped".
It was actually red and blue: Picamera2's format names describe libcamera's
packing rather than numpy's axis order, so a camera configured as "RGB888"
hands back channels already in the B, G, R order OpenCV expects. Converting
RGB->BGR on top of that swapped them a second time.

It survived review because the only thing anyone inspected closely was the
detection overlay, drawn (0, 255, 0) - and pure green is invariant under an
R/B swap.

A pixel of a known colour therefore has to come out that colour, which is what
these assert, end to end through the real JPEG encode.
"""

import base64

import numpy as np
import pytest

cv2 = pytest.importorskip('cv2')

import camera_server


class FakeRequest:
    """Stands in for a Picamera2 capture_request()."""

    def __init__(self, array):
        self._array = array

    def make_array(self, _name):
        return self._array

    def get_metadata(self):
        return {}

    def release(self):
        pass


class FakeCamera:
    def __init__(self, array):
        self._array = array

    def capture_request(self):
        return FakeRequest(self._array)


def _decode(encoded):
    raw = base64.b64decode(encoded)
    return cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)


@pytest.fixture
def picamera(monkeypatch):
    """The IMX500 path, which is what the satellite actually runs."""
    def _install(array):
        monkeypatch.setattr(camera_server, 'camera_backend', 'imx500')
        monkeypatch.setattr(camera_server, 'camera', FakeCamera(array))
        monkeypatch.setattr(camera_server, 'parse_detections', lambda _m: [])
        return camera_server.capture_frame()
    return _install


# (name, BGR pixel as the camera delivers it)
COLOURS = [
    ('red',   (0, 0, 255)),
    ('green', (0, 255, 0)),
    ('blue',  (255, 0, 0)),
    ('wood',  (63, 102, 145)),   # the desk that filmed blue-grey
]


@pytest.mark.parametrize('name,bgr', COLOURS)
def test_a_known_colour_survives_the_pipeline(picamera, name, bgr):
    frame = np.full((32, 32, 3), bgr, dtype=np.uint8)

    out = _decode(picamera(frame))

    # JPEG is lossy, so compare with tolerance rather than exactly.
    assert np.allclose(out[16, 16], bgr, atol=12), \
        f'{name} came back as {tuple(int(c) for c in out[16, 16])}, expected {bgr}'


def test_red_and_blue_are_not_exchanged(picamera):
    """The specific defect, named.

    Pure green passing is not evidence of anything: it is unchanged by the very
    swap this is looking for.
    """
    red = np.full((32, 32, 3), (0, 0, 255), dtype=np.uint8)   # BGR red

    out = _decode(picamera(red))
    b, g, r = (int(c) for c in out[16, 16])

    assert r > 200 and b < 60, f'red arrived as B={b} G={g} R={r}'

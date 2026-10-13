"""Which way up the camera's picture is.

The Cape Town camera is mounted so that the yard films half a turn round from
the simulator's map: the start spot on the right of the video and on the left
of the simulation, north at the bottom. It went unnoticed until Mission Control
showed the two at the same size, one above the other (13 October 2026).

Settings can turn the picture. These hold that it really is turned, in the one
place a frame is made, so the monitor, the run station and the recording all
get the same picture; and that what is drawn on it is drawn after the turn, so
a label is never upside down.
"""

import base64

import pytest

# As test_camera_colour: skipped where opencv and numpy are not installed,
# which is the case in CI.
cv2 = pytest.importorskip('cv2')
np = pytest.importorskip('numpy')

import camera_server
import tunables

WIDTH, HEIGHT = 64, 48
RED = (0, 0, 255)       # BGR
GREEN = (0, 255, 0)     # what a detection box is drawn in


class FakeRequest:
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


class FakeWebcam:
    def __init__(self, array):
        self._array = array

    def read(self):
        return True, self._array


def _decode(encoded):
    raw = base64.b64decode(encoded)
    return cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)


def _yard_with_a_red_corner():
    """Grey, with the top-left quarter red: a picture that has a way up."""
    frame = np.full((HEIGHT, WIDTH, 3), 128, dtype=np.uint8)
    frame[: HEIGHT // 2, : WIDTH // 2] = RED
    return frame


def _is(pixel, bgr):
    # JPEG is lossy, so near enough.
    return bool(np.allclose(pixel, bgr, atol=40))


TOP_LEFT = (HEIGHT // 4, WIDTH // 4)
BOTTOM_RIGHT = (3 * HEIGHT // 4, 3 * WIDTH // 4)


@pytest.fixture(autouse=True)
def _ask_the_setting_afresh(monkeypatch):
    # The camera trusts one reading of the setting for a second.
    monkeypatch.setattr(camera_server, '_turn_read', None)


@pytest.fixture
def picamera(monkeypatch):
    def _install(array, detections=()):
        monkeypatch.setattr(camera_server, 'camera_backend', 'imx500')
        monkeypatch.setattr(camera_server, 'camera', FakeCamera(array))
        monkeypatch.setattr(camera_server, 'parse_detections', lambda _m: list(detections))
        return _decode(camera_server.capture_frame())
    return _install


@pytest.fixture
def webcam(monkeypatch):
    def _install(array):
        monkeypatch.setattr(camera_server, 'camera_backend', 'webcam')
        monkeypatch.setattr(camera_server, 'webcam', FakeWebcam(array))
        return _decode(camera_server.capture_frame())
    return _install


class TestThePictureIsTurned:
    def test_as_mounted_until_settings_says_otherwise(self, picamera):
        out = picamera(_yard_with_a_red_corner())

        assert _is(out[TOP_LEFT], RED)
        assert not _is(out[BOTTOM_RIGHT], RED)

    def test_half_a_turn_puts_the_top_left_at_the_bottom_right(self, picamera):
        tunables.save({'cameraRotation': '180'})

        out = picamera(_yard_with_a_red_corner())

        assert _is(out[BOTTOM_RIGHT], RED)
        assert not _is(out[TOP_LEFT], RED)

    def test_the_picture_keeps_its_size(self, picamera):
        tunables.save({'cameraRotation': '180'})

        out = picamera(_yard_with_a_red_corner())

        assert out.shape[:2] == (HEIGHT, WIDTH)

    def test_a_plain_webcam_is_turned_as_well(self, webcam):
        # The Mac a yard is developed on, and any satellite without the Pi's
        # camera. One setting, both ways of getting a frame.
        tunables.save({'cameraRotation': '180'})

        out = webcam(_yard_with_a_red_corner())

        assert _is(out[BOTTOM_RIGHT], RED)
        assert not _is(out[TOP_LEFT], RED)

    def test_a_plain_webcam_is_left_alone_by_default(self, webcam):
        out = webcam(_yard_with_a_red_corner())

        assert _is(out[TOP_LEFT], RED)


class TestWhatIsDrawnOnIt:
    # A box 20 wide and 12 tall, its corner 6 in and 30 down.
    BOX = {'box': (6, 30, 20, 12), 'label': 'rover', 'confidence': 0.9}

    def test_a_detection_moves_with_the_thing_it_found(self, picamera):
        tunables.save({'cameraRotation': '180'})
        grey = np.full((HEIGHT, WIDTH, 3), 128, dtype=np.uint8)

        out = picamera(grey, detections=[self.BOX])

        # Its left edge was at x=6. Turned, the box runs from 38 to 58 across
        # and from 6 to 18 down, so its left edge is at x=38.
        assert _is(out[12, 38], GREEN)
        assert not _is(out[36, 6], GREEN)

    def test_a_detection_stays_where_it_was_as_mounted(self, picamera):
        grey = np.full((HEIGHT, WIDTH, 3), 128, dtype=np.uint8)

        out = picamera(grey, detections=[self.BOX])

        assert _is(out[36, 6], GREEN)

    def test_the_label_sits_above_its_box_in_the_turned_picture_too(self, picamera):
        # A label is drawn above its box. Drawn before the turn, it would be
        # carried round with the picture and end up under the box, upside
        # down. This box turns to one whose top edge is at y=26.
        tunables.save({'cameraRotation': '180'})
        grey = np.full((HEIGHT, WIDTH, 3), 128, dtype=np.uint8)
        box = {'box': (6, 10, 20, 12), 'label': 'rover', 'confidence': 0.9}

        out = picamera(grey, detections=[box])

        assert _is(out[7, 50], GREEN), 'no label above the turned box'
        assert not _is(out[44, 50], GREEN), 'the label is under the box: it was drawn before the turn'

    def test_the_label_is_drawn_after_the_turn_so_it_reads_the_right_way_up(self):
        # Drawn first, the label would be turned with the picture. So the
        # turn hands back the frame with nothing on it yet, and the boxes
        # moved, for the drawing to come after.
        frame = _yard_with_a_red_corner()

        turned, moved = camera_server.turn_round(frame, [self.BOX])

        assert not (turned == GREEN).all(axis=2).any()
        assert moved == [{'box': (38, 6, 20, 12), 'label': 'rover', 'confidence': 0.9}]

    def test_what_it_was_handed_is_not_changed(self):
        frame = _yard_with_a_red_corner()
        before = frame.copy()
        detections = [dict(self.BOX)]

        camera_server.turn_round(frame, detections)

        assert (frame == before).all()
        assert detections == [self.BOX]


class TestHearingOfAChange:
    def test_a_change_on_the_settings_page_is_picked_up_without_a_restart(self, monkeypatch):
        clock = [100.0]
        monkeypatch.setattr(camera_server.time, 'monotonic', lambda: clock[0])
        assert camera_server.turned_round() is False

        tunables.save({'cameraRotation': '180'})
        clock[0] += 1.5

        assert camera_server.turned_round() is True

    def test_the_file_is_not_read_for_every_frame(self, monkeypatch):
        # Fifteen frames a second, on a Pi.
        asked = []
        monkeypatch.setattr(tunables, 'camera_turned_round', lambda: asked.append(1) or True)
        clock = [100.0]
        monkeypatch.setattr(camera_server.time, 'monotonic', lambda: clock[0])

        for _ in range(15):
            clock[0] += 1 / 15
            camera_server.turned_round()

        assert len(asked) <= 2

    def test_a_setting_that_cannot_be_read_means_as_mounted_not_no_camera(self, monkeypatch):
        def broken():
            raise OSError('settings file gone')
        monkeypatch.setattr(tunables, 'camera_turned_round', broken)

        assert camera_server.turned_round() is False

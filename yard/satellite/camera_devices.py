"""
Which cameras this machine has, by name.

Settings picks the camera by index, which on the Pi is always 0 and on a Mac is
a guess: a MacBook with a phone nearby has the built-in camera, Continuity
Camera and often Desk View, and nothing says which number is which. David's
MacBook satellite mode (upstream, June 2026) solved this with a dropdown of
real names; this is that enumeration, moved here so it serves the fork's one
camera server instead of needing a second one.

Names come from AVFoundation, which lists devices without opening them. That
matters twice: it needs no Camera permission, and it never touches a device the
running camera is holding. David's fallback probed indices with OpenCV when
pyobjc was missing; that is left out deliberately, because opening a device to
read its size is exactly what fights the live stream for it.

Off macOS, or without pyobjc, this returns None and Settings keeps the plain
number field, so the Pi is unchanged.
"""

import sys


def _avfoundation_names():
    """Device names in AVFoundation order, or None where it is unavailable.

    The order is the one OpenCV's AVFoundation backend uses for its indices,
    which is what lets a name stand in for CAMERA_INDEX.
    """
    try:
        from AVFoundation import (
            AVMediaTypeVideo,
            AVCaptureDeviceDiscoverySession,
            AVCaptureDeviceTypeBuiltInWideAngleCamera,
            AVCaptureDeviceTypeExternalUnknown,
        )
    except ImportError:
        return None
    try:
        session = AVCaptureDeviceDiscoverySession.discoverySessionWithDeviceTypes_mediaType_position_(
            [AVCaptureDeviceTypeBuiltInWideAngleCamera, AVCaptureDeviceTypeExternalUnknown],
            AVMediaTypeVideo,
            0,  # AVCaptureDevicePositionUnspecified
        )
        return [str(d.localizedName()) for d in session.devices()]
    except Exception:
        return None


def list_cameras():
    """[{index, name}] for each camera, or None when names are unavailable.

    Empty is a real answer (a Mac with no camera attached) and is different
    from None (this machine cannot say).
    """
    if sys.platform != 'darwin':
        return None
    names = _avfoundation_names()
    if names is None:
        return None
    return [{'index': i, 'name': name} for i, name in enumerate(names)]

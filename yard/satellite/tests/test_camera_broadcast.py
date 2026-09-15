"""A viewer that stops reading must not stop the camera for everyone else.

15 September 2026: a browser tab on an operator's laptop stopped reading the
camera stream. broadcast_frame awaited each client's send in turn, the send to
that tab never completed, and no frame reached any other client while the tab
stayed open - the other monitors, the readiness probe, and the recording. The
process stayed up and the port stayed open, so every health check passed.

These run the real websocket server on a loopback port against a real stalled
connection: a socket that completes the handshake and then never reads.
"""

import asyncio
import base64
import contextlib
import importlib.util
import os
import socket

import websockets


def _load_camera_server():
    spec = importlib.util.spec_from_file_location(
        'camera_server_broadcast',
        os.path.join(os.path.dirname(__file__), '..', 'camera_server.py'),
    )
    cam = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cam)
    return cam


# Large enough that a connection which is not reading fills every buffer on the
# way to it within a second or so, the way a real 15 fps stream does over time.
FRAME = base64.b64encode(os.urandom(200_000)).decode('ascii')


def _stalled_connection(port):
    """Complete a WebSocket handshake, then never read again."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    sock.connect(('127.0.0.1', port))
    key = base64.b64encode(os.urandom(16)).decode('ascii')
    sock.sendall((
        f'GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n'
        'Upgrade: websocket\r\nConnection: Upgrade\r\n'
        f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'
    ).encode('ascii'))
    response = b''
    while b'\r\n\r\n' not in response:
        chunk = sock.recv(1)
        if not chunk:
            raise RuntimeError('the server closed the connection during the handshake')
        response += chunk
    assert b' 101 ' in response.split(b'\r\n', 1)[0], response
    return sock


def _serve(cam, scenario):
    """Run the camera's own handler and frame producer around a scenario."""
    async def main():
        cam.clients.clear()
        cam.running = True
        cam.capture_frame = lambda: FRAME
        async with websockets.serve(cam.handle_client, '127.0.0.1', 0) as server:
            port = server.sockets[0].getsockname()[1]
            producer = asyncio.create_task(cam.frame_producer())
            try:
                return await scenario(port)
            finally:
                cam.running = False
                producer.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await producer
                cam.clients.clear()

    return asyncio.run(main())


def test_a_viewer_that_stops_reading_does_not_starve_the_others():
    cam = _load_camera_server()

    async def scenario(port):
        loop = asyncio.get_running_loop()
        arrivals = []

        async with websockets.connect(f'ws://127.0.0.1:{port}', max_size=None) as healthy:
            async def keep_reading():
                async for _ in healthy:
                    arrivals.append(loop.time())

            reader = asyncio.create_task(keep_reading())
            stalled = await loop.run_in_executor(None, _stalled_connection, port)
            try:
                # Give the stalled connection time to fill every buffer toward
                # it, then count what the healthy viewer gets after that.
                stalled_from = loop.time() + 2
                await asyncio.sleep(4)
                return sum(1 for t in arrivals if t >= stalled_from)
            finally:
                stalled.close()
                reader.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await reader

    received = _serve(cam, scenario)

    # 15 fps for two seconds is 30. Awaiting each send, this was 0.
    assert received >= 10, (
        f'the healthy viewer got {received} frames in 2s while another viewer was stalled')


def test_a_viewer_that_stays_stalled_is_disconnected():
    cam = _load_camera_server()
    cam.MAX_CLIENT_BACKLOG_BYTES = 256_000
    cam.STALLED_CLIENT_SECONDS = 1.0

    async def scenario(port):
        loop = asyncio.get_running_loop()
        stalled = await loop.run_in_executor(None, _stalled_connection, port)
        try:
            deadline = loop.time() + 8
            while loop.time() < deadline:
                if not cam.clients:
                    return True
                await asyncio.sleep(0.2)
            return False
        finally:
            stalled.close()

    assert _serve(cam, scenario), (
        'a viewer that stopped reading was still connected 8 seconds later')

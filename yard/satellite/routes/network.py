"""
Where this satellite can be reached, for the pages that print it.

The TV footer and the station hub show the address a tablet should type, and
the run station connects to the camera on the same machine. Read once at
import, after web_server has loaded .env.
"""

import os
import socket

CAMERA_PORT = int(os.environ.get('CAMERA_PORT', 8890))

# Read here rather than only in __main__ so the monitor can print the address
# a tablet should actually be typing. The TV footer used to hard-code :5050,
# which stopped being true when the default moved to 3001 - a wrong number on
# a wall-mounted screen is worse than no number at all.
SERVER_PORT = int(os.environ.get('SATELLITE_PORT', 3001))


def local_ip():
    # UDP connect never sends a packet: the OS just picks the right source
    # interface from the routing table. Try private ranges then fall back.
    for dest in ('10.255.255.255', '192.168.255.255', '172.16.255.255'):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((dest, 1))
            ip = s.getsockname()[0]
            s.close()
            if not ip.startswith('127.'):
                return ip
        except Exception:
            pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return 'unknown'

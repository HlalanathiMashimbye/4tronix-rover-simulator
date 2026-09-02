"""
Finding the rover, so nobody has to type an address under pressure.

Setting the rover path meant typing a scheme, a host and a port correctly into
a box that checked only that it began with http. A wrong-but-well-formed
address saved happily and the yard then looked broken for a reason the page
never mentioned. That is a bad thing to meet at a demo, which is where it was
met.

Two halves. `discover` finds rovers that are actually answering, so the normal
path is picking one rather than typing. `probe` says whether a given address
has a rover behind it, so a typed one is checked before it is saved instead of
after it fails.
"""

import ipaddress
import re
import socket
from concurrent.futures import ThreadPoolExecutor

import requests

ROVER_PORT = 8523

# Hostnames, .local names and IPv4. Deliberately not a URL parser: this is
# checking that what was typed could be a machine on this network.
_HOST_RE = re.compile(r'^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$')

# Names worth trying before sweeping anything: the two this project has used,
# plus whatever is configured now.
KNOWN_HOSTS = ('curiosity.local', 'marspi.local', 'rover.local')

# Short. A rover on the same LAN answers in milliseconds; anything slower is a
# host that is not there, and there may be 254 of them.
CONNECT_TIMEOUT = 0.35
HEALTH_TIMEOUT = 1.5


def _health(base_url, timeout=HEALTH_TIMEOUT):
    """The rover's own description of itself, or None if it is not a rover."""
    try:
        resp = requests.get(f'{base_url}/health', timeout=timeout)
        if resp.status_code != 200:
            return None
        data = resp.json()
    except (requests.exceptions.RequestException, ValueError):
        return None
    # A 200 from something else on that port is not a rover. Insisting on a
    # field only the rover server returns is what makes this a real check
    # rather than a port scan with opinions.
    if not isinstance(data, dict) or 'driver' not in data:
        return None
    return data


def probe(url):
    """(ok, detail_or_health) for one address, already normalised."""
    health = _health(url)
    if health is None:
        return False, 'nothing answered as a rover at that address'
    return True, health


def _port_open(host, port=ROVER_PORT, timeout=CONNECT_TIMEOUT):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _local_subnet():
    """The /24 this satellite is on, or None if that cannot be worked out."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
        s.close()
        return ipaddress.ip_network(f'{ip}/24', strict=False), ip
    except Exception:
        return None, None


def discover(current_url=None, sweep=True):
    """Rovers answering on this network, best candidate first.

    Names are tried before the sweep because they are nearly free and usually
    right. The sweep is the fallback for the case that actually caused this -
    mDNS not resolving, and an operator reaching for an address they half
    remember.
    """
    found = []
    seen = set()

    def consider(base_url):
        if base_url in seen:
            return
        seen.add(base_url)
        health = _health(base_url, timeout=1.0)
        if health:
            found.append({'url': base_url, 'health': health})

    candidates = []
    if current_url:
        candidates.append(current_url.rstrip('/'))
    candidates += [f'http://{h}:{ROVER_PORT}' for h in KNOWN_HOSTS]
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(consider, candidates))

    if found or not sweep:
        return found

    network, own_ip = _local_subnet()
    if network is None:
        return found

    hosts = [str(h) for h in network.hosts() if str(h) != own_ip]
    with ThreadPoolExecutor(max_workers=64) as pool:
        open_hosts = [h for h, is_open in
                      zip(hosts, pool.map(_port_open, hosts)) if is_open]

    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(lambda h: consider(f'http://{h}:{ROVER_PORT}'), open_hosts))

    return found


def normalise(raw):
    """What somebody typed, turned into an address that can be tried.

    Accepts `curiosity`, `curiosity.local`, `192.168.1.5`, `host:8523` and a
    full URL. The scheme and the port are not decisions an operator should have
    to make correctly at a demo, so they are filled in when absent.
    """
    text = (raw or '').strip()
    if not text:
        return ''
    # Strip trailing slashes only AFTER the scheme check. Doing it first turns
    # "http://" into "http:", which then looks schemeless and collects a second
    # one: "http://http:".
    if '://' not in text:
        text = 'http://' + text
    text = text.rstrip('/')
    # After stripping, "http://" is just "http" and there is nothing to point
    # at. Anything without a host is not an address.
    if '://' not in text:
        return ''
    scheme, rest = text.split('://', 1)
    # Only the two schemes the rover speaks. ftp://x is a typo, not an address
    # that happens to be down, and the two deserve different answers.
    if scheme.lower() not in ('http', 'https'):
        return ''
    if not rest or rest.startswith(':'):
        return ''
    # A port only counts if it is after the host, not inside an IPv6 literal.
    host_part = rest.split('/', 1)[0]
    if not host_part:
        return ''

    # Check the shape of the host and port, not just that a colon exists.
    # Without this, "javascript:alert(1)" normalises to a host called
    # javascript on port alert(1) - accepted, saved, and nonsense.
    host, _, port = host_part.partition(':')
    if not host or not _HOST_RE.match(host):
        return ''
    if port and not port.isdigit():
        return ''

    if not port:
        rest = host_part + f':{ROVER_PORT}' + rest[len(host_part):]
    return f'{scheme}://{rest}'.rstrip('/')

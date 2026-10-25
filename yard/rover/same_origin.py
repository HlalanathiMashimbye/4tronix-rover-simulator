"""Only same-origin callers may change the rover's state: a CSRF boundary.

The rover server has no sign-in: it is reached over the yard LAN by the
satellite, server to server. The one state-changing endpoint a browser can
reach cross-site is POST /queue/clear, which takes no body, so before this
gate any website a browser on the yard wifi had open could stop the rover
mid-run. /queue/add needs a JSON body and this server sends no CORS headers,
so a browser cannot usefully drive it cross-site; the gate covers it anyway,
so the next POST added here cannot regress into a hole.

The satellite's proxy calls this server with no Origin (it is not a browser),
so it keeps working untouched.

This is the same rule as the satellite's own same_origin.py. The yard packages
share no code (they run on different machines), so each keeps its own copy, and
a test in each pins the same three cases so the two cannot drift apart.
"""

from urllib.parse import urlsplit

# Methods that cannot change state, so they need no check. Flask adds HEAD and
# OPTIONS itself; both are safe, as is GET.
SAFE_METHODS = frozenset({'GET', 'HEAD', 'OPTIONS'})

# The Sec-Fetch-Site values that mean "from this same origin, or from no site
# at all". same-site and cross-site are both refused.
ALLOWED_FETCH_SITES = frozenset({'same-origin', 'none'})


def is_allowed(method, host, sec_fetch_site, origin):
    """Whether a request may change state, from what the browser says about it.

    host is the request's own Host (request.host). sec_fetch_site and origin
    are the matching request headers, or None when a header is absent.
    """
    if method in SAFE_METHODS:
        return True
    if sec_fetch_site is not None:
        return sec_fetch_site in ALLOWED_FETCH_SITES
    if origin:
        return urlsplit(origin).netloc == host
    # Neither header: not a browser page, so not a CSRF vector.
    return True

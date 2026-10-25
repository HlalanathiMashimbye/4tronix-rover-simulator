"""Only the satellite's own pages may change its state: a CSRF boundary.

The console has no sign-in and must not grow one: it has to work on a night
with no internet, and a Firebase sign-in needs internet (satellite_identity.py
has the longer version). So the thing that guards a state-changing endpoint
cannot be "who are you", it has to be "where did this request come from".
Every page of the console fetches same-origin, so a request that did not come
from the satellite's own origin did not come from the console.

The hole this closes: a browser on the yard's open wifi can have any website
open in another tab, and that site can POST a plain cross-site form to the
satellite. The browser sends it with no preflight, so an endpoint that reads
no JSON body fires anyway. The worst is POST /operator/api/satellite/shutdown,
which takes no body and powers the box off; /api/queue/clear (stops the rover)
and the camera and recording stops are the same shape.

The check reads the browser's own account of where the request came from, and
a page cannot forge either header about itself:
- Sec-Fetch-Site, which a modern browser sets on every request: anything other
  than same-origin, or none (a typed URL or a bookmark), is refused.
- Origin, the fallback for a browser too old to send Sec-Fetch-Site: its
  host:port must be the satellite's own host.
A request carrying neither header is not a browser page (curl, the satellite's
own server-to-server tooling, the tests), and is allowed: CSRF is a browser
problem, and a browser always sends Origin on a cross-origin POST.

This is not a sign-in and adds no gate an operator can hit when the wifi is
down: a request from the console's own pages always passes, online or off.
The identical rule guards the rover server; see yard/rover/same_origin.py for
why each package keeps its own copy.
"""

from urllib.parse import urlsplit

# Methods that cannot change state, so they need no check. Flask adds HEAD and
# OPTIONS itself; both are safe, as is GET.
SAFE_METHODS = frozenset({'GET', 'HEAD', 'OPTIONS'})

# The Sec-Fetch-Site values that mean "from this same origin, or from no site
# at all". same-site and cross-site are both refused: the console is only ever
# reached same-origin, so there is no same-site caller to keep working.
ALLOWED_FETCH_SITES = frozenset({'same-origin', 'none'})


def is_allowed(method, host, sec_fetch_site, origin):
    """Whether a request may change state, from what the browser says about it.

    host is the request's own Host (request.host), for example 'mro.local:3001'
    or an IP and port, so the page works however a tablet reached it.
    sec_fetch_site and origin are the matching request headers, or None when a
    header is absent.
    """
    if method in SAFE_METHODS:
        return True
    if sec_fetch_site is not None:
        return sec_fetch_site in ALLOWED_FETCH_SITES
    if origin:
        return urlsplit(origin).netloc == host
    # Neither header: not a browser page, so not a CSRF vector.
    return True

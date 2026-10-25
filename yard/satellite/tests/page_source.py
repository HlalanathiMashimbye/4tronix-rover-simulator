"""A page with its own script: the HTML and what it loads from static/pages/.

Each page's script lives in static/pages/, not inline, so a test that reads a
page's text reads that too. Shared files (yard-cache.js, camera-client.js)
are left out, as they were when the scripts were inline.
"""

import re


def page_source(client, path):
    html = client.get(path).get_data(as_text=True)
    scripts = [client.get(src).get_data(as_text=True)
               for src in re.findall(r'<script[^>]*\bsrc="(/static/pages/[^"]+\.js)"', html)]
    return '\n'.join([html, *scripts])

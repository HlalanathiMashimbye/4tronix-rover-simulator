"""
Every route the satellite serves outside /operator, as three blueprints.

These lived in web_server.py, which was the Flask app, its configuration, its
state and twenty-odd routes in one 700-line module, with the app built at
import time and the rover's address in a `global`. web_server.py is the app
factory now; the routes are grouped by what they are about. The /operator
routes stay in the console package, for the reason its __init__ gives.
"""

from routes.pages import pages_bp
from routes.recordings import recordings_bp
from routes.rover import rover_bp

BLUEPRINTS = (pages_bp, rover_bp, recordings_bp)

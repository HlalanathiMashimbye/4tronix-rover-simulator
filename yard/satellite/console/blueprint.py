"""
The one Flask blueprint every console route registers on.

Its own module so route modules can import it without importing each other,
and without importing the package's __init__, which is what pulls them all
in. That is the whole trick that lets the console's routes live in several
files and still be one blueprint.

No count here on purpose: this said "twenty-three routes in six files" long
after most of them had moved back out, and a number in a comment is only ever
true on the day it is written.
"""

from flask import Blueprint

operator_bp = Blueprint('operator', __name__, url_prefix='/operator')

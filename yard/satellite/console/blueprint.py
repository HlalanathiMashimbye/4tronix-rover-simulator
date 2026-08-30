"""
The one Flask blueprint every console route registers on.

Its own module so route modules can import it without importing each other,
and without importing the package's __init__, which is what pulls them all
in. That is the whole trick that lets twenty-three routes live in six files
and still be one blueprint.
"""

from flask import Blueprint

operator_bp = Blueprint('operator', __name__, url_prefix='/operator')

# These examples used to sit at the repo root; roversimulator now lives in
# legacy/simulator/ alongside them one level up. Put that folder on sys.path
# so the rover library modules (roversimulator, rover_web_driver) import.
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.abspath(_os.path.join(_os.path.dirname(__file__), _os.pardir, 'simulator')))

import sys
from time import sleep
import roversimulator as rover


rover.init(0)

print("Main thread sleeping")
sleep(100)
print("Main thread done")

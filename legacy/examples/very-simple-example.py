# These examples used to sit at the repo root; roversimulator now lives in
# legacy/simulator/ alongside them one level up. Put that folder on sys.path
# so the rover library modules (roversimulator, rover_web_driver) import.
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.abspath(_os.path.join(_os.path.dirname(__file__), _os.pardir, 'simulator')))

import roversimulator as rover
import time

# Servo numbers (so we know which servos control which wheel)
servo_FL = 9
servo_RL = 11
servo_FR = 15
servo_RR = 13
servo_MA = 0

rover.init(0)

# Get the rover moving forward at full speed.
#
# First, make all the steerable wheels point forwards.
rover.setServo(servo_FL, 0)
rover.setServo(servo_FR, 0)
rover.setServo(servo_RL, 0)
rover.setServo(servo_RR, 0)
# And now it's full speed ahead.
rover.forward(100)


# Let it move for 3 seconds
time.sleep(3)


# Now adjust the servo positions so that it's steering left
rover.setServo(servo_FL, -20)
rover.setServo(servo_FR, -20)
rover.setServo(servo_RL, 20)
rover.setServo(servo_RR, 20)


# Let it move for another 3 seconds
time.sleep(3)

# Now steer right
rover.setServo(servo_FL, 20)
rover.setServo(servo_FR, 20)
rover.setServo(servo_RL, -20)
rover.setServo(servo_RR, -20)


# Let it move for another 3 seconds
time.sleep(3)

# Straighten up.
rover.setServo(servo_FL, 0)
rover.setServo(servo_FR, 0)
rover.setServo(servo_RL, 0)
rover.setServo(servo_RR, 0)


# Let it move for another 3 seconds
time.sleep(3)


# ...and rest.
rover.forward(0)

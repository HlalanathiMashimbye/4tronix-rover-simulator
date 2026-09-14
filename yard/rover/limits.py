"""
Mission and rover safety limits.
These are absolute maximums and serve as safety ceilings.
"""

MISSION_TIME_LIMIT_SECONDS = 120
MAX_ROVER_SPEED = 100

# Zero, not -100: direction is the command (forward, reverse), and a negative
# speed is a PWM duty cycle the motor driver refuses.
MIN_ROVER_SPEED = 0

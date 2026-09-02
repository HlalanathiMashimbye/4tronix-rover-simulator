# Running from a subfolder: put the repo root on sys.path so the rover
# library modules that live at the root (roversimulator, rover_web_driver) import.
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.abspath(_os.path.join(_os.path.dirname(__file__), _os.pardir)))

#!/usr/bin/env python3
"""
Example: Connecting to the real rover

This demonstrates how to use rover_web_driver.py to connect to the real
rover hardware instead of the simulator.

Replace ROVER_IP with your Raspberry Pi's IP address.
"""

from rover_web_driver import RoverWebDriver
from time import sleep

# Connect to the real rover (replace with your Raspberry Pi's IP)
ROVER_IP = "192.168.1.100"  # Change this to your rover's IP address
rover = RoverWebDriver(f"http://{ROVER_IP}:8523/")

# Initialize
rover.init(40)

# Drive forward
print("Moving forward...")
rover.forward(50)
sleep(2)

# Stop
print("Stopping...")
rover.stop()
sleep(1)

# Spin
print("Spinning right...")
rover.spinRight(50)
sleep(2)

# Stop and cleanup
rover.stop()
rover.cleanup()

print("Done!")

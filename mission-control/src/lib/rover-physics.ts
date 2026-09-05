/**
 * Client-side rover physics engine for real-time manual control
 * Based on legacy/simulator/roversimui.py Rover class
 */

const FULL_SPEED_CM_PER_SECOND = 10;
const VEHICLE_WIDTH_CM = 16;
const DISTANCE_BETWEEN_WHEEL_PAIRS_CM = 8;

const ROVER_MARGIN = 12; // keep the rover body visually inside the yard border
// Must match YARD_W/YARD_H in roverSimRender.ts, which explains the size.
const YARD_HALF_W = 120 - ROVER_MARGIN; // 240 cm wide, origin at centre
const YARD_HALF_H = 90 - ROVER_MARGIN; // 180 cm tall, origin at centre

/**
 * How far each wheel sits from the point the rover turns about.
 *
 * The four wheels are the corners of a VEHICLE_WIDTH x DISTANCE_BETWEEN_PAIRS
 * rectangle, so this is the half-diagonal. It only matters for spinning on the
 * spot, where it sets how fast a given wheel speed swings the body round.
 */
const WHEEL_DISTANCE_FROM_CENTRE_CM = Math.hypot(
  VEHICLE_WIDTH_CM / 2,
  DISTANCE_BETWEEN_WHEEL_PAIRS_CM / 2
);

/**
 * Turns the geometric spin rate into the one the rover actually achieves.
 *
 * MEASURED ON THE ROVER, 5 September 2026, on a high-grip floor at speed 60.
 * Six runs, 108 seconds of spinning in total:
 *
 *     4.7s ->  210 deg     18.7s ->  810 deg     25.0s -> 1110 deg
 *     9.4s ->  435 deg      9.4s ->  440 deg     41.0s -> 1890 deg
 *
 * Pooled: 45.29 deg/s, against 38.44 from the geometry below. The rover turns
 * FASTER than a perfect pivot, not slower, which is why this is a calibration
 * and not the "scrub factor" it was first written as - scrub can only lose
 * rotation. The wheels sit at 50 degrees where the angle tangent to the circle
 * they trace is 26.6, so the rover pivots about a point 7.6cm from each wheel
 * rather than the 8.9cm half-diagonal, and a smaller circle turns faster.
 *
 * Confirmed by prediction rather than by fitting: at this value a 90 degree
 * turn sleeps 1.987s, and four of them brought the rover back to its starting
 * heading. At the old value they overshot by 60 to 90 degrees.
 *
 * IT IS ONE SURFACE AND ONE BATTERY STATE. Grip changes how much the tyres
 * slide, so a smooth floor will not give the same number. To recalibrate, spin
 * at speed 60 for a known time, count the degrees turned, and set this to
 * (measured degrees per second) / 38.44.
 */
export const SPIN_RATE_CALIBRATION = 1.178;

/** The wheel angle a steer block uses when the caller does not name one. */
export const DEFAULT_STEER_DEGREES = 30;

const SERVO_FL = 9;
const SERVO_FR = 15;
const SERVO_RL = 11;
const SERVO_RR = 13;

export interface RoverState {
  x: number;
  y: number;
  heading: number;
  speedL: number;
  speedR: number;
  servos: number[];
  hitWall: boolean;
}

export class RoverPhysics {
  private state: RoverState;
  private lastUpdate: number;

  constructor() {
    this.state = {
      x: 0,
      y: 0,
      heading: 0,
      speedL: 0,
      speedR: 0,
      servos: new Array(16).fill(0),
      hitWall: false,
    };
    this.lastUpdate = Date.now();
  }

  /**
   * @param degrees  Wheel angle for steerLeft/steerRight, in degrees.
   *
   * This used to be missing, and steering was hardcoded to 30 degrees no
   * matter what the learner asked for: a mission that steered 10 degrees and
   * one that steered 45 drew the identical curve, because parseRoverCode read
   * the angle off `setServo` and then nothing passed it on. It is optional
   * only so manual control, which has no angle to give, keeps working.
   */
  setCommand(command: string, speed: number = 80, degrees?: number) {
    const steer = Math.abs(degrees ?? DEFAULT_STEER_DEGREES);
    switch (command) {
      case 'forward':
        this.state.servos[SERVO_FL] = 0;
        this.state.servos[SERVO_FR] = 0;
        this.state.servos[SERVO_RL] = 0;
        this.state.servos[SERVO_RR] = 0;
        this.state.speedL = speed;
        this.state.speedR = speed;
        break;

      case 'reverse':
        this.state.servos[SERVO_FL] = 0;
        this.state.servos[SERVO_FR] = 0;
        this.state.servos[SERVO_RL] = 0;
        this.state.servos[SERVO_RR] = 0;
        this.state.speedL = -speed;
        this.state.speedR = -speed;
        break;

      case 'spinLeft':
        this.state.servos[SERVO_FL] = 50;
        this.state.servos[SERVO_FR] = -50;
        this.state.servos[SERVO_RL] = -50;
        this.state.servos[SERVO_RR] = 50;
        this.state.speedL = -speed;
        this.state.speedR = speed;
        break;

      case 'spinRight':
        this.state.servos[SERVO_FL] = 50;
        this.state.servos[SERVO_FR] = -50;
        this.state.servos[SERVO_RL] = -50;
        this.state.servos[SERVO_RR] = 50;
        this.state.speedL = speed;
        this.state.speedR = -speed;
        break;

      case 'steerLeft':
        this.state.servos[SERVO_FL] = -steer;
        this.state.servos[SERVO_FR] = -steer;
        this.state.servos[SERVO_RL] = steer;
        this.state.servos[SERVO_RR] = steer;
        this.state.speedL = speed;
        this.state.speedR = speed;
        break;

      case 'steerRight':
        this.state.servos[SERVO_FL] = steer;
        this.state.servos[SERVO_FR] = steer;
        this.state.servos[SERVO_RL] = -steer;
        this.state.servos[SERVO_RR] = -steer;
        this.state.speedL = speed;
        this.state.speedR = speed;
        break;

      case 'stop':
        this.state.speedL = 0;
        this.state.speedR = 0;
        this.state.servos[SERVO_FL] = 0;
        this.state.servos[SERVO_FR] = 0;
        this.state.servos[SERVO_RL] = 0;
        this.state.servos[SERVO_RR] = 0;
        break;
    }
  }

  update(dtOverride?: number): RoverState {
    const currentTime = Date.now();
    // Real-time callers pass nothing (wall-clock dt); the batch simulator passes
    // a fixed dt so a trajectory can be computed deterministically off-clock.
    // The wall-clock dt is clamped: if the timer is stale (the first tap after
    // the page sat idle, or returning from a backgrounded tab) an unclamped dt
    // would teleport the rover across the yard in a single step.
    const dt =
      dtOverride !== undefined
        ? dtOverride
        : Math.min(Math.max(0, (currentTime - this.lastUpdate) / 1000), 0.1);
    this.lastUpdate = currentTime;

    // Calculate new position based on current speeds and servo angles
    const calculateSteeredPosition = (
      left: boolean,
      wheelAngleDegrees: number,
      wheelSpeed: number,
      dt: number
    ): [number, number, number] => {
      const wheelSpeedCmPerSecond = (wheelSpeed / 100.0) * FULL_SPEED_CM_PER_SECOND;

      if (wheelAngleDegrees === 0) {
        const headingInRadians = (this.state.heading / 180.0) * Math.PI;
        const distanceMovedCm = wheelSpeedCmPerSecond * dt;
        const xChangeCm = distanceMovedCm * Math.sin(headingInRadians);
        const yChangeCm = distanceMovedCm * Math.cos(headingInRadians);
        return [this.state.x + xChangeCm, this.state.y + yChangeCm, this.state.heading];
      } else {
        const wheelDistanceFromCentreX = VEHICLE_WIDTH_CM / 2;
        const steerablePosRelativeToRoverX = left ? -wheelDistanceFromCentreX : wheelDistanceFromCentreX;
        const distanceBetweenWheelsCm = DISTANCE_BETWEEN_WHEEL_PAIRS_CM;

        const wheelAngleRadians = (wheelAngleDegrees / 180.0) * Math.PI;
        const turningRadiusToSteerableWheelCm = distanceBetweenWheelsCm / Math.sin(wheelAngleRadians);
        const circumferenceCm = 2 * Math.PI * turningRadiusToSteerableWheelCm;

        const revolutionsPerSecond = wheelSpeedCmPerSecond / circumferenceCm;
        const revolutionsTurned = revolutionsPerSecond * dt;
        const headingChangeDegrees = revolutionsTurned * 360;
        const headingChangeRadians = revolutionsTurned * 2 * Math.PI;

        const turningCircleCentreDistance =
          Math.cos(wheelAngleRadians) * turningRadiusToSteerableWheelCm - steerablePosRelativeToRoverX;
        const vehicleHeadingRadians = (this.state.heading * Math.PI) / 180;
        const turningCircleRelativeX = turningCircleCentreDistance * Math.cos(-vehicleHeadingRadians);
        const turningCircleRelativeY = turningCircleCentreDistance * Math.sin(-vehicleHeadingRadians);
        const turningCircleX = turningCircleRelativeX + this.state.x;
        const turningCircleY = turningCircleRelativeY + this.state.y;

        const currentAngleRadians = Math.atan2(this.state.y - turningCircleY, this.state.x - turningCircleX);
        const updatedAngleRadians = currentAngleRadians - headingChangeRadians;
        const updatedVehicleX = turningCircleX + Math.abs(turningCircleCentreDistance) * Math.cos(updatedAngleRadians);
        const updatedVehicleY = turningCircleY + Math.abs(turningCircleCentreDistance) * Math.sin(updatedAngleRadians);

        return [updatedVehicleX, updatedVehicleY, this.state.heading + headingChangeDegrees];
      }
    };

    // SPINNING IS NOT STEERING, so it does not go through the model above.
    //
    // That model is a steered-wheel model: it reads one wheel angle and one
    // wheel speed and rolls the body along an arc. A spin is differential
    // drive - the two sides turn in opposite directions - and there is no
    // wheel angle that expresses it. Feeding a spin through it produced a
    // tight arc instead of a pivot, sliding the rover 9.5cm across the yard
    // while it turned 90 degrees. The real rover stays where it is.
    //
    // So a spin is its own motion: the body rotates about its centre and the
    // position does not change. The rate falls out of the geometry - a wheel
    // that far from the centre, dragged at that speed, swings the body round
    // this fast - rather than being a number written down somewhere.
    if (this.isSpinning()) {
      const wheelSpeedCmPerSecond = (this.state.speedL / 100.0) * FULL_SPEED_CM_PER_SECOND;
      const radiansPerSecond =
        (wheelSpeedCmPerSecond / WHEEL_DISTANCE_FROM_CENTRE_CM) * SPIN_RATE_CALIBRATION;
      this.state.heading += (radiansPerSecond * dt * 180) / Math.PI;
      // It cannot reach a wall without moving, and it did not move.
      this.state.hitWall = false;
      return { ...this.state };
    }

    // Every remaining command drives both sides at the same speed with the
    // four wheels at one steering angle, so reading that angle and speed off
    // the front left wheel describes all four.
    const [xFL, yFL, hFL] = calculateSteeredPosition(true, this.state.servos[SERVO_FL], this.state.speedL, dt);
    const [xFR, yFR, hFR] = calculateSteeredPosition(false, this.state.servos[SERVO_FL], this.state.speedL, dt);
    const [xBL, yBL, hBL] = calculateSteeredPosition(true, this.state.servos[SERVO_FL], this.state.speedL, dt);
    const [xBR, yBR, hBR] = calculateSteeredPosition(false, this.state.servos[SERVO_FL], this.state.speedL, dt);

    // Average the results
    const newX = (xFL + xFR + xBL + xBR) / 4;
    const newY = (yFL + yFR + yBL + yBR) / 4;
    this.state.heading = (hFL + hFR + hBL + hBR) / 4;

    // Clamp to terrain bounds: the rover cannot leave the yard.
    const clampedX = Math.max(-YARD_HALF_W, Math.min(YARD_HALF_W, newX));
    const clampedY = Math.max(-YARD_HALF_H, Math.min(YARD_HALF_H, newY));
    this.state.hitWall = clampedX !== newX || clampedY !== newY;
    this.state.x = clampedX;
    this.state.y = clampedY;

    return { ...this.state };
  }

  /**
   * True when the two sides are driven against each other.
   *
   * Derived from the wheel speeds rather than remembering which command was
   * last given, so manual control and a replayed mission cannot disagree about
   * what the rover is doing.
   */
  private isSpinning(): boolean {
    return this.state.speedL !== 0 && this.state.speedL === -this.state.speedR;
  }

  getState(): RoverState {
    return { ...this.state };
  }

  reset() {
    this.state = {
      x: 0,
      y: 0,
      heading: 0,
      speedL: 0,
      speedR: 0,
      servos: new Array(16).fill(0),
      hitWall: false,
    };
    this.lastUpdate = Date.now();
  }
}


/**
 * How fast the rover turns on the spot, in degrees per second.
 *
 * MEASURED FROM THE PHYSICS, never hardcoded. The turn rate falls out of the
 * wheel angle, the wheelbase and the turning-circle maths above; writing "32.9"
 * anywhere would be a second copy of that answer, free to drift the moment any
 * of those constants change. Running one second of the real model cannot drift.
 *
 * Memoised per speed because the block generator asks for it on every block.
 */
const spinRateCache = new Map<number, number>();

export function spinDegreesPerSecond(speed = 60): number {
  const cached = spinRateCache.get(speed);
  if (cached !== undefined) return cached;

  const probe = new RoverPhysics();
  probe.setCommand('spinRight', speed);
  probe.update(1);
  const rate = Math.abs(probe.getState().heading);

  spinRateCache.set(speed, rate);
  return rate;
}

/**
 * Seconds of spinning needed to turn through `degrees`.
 *
 * This is the whole point of the degrees-based turn blocks: a child asked to
 * build a square should say "turn 90", not solve 90 / 32.9 with a number the
 * interface never told them. Rounded to 3dp because that is what ends up in
 * the generated time.sleep() a learner reads.
 */
export function spinSecondsForDegrees(degrees: number, speed = 60): number {
  const rate = spinDegreesPerSecond(speed);
  if (rate <= 0) return 0;
  return Math.round((Math.abs(degrees) / rate) * 1000) / 1000;
}

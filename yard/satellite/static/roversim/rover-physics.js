// GENERATED FILE - DO NOT EDIT.
// Built from mission-control/src/lib by scripts/build-roversim.mjs.
// Edit the TypeScript source and re-run `npm run build:roversim`.
/**
 * Client-side rover physics engine for real-time manual control
 * Based on legacy/simulator/roversimui.py Rover class
 */
/**
 * How far the rover drives in a second at full speed (100).
 *
 * MEASURED ON THE ROVER, ON THE YARD FLOOR, 3 October 2026, at speed 60,
 * timed by the rover's own queue (forward for N seconds), read off a ruler:
 *
 *     1s -> 9cm, 9cm        2s -> 18cm, 18cm
 *
 * 9cm a second, and exactly proportional: no start-up loss worth modelling.
 * At speed 60 that is 15cm a second at full speed. It was 10, inherited from
 * the 4tronix Qt simulator, so the simulator showed every drive at two thirds
 * of its real length and a mission that stopped short of the edge on screen
 * could reach it in the yard.
 *
 * ONLY SPEED 60 WAS MEASURED. Every Blocks mission drives at 60; other speeds
 * (Python can ask for any) assume distance scales with speed, which is the
 * standard model but has not been checked on this rover. To check it, drive
 * forward at speed 100 for 1s and 2s: this predicts 15cm and 30cm.
 *
 * ONE BATTERY STATE. Four runs in a row from one charge; how the distance
 * drifts as the battery drains is not measured yet (AB#467's note suggests
 * about 20 runs from full).
 */
const FULL_SPEED_CM_PER_SECOND = 15;
const VEHICLE_WIDTH_CM = 16;
const DISTANCE_BETWEEN_WHEEL_PAIRS_CM = 8;
/** How close the rover's centre gets to a wall: its body is 20 x 18.5 cm. */
const ROVER_MARGIN = 12;
/** The levels from gentle to steep, which is also how they rank. */
export const ZONE_LEVELS = ['yellow', 'orange', 'red'];
/**
 * The real yard (AB#464), as yard/docs/yard-measurements.md records it.
 * yardMeasurements.test.ts reads that doc's tables and fails if these drift
 * from it, so the measurement and the simulator cannot quietly disagree.
 *
 * It replaced a 240 x 180 yard that was picked for how it looked, which was
 * 69 cm short north to south: the simulator said a rover hit the wall when the
 * real one had room to spare.
 */
export const YARD = {
    widthCm: 233,
    depthCm: 249,
    // On the seam, just inside the door, facing east along it (8 October 2026).
    // It was the middle of the seam, on the southern mound's slope, which put
    // every run on tilted ground and had the operator walking into the yard.
    // Here it is flat and one reach through the door, and driving straight on
    // meets the mound and R4, so a mission's first job is to steer round them.
    start: { x: 25, y: 121, facingDegrees: 90 },
    rocks: [
        { name: 'R1', x: 62, y: 16, widthCm: 30, depthCm: 5 },
        { name: 'R2', x: 138, y: 25, widthCm: 13, depthCm: 17 },
        { name: 'R3', x: 206, y: 50, widthCm: 20, depthCm: 24 },
        { name: 'R4', x: 141, y: 133, widthCm: 23, depthCm: 23 },
    ],
    // By eye from the floor photo. Yellow is the whole mound, to the edge of its
    // cracked texture (David, 8 October 2026: anywhere not flat is
    // unpredictable); orange and red ring each peak. Yellow was only round the
    // peaks while the start was on the mound, since a flag that is up before
    // the rover moves teaches a learner to ignore it. The start is off it now.
    zones: [
        { level: 'yellow', x: 99, y: 122, rx: 48, ry: 58 },
        { level: 'orange', x: 94, y: 94, rx: 17, ry: 17 },
        { level: 'orange', x: 84, y: 137, rx: 17, ry: 17 },
        { level: 'red', x: 94, y: 94, rx: 8, ry: 8 },
        { level: 'red', x: 84, y: 137, rx: 8, ry: 8 },
    ],
};
/**
 * The rover's frame to the yard's.
 *
 * TWO FRAMES ON PURPOSE. The physics works in the rover's own frame: it starts
 * at (0, 0), forward is +y and its right is +x, exactly as it always has, so
 * every turn, square and calibration test still means what it says. The yard
 * is where that frame is put down: at the start spot, turned to face the way
 * the rover faces there. Moving the start, or turning it, is then a change to
 * YARD and nothing else.
 */
export function roverToYard(rx, ry, yard = YARD) {
    const bearing = (yard.start.facingDegrees * Math.PI) / 180;
    // Forward is the bearing, as (east, north); the rover's right is 90 degrees on.
    const east = rx * Math.cos(bearing) + ry * Math.sin(bearing);
    const north = -rx * Math.sin(bearing) + ry * Math.cos(bearing);
    return [yard.start.x + east, yard.start.y - north];
}
/**
 * The rover's footprint from above, per 4tronix: 20 cm long and 18.5 cm wide,
 * wheels included. Rocks are tested against this (AB#466), not against the
 * centre, because it is the wheels and the nose that reach a rock first.
 */
const ROVER_HALF_LENGTH_CM = 10;
const ROVER_HALF_WIDTH_CM = 9.25;
/**
 * A rock as the physics sees it: a circle as wide as its largest measured
 * side. Rocks are irregular and were measured as boxes from above, and a
 * circle round the box errs towards calling a near miss a crash, which is the
 * side to err on when the alternative is the operator rescuing a stuck rover.
 */
export function rockRadiusCm(rock) {
    return Math.max(rock.widthCm, rock.depthCm) / 2;
}
/**
 * How much wider than a rock its "reached" ring is.
 *
 * Rocks are where a mission goes, not only what it has to miss (David and
 * Werner, 8 October 2026: "it's like a target, not an obstacle to avoid").
 * Before this a rover could only get to a rock by touching it, and touching
 * it is a crash, so the one way to arrive was the one way Send refused. A
 * ring "like 20% bigger" than the rock gives the rover somewhere to stop that
 * counts as there: bump the ring, you have reached the rock; hit the rock
 * itself and it is still a crash, as it is in the yard.
 */
export const REACH_SCALE = 1.2;
/** How far the rover's footprint is from a rock's centre, at a pose in its own frame. */
function footprintToRockCm(x, y, heading, rock, yard) {
    const [cx, cy] = roverToYard(x, y, yard);
    const bearing = ((yard.start.facingDegrees + heading) * Math.PI) / 180;
    const east = rock.x - cx;
    const north = cy - rock.y;
    // The rock's centre in the rover's own axes: ahead of it, and to its right.
    const ahead = east * Math.sin(bearing) + north * Math.cos(bearing);
    const right = east * Math.cos(bearing) - north * Math.sin(bearing);
    // The nearest point of the footprint to it.
    const nearAhead = Math.max(-ROVER_HALF_LENGTH_CM, Math.min(ROVER_HALF_LENGTH_CM, ahead));
    const nearRight = Math.max(-ROVER_HALF_WIDTH_CM, Math.min(ROVER_HALF_WIDTH_CM, right));
    return Math.hypot(ahead - nearAhead, right - nearRight);
}
/** The rock, if any, that the rover's footprint overlaps at this pose. */
export function rockTouching(x, y, heading, yard = YARD) {
    return yard.rocks.find((rock) => footprintToRockCm(x, y, heading, rock, yard) < rockRadiusCm(rock)) ?? null;
}
/** The rock, if any, whose reached ring the rover's footprint is inside at this pose. */
export function rockReached(x, y, heading, yard = YARD) {
    return (yard.rocks.find((rock) => footprintToRockCm(x, y, heading, rock, yard) < rockRadiusCm(rock) * REACH_SCALE) ?? null);
}
/**
 * The steepest zone at a point of the yard, or null on flat ground.
 *
 * Zones overlap by design, rings inside rings, so the answer is the highest
 * level of any that contains the point.
 */
export function zoneAt(x, y, yard = YARD) {
    let steepest = -1;
    for (const zone of yard.zones ?? []) {
        const dx = (x - zone.x) / zone.rx;
        const dy = (y - zone.y) / zone.ry;
        if (dx * dx + dy * dy <= 1)
            steepest = Math.max(steepest, ZONE_LEVELS.indexOf(zone.level));
    }
    return steepest < 0 ? null : ZONE_LEVELS[steepest];
}
/**
 * The zone the rover is on, at a pose in its own frame.
 *
 * Its centre, not its footprint as with rocks: a rock is hit by whichever
 * corner reaches it, but a slope matters once the rover is on it.
 */
export function zoneUnderRover(x, y, yard = YARD) {
    const [cx, cy] = roverToYard(x, y, yard);
    return zoneAt(cx, cy, yard);
}
/** The yard's frame to the rover's: the inverse of roverToYard. */
export function yardToRover(x, y, yard = YARD) {
    const bearing = (yard.start.facingDegrees * Math.PI) / 180;
    const east = x - yard.start.x;
    const north = yard.start.y - y;
    return [east * Math.cos(bearing) - north * Math.sin(bearing), east * Math.sin(bearing) + north * Math.cos(bearing)];
}
/**
 * How far each wheel sits from the point the rover turns about.
 *
 * The four wheels are the corners of a VEHICLE_WIDTH x DISTANCE_BETWEEN_PAIRS
 * rectangle, so this is the half-diagonal. It only matters for spinning on the
 * spot, where it sets how fast a given wheel speed swings the body round.
 */
const WHEEL_DISTANCE_FROM_CENTRE_CM = Math.hypot(VEHICLE_WIDTH_CM / 2, DISTANCE_BETWEEN_WHEEL_PAIRS_CM / 2);
/**
 * Turns the geometric spin rate into the one the rover actually achieves.
 *
 * MEASURED ON THE ROVER, 5 September 2026, on a high-grip floor at speed 60.
 * Six runs, 108 seconds of spinning in total:
 *
 *     4.7s ->  210 deg     18.7s ->  810 deg     25.0s -> 1110 deg
 *     9.4s ->  435 deg      9.4s ->  440 deg     41.0s -> 1890 deg
 *
 * Pooled: 45.29 deg/s, and reproducing that number is this constant's whole
 * job. The geometry below gives 57.65 at the measured drive speed of 15cm/s
 * at full (see FULL_SPEED_CM_PER_SECOND), so the rover achieves 0.786 of a
 * perfect pivot: ordinary tyre scrub, which can only lose rotation.
 *
 * It was 1.178 until 3 October 2026, fitted against the inherited 10cm/s.
 * At that too-slow wheel speed the rover appeared to turn FASTER than its
 * geometry allowed, and a pivot-point explanation was written to account for
 * it. Measuring the drive speed removed the puzzle; this was re-derived from
 * the same six runs so the spin rate, measured directly, did not move.
 *
 * Confirmed by prediction rather than by fitting: at this value a 90 degree
 * turn sleeps 1.987s, and four of them brought the rover back to its starting
 * heading. At the old value they overshot by 60 to 90 degrees.
 *
 * IT IS ONE SURFACE AND ONE BATTERY STATE. Grip changes how much the tyres
 * slide, so a smooth floor will not give the same number. To recalibrate, spin
 * at speed 60 for a known time, count the degrees turned, and set this to
 * (measured degrees per second) / 57.65.
 */
export const SPIN_RATE_CALIBRATION = 0.7856;
/**
 * How much of the geometric turn the rover actually achieves when steering.
 *
 * MEASURED ON THE ROVER, 5 September 2026, high-grip floor, speed 60:
 *
 *     4s at 45 degrees ->  90 deg turned   (geometry said 121.5) ratio 0.74
 *     8s at 20 degrees -> ~102 deg turned  (geometry said 117.6) ratio 0.87
 *     6s at 30 degrees ->  90 deg turned   (geometry said 129.0) ratio 0.70
 *
 * Those geometry figures, and the 0.75 fitted from them, were at the old
 * drive speed of 10cm/s at full. At the measured 15 (3 October) the geometric
 * turn is 1.5 times larger, so the same measured turns give 0.75 / 1.5 = 0.5.
 * The rover's turns do not change; the arcs do, for the better: at 0.75 and
 * the old speed the simulator drew a ~15cm turning circle where the rover
 * drives ~23cm (9cm/s at 22.5 degrees a second).
 *
 * The 30 degree run was an out-of-sample check, not part of the fit: with the
 * constant already set from 45 and 20, the simulator predicted 97 degrees
 * there and the rover turned about 90. Uncalibrated it would have been 129.
 *
 * The ratios scattered around 0.75 with no trend against angle, so
 * the formula's shape is right and it simply over-turns by a fixed proportion.
 * The rover understeers: the tyres slip outward and it traces a wider arc than
 * the wheel angle implies. Applied to the turning radius rather than to the
 * heading alone, so the path it draws stays consistent with the heading it
 * ends on - scaling only the heading would curve the rover round a circle it
 * was not actually driving.
 *
 * WHY IT MATTERED. The "Rocky Square" mission turns 4 seconds at 45 degrees
 * per corner. Uncalibrated the simulator turned 121.5 degrees there, so the
 * shape closed after three corners and a child who had built a square watched
 * the simulator draw a triangle, while the rover in the room drew the square.
 *
 * ONE SURFACE, ONE BATTERY, and read by eye at two angles. Recalibrate the
 * same way: steer a known angle for a known time, measure the degrees turned,
 * and set this to (measured) / (what the simulator draws uncalibrated).
 */
export const STEER_RATE_CALIBRATION = 0.5;
/** The wheel angle a steer block uses when the caller does not name one. */
export const DEFAULT_STEER_DEGREES = 30;
const SERVO_FL = 9;
const SERVO_FR = 15;
const SERVO_RL = 11;
const SERVO_RR = 13;
export class RoverPhysics {
    /** The yard whose walls stop the rover. */
    constructor(yard = YARD) {
        this.yard = yard;
        this.state = {
            x: 0,
            y: 0,
            heading: 0,
            speedL: 0,
            speedR: 0,
            servos: new Array(16).fill(0),
            hitWall: false,
            hitRock: null,
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
    setCommand(command, speed = 80, degrees) {
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
    update(dtOverride) {
        const currentTime = Date.now();
        // Real-time callers pass nothing (wall-clock dt); the batch simulator passes
        // a fixed dt so a trajectory can be computed deterministically off-clock.
        // The wall-clock dt is clamped: if the timer is stale (the first tap after
        // the page sat idle, or returning from a backgrounded tab) an unclamped dt
        // would teleport the rover across the yard in a single step.
        const dt = dtOverride !== undefined
            ? dtOverride
            : Math.min(Math.max(0, (currentTime - this.lastUpdate) / 1000), 0.1);
        this.lastUpdate = currentTime;
        // Calculate new position based on current speeds and servo angles
        const calculateSteeredPosition = (left, wheelAngleDegrees, wheelSpeed, dt) => {
            const wheelSpeedCmPerSecond = (wheelSpeed / 100.0) * FULL_SPEED_CM_PER_SECOND;
            if (wheelAngleDegrees === 0) {
                const headingInRadians = (this.state.heading / 180.0) * Math.PI;
                const distanceMovedCm = wheelSpeedCmPerSecond * dt;
                const xChangeCm = distanceMovedCm * Math.sin(headingInRadians);
                const yChangeCm = distanceMovedCm * Math.cos(headingInRadians);
                return [this.state.x + xChangeCm, this.state.y + yChangeCm, this.state.heading];
            }
            else {
                const wheelDistanceFromCentreX = VEHICLE_WIDTH_CM / 2;
                const steerablePosRelativeToRoverX = left ? -wheelDistanceFromCentreX : wheelDistanceFromCentreX;
                const distanceBetweenWheelsCm = DISTANCE_BETWEEN_WHEEL_PAIRS_CM;
                const wheelAngleRadians = (wheelAngleDegrees / 180.0) * Math.PI;
                const turningRadiusToSteerableWheelCm = distanceBetweenWheelsCm / Math.sin(wheelAngleRadians) / STEER_RATE_CALIBRATION;
                const circumferenceCm = 2 * Math.PI * turningRadiusToSteerableWheelCm;
                const revolutionsPerSecond = wheelSpeedCmPerSecond / circumferenceCm;
                const revolutionsTurned = revolutionsPerSecond * dt;
                const headingChangeDegrees = revolutionsTurned * 360;
                const headingChangeRadians = revolutionsTurned * 2 * Math.PI;
                const turningCircleCentreDistance = Math.cos(wheelAngleRadians) * turningRadiusToSteerableWheelCm - steerablePosRelativeToRoverX;
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
            const radiansPerSecond = (wheelSpeedCmPerSecond / WHEEL_DISTANCE_FROM_CENTRE_CM) * SPIN_RATE_CALIBRATION;
            const heading = this.state.heading + (radiansPerSecond * dt * 180) / Math.PI;
            // It cannot reach a wall without moving, and it did not move. It can
            // swing a corner into a rock beside it, though.
            this.state.hitWall = false;
            const rock = rockTouching(this.state.x, this.state.y, heading, this.yard);
            this.state.hitRock = rock?.name ?? null;
            if (!rock)
                this.state.heading = heading;
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
        const newHeading = (hFL + hFR + hBL + hBR) / 4;
        // A rock stops the step outright: the rover stays where it was, the last
        // pose that did not overlap it. A step is a tenth of a second, under a
        // centimetre at any speed the blocks use, so that is where it touched.
        const rock = rockTouching(newX, newY, newHeading, this.yard);
        this.state.hitRock = rock?.name ?? null;
        if (rock) {
            this.state.hitWall = false;
            return { ...this.state };
        }
        this.state.heading = newHeading;
        // The rover cannot leave the yard. The walls are the yard's, so the clamp
        // happens in the yard's frame and the answer comes back to the rover's.
        const [yardX, yardY] = roverToYard(newX, newY, this.yard);
        const clampedX = Math.max(ROVER_MARGIN, Math.min(this.yard.widthCm - ROVER_MARGIN, yardX));
        const clampedY = Math.max(ROVER_MARGIN, Math.min(this.yard.depthCm - ROVER_MARGIN, yardY));
        this.state.hitWall = clampedX !== yardX || clampedY !== yardY;
        if (this.state.hitWall) {
            [this.state.x, this.state.y] = yardToRover(clampedX, clampedY, this.yard);
        }
        else {
            // Not round-tripped: the trigonometry would add crumbs like 1e-15 to a
            // straight drive that the calibration tests compare exactly.
            this.state.x = newX;
            this.state.y = newY;
        }
        return { ...this.state };
    }
    /**
     * True when the two sides are driven against each other.
     *
     * Derived from the wheel speeds rather than remembering which command was
     * last given, so manual control and a replayed mission cannot disagree about
     * what the rover is doing.
     */
    isSpinning() {
        return this.state.speedL !== 0 && this.state.speedL === -this.state.speedR;
    }
    getState() {
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
            hitRock: null,
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
const spinRateCache = new Map();
export function spinDegreesPerSecond(speed = 60) {
    const cached = spinRateCache.get(speed);
    if (cached !== undefined)
        return cached;
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
export function spinSecondsForDegrees(degrees, speed = 60) {
    const rate = spinDegreesPerSecond(speed);
    if (rate <= 0)
        return 0;
    return Math.round((Math.abs(degrees) / rate) * 1000) / 1000;
}

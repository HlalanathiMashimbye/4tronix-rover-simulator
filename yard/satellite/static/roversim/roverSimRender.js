// GENERATED FILE - DO NOT EDIT.
// Built from mission-control/src/lib by scripts/build-roversim.mjs.
// Edit the TypeScript source and re-run `npm run build:roversim`.
/**
 * 2D rover-simulator drawing for the live simulator panel (RoverSimulator).
 *
 * The real yard from above, north up (AB#464): the floor is a photo of it,
 * straightened and measured, with a vector overlay on top so it still reads
 * as a simulator rather than a photo, like a map. The rover is drawn, not
 * photographed, and steers its four wheels to their servo angles.
 */
import { YARD, roverToYard } from './rover-physics.js';
import { crashFrame } from './simulateCommands.js';
/** Mars at night: the original look, unchanged. */
export const DARK_SIM_PALETTE = {
    groundInner: '#7c4a2b',
    groundMid: '#5a3320',
    groundOuter: '#34190d',
    craterCore: 'rgba(0,0,0,0.28)',
    craterMid: 'rgba(0,0,0,0.10)',
    craterRim: 'rgba(255,210,170,0.05)',
    grid: 'rgba(255,225,200,0.16)',
    vignetteTop: 'rgba(0,0,0,0.30)',
    vignetteBottom: 'rgba(0,0,0,0.35)',
    trail: '#2196f3',
    floorShade: 'rgba(14,6,2,0.30)',
    label: 'rgba(255,225,200,0.75)',
};
/**
 * Paper & Ink: sunlit regolith rather than night. Tuned to sit inside the
 * light theme's warm paper without becoming a bright hole in the page, and
 * every overlay (craters, grid, vignette) flips from black-based to a warm
 * brown so it darkens the sand instead of greying it.
 */
export const LIGHT_SIM_PALETTE = {
    groundInner: '#e3d5bf',
    groundMid: '#cfbda2',
    groundOuter: '#b6a086',
    craterCore: 'rgba(88,66,42,0.20)',
    craterMid: 'rgba(88,66,42,0.08)',
    craterRim: 'rgba(255,252,245,0.55)',
    grid: 'rgba(255,248,235,0.24)',
    vignetteTop: 'rgba(88,66,42,0.16)',
    vignetteBottom: 'rgba(88,66,42,0.20)',
    trail: '#1668c9',
    floorShade: 'rgba(255,250,240,0.04)',
    label: 'rgba(70,50,30,0.8)',
};
export const SIM_FPS = 10; // trajectory is sampled at 0.1s steps
// Servo ids for the four steerable wheels (front/rear, left/right).
const FL = '9';
const FR = '15';
const RL = '11';
const RR = '13';
/**
 * One light direction for the whole scene, up and to the left.
 *
 * This is what makes a flat canvas read as ground rather than as circles on a
 * brown rectangle: every crater darkens on the same side and every rock casts
 * its shadow the same way. Get it inconsistent and the eye stops believing any
 * of it.
 */
const LIGHT = { x: -0.55, y: -0.83 };
/**
 * The yard STRETCHED to fill the canvas, whatever its shape (AB#464).
 *
 * The yard is near square and almost no panel is. Three other answers were
 * tried and each lost something: fitting it left bars of empty ground beside
 * it, cropping it lost rocks and corners, and framing it in its own shape
 * shrank it to a postage stamp on a phone. Stretched, every rock and corner
 * shows and the simulator is the full size of its panel everywhere.
 *
 * So across and down have their own scales (sx, sy). Positions use them, so
 * the trail, the rocks and the walls stay exactly on the stretched photo.
 * Sizes use their geometric mean (s), so the rover is drawn its own shape
 * rather than squashed, and is turned to where it moves on screen
 * (drawnBearing).
 */
export function computeLayout(w, h, yard = YARD) {
    // Clamp to >= 0: a container briefly smaller than nothing (mid-layout)
    // would otherwise yield a negative scale and an illegal gradient radius.
    const sx = Math.max(0, w / yard.widthCm);
    const sy = Math.max(0, h / yard.depthCm);
    return { w, h, sx, sy, s: Math.sqrt(sx * sy), ox: 0, oy: 0, yard };
}
/** Room around the crop for the rover's body, which the path does not include. */
const FILL_PAD_CM = 15;
/**
 * A layout where the yard FILLS the canvas, cropped, for a mission's cover on
 * the home feed (AB#464).
 *
 * Only the covers. Everywhere a rover is driven or watched the yard is
 * stretched to fill (computeLayout), so every rock and corner shows. A cover
 * is a thumbnail in a card twice as wide as it is tall, where stretching would
 * flatten every rock to a sliver, so there the crop is the better trade,
 * placed for the run:
 *
 *  - Centred on the whole trail, so a run that fits is framed once and the
 *    view holds still while it plays.
 *  - Never so far off the rover (`at`, where it is now) that it leaves the
 *    canvas. A trail longer than the view therefore follows the rover rather
 *    than losing it, and a cover, where the rover is parked at the end,
 *    keeps the end rather than the start.
 *  - Never past a wall, which would bring the bars back.
 *
 * Before anything has run, it is centred on the start spot.
 */
export function computeFillLayout(w, h, traj, at = traj[traj.length - 1], yard = YARD) {
    const s = Math.max(w / yard.widthCm, h / yard.depthCm);
    if (!(s > 0))
        return computeLayout(w, h, yard);
    const viewW = w / s;
    const viewH = h / s;
    const [nowX, nowY] = roverToYard(at?.x ?? 0, at?.y ?? 0, yard);
    let minX = nowX, maxX = nowX, minY = nowY, maxY = nowY;
    for (const point of traj) {
        const [x, y] = roverToYard(point.x, point.y, yard);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    // The trail's middle, held within reach of the rover. When the trail fits,
    // its middle is always within reach of every point on it, so this only
    // moves the view for a trail that does not fit.
    const centre = (lo, hi, view, now) => {
        const reach = Math.max(0, view / 2 - FILL_PAD_CM);
        return clamp((lo + hi) / 2, now - reach, now + reach);
    };
    const left = clamp(centre(minX, maxX, viewW, nowX) - viewW / 2, 0, yard.widthCm - viewW);
    const top = clamp(centre(minY, maxY, viewH, nowY) - viewH / 2, 0, yard.depthCm - viewH);
    return { w, h, sx: s, sy: s, s, ox: -left * s, oy: -top * s, yard };
}
/** A point in the yard's measured frame (cm from the west and back walls) on screen. */
function yardToScreen(L, x, y) {
    return [L.ox + x * L.sx, L.oy + y * L.sy];
}
/** A point in the rover's frame, as the physics reports it, on screen. */
export function worldToScreen(L, wx, wy) {
    const [x, y] = roverToYard(wx, wy, L.yard);
    return yardToScreen(L, x, y);
}
/**
 * The angle to draw the rover at, clockwise from screen-up, for a heading in
 * its own frame.
 *
 * Its compass bearing, on a map drawn to one scale. On a stretched map a
 * direction on the ground is not the same direction on screen (a rover
 * heading south-east moves more across than down when the yard is stretched
 * across), so the rover is turned to the way its trail actually runs.
 */
export function drawnBearing(L, heading) {
    const bearing = ((L.yard.start.facingDegrees + heading) * Math.PI) / 180;
    return (Math.atan2(Math.sin(bearing) * L.sx, Math.cos(bearing) * L.sy) * 180) / Math.PI;
}
const lerp = (a, b, t) => a + (b - a) * t;
export function interpolate(traj, p) {
    const len = traj.length;
    const i0 = Math.max(0, Math.min(len - 1, Math.floor(p)));
    const i1 = Math.min(len - 1, i0 + 1);
    const f = Math.max(0, Math.min(1, p - i0));
    const a = traj[i0];
    const b = traj[i1];
    const sv = (k) => lerp(a.servos?.[k] ?? 0, b.servos?.[k] ?? 0, f);
    return {
        x: lerp(a.x, b.x, f),
        y: lerp(a.y, b.y, f),
        heading: lerp(a.heading, b.heading, f),
        servos: { [FL]: sv(FL), [FR]: sv(FR), [RL]: sv(RL), [RR]: sv(RR) },
        hitWall: a.hitWall || b.hitWall,
        hitRock: a.hitRock ?? b.hitRock ?? null,
        // Lamps do not blend between two colours: they are on or off at a given
        // frame. Take the frame the playhead is actually on.
        leds: a.leds,
    };
}
/**
 * The terrain is painted ONCE and cached.
 *
 * Everything on the ground is static, and the playback loop redraws at 10fps -
 * paying for gradients, four hundred grains of dust and every crater on every
 * frame bought nothing. Caching it to an offscreen canvas means the per-frame
 * cost is one drawImage, and in exchange the ground can afford to be rich:
 * mottled sand, wind ripples, rocks with actual shapes.
 *
 * Keyed on size and palette, so a resize or a theme flip repaints it and
 * nothing else does.
 */
let terrainCache = null;
function drawTerrain(ctx, L, P, floor) {
    // The floor photo arrives after the first frames, so having it is part of
    // the key: the yard repaints once when it lands, and not again. So is where
    // the yard sits, because the crop is placed for each run, and follows the
    // rover through one that does not fit.
    const key = `${L.w}x${L.h}@${L.sx.toFixed(4)},${L.sy.toFixed(4)}+${L.ox.toFixed(1)},${L.oy.toFixed(1)}:${P.groundInner}:${floor ? 'photo' : 'plain'}`;
    if (terrainCache?.key !== key) {
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const off = typeof document !== 'undefined' ? document.createElement('canvas') : null;
        const g = off?.getContext('2d');
        if (!off || !g) {
            // No offscreen canvas (test environments) - paint straight through.
            paintTerrain(ctx, L, P, floor);
            return;
        }
        off.width = Math.max(1, Math.round(L.w * dpr));
        off.height = Math.max(1, Math.round(L.h * dpr));
        g.scale(dpr, dpr);
        paintTerrain(g, L, P, floor);
        terrainCache = { key, canvas: off };
    }
    ctx.drawImage(terrainCache.canvas, 0, 0, L.w, L.h);
}
function paintTerrain(ctx, L, P, floor) {
    const { w, h, yard } = L;
    const [x0, y0] = yardToScreen(L, 0, 0);
    const yw = yard.widthCm * L.sx;
    const yh = yard.depthCm * L.sy;
    // Beyond the walls: the panel's own colour, so the yard sits on it like a
    // map on a table. The yard is near square and the panels are not.
    ctx.fillStyle = P.groundOuter;
    ctx.fillRect(0, 0, w, h);
    if (floor) {
        ctx.drawImage(floor, x0, y0, yw, yh);
        ctx.fillStyle = P.floorShade;
        ctx.fillRect(x0, y0, yw, yh);
    }
    else {
        // Until the photo has loaded, or wherever there is none: plain ground.
        // Never invented craters: this is a real yard, and a mark on its floor
        // reads as something that is there.
        const ground = ctx.createRadialGradient(x0 + yw / 2, y0 + yh * 0.42, Math.min(yw, yh) * 0.1, x0 + yw / 2, y0 + yh / 2, Math.max(yw, yh) * 0.75);
        ground.addColorStop(0, P.groundInner);
        ground.addColorStop(0.55, P.groundMid);
        ground.addColorStop(1, P.groundOuter);
        ctx.fillStyle = ground;
        ctx.fillRect(x0, y0, yw, yh);
    }
    // The map overlay. A 50 cm grid, so distance can be read off the floor.
    ctx.strokeStyle = P.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let cm = 50; cm < yard.widthCm; cm += 50) {
        const [gx] = yardToScreen(L, cm, 0);
        ctx.moveTo(gx, y0);
        ctx.lineTo(gx, y0 + yh);
    }
    for (let cm = 50; cm < yard.depthCm; cm += 50) {
        const [, gy] = yardToScreen(L, 0, cm);
        ctx.moveTo(x0, gy);
        ctx.lineTo(x0 + yw, gy);
    }
    ctx.stroke();
    // Each rock ringed at its measured size: the photo shows the rock, the ring
    // says the simulator knows it is there.
    ctx.save();
    ctx.setLineDash([4, 3]);
    for (const rock of yard.rocks) {
        const [rx, ry] = yardToScreen(L, rock.x, rock.y);
        // An oval on a stretched yard, as the stretched photo draws the rock.
        const r = Math.max(rock.widthCm, rock.depthCm) / 2 + 2;
        ctx.beginPath();
        ctx.ellipse(rx, ry, r * L.sx, r * L.sy, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(20,8,2,0.5)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,240,220,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    ctx.restore();
    // The walls.
    ctx.strokeStyle = 'rgba(20,8,2,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, yw, yh);
    // North, on the backdrop wall: the map is drawn north up.
    ctx.fillStyle = P.label;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Inside the top edge when the back wall is cropped off or too close to it.
    ctx.fillText('N', x0 + yw / 2, y0 > 14 ? y0 - 7 : Math.max(y0, 0) + 9);
    drawStartMark(ctx, L);
}
/**
 * The start mark (AB#465): a cross of tape where the rover's centre goes, one
 * arm along the seam and one across it. In centimetres. yard-measurements.md
 * tells a person how to tape it from the same number, and
 * yardMeasurements.test.ts holds the two together, so the mark on screen is
 * the mark on the floor.
 *
 * A CROSS, NOT AN ARROW. It was an arrow pointing the way the rover faces,
 * and an arrow reads as "drive this way" when a mission can just as well start
 * by reversing. Which way the rover faces is said in words instead, "facing
 * the front wall", which in the room is unmistakable.
 *
 * Each arm runs 14 cm from the centre, past the rover's body on every side
 * (it is 20 x 18.5 cm), so with the rover parked on it all four tips show:
 * that is what centres it, on screen and on the floor.
 */
export const START_MARK_CM = { arm: 14 };
/** Where the start mark's centre and the tips of its four arms are on screen. */
export function startMark(L) {
    const arm = START_MARK_CM.arm;
    return {
        centre: worldToScreen(L, 0, 0),
        tips: [worldToScreen(L, 0, arm), worldToScreen(L, 0, -arm), worldToScreen(L, arm, 0), worldToScreen(L, -arm, 0)],
    };
}
function drawStartMark(ctx, L) {
    const { tips } = startMark(L);
    const [ahead, behind, right, left] = tips;
    const width = Math.max(2, 2.5 * L.s);
    ctx.save();
    ctx.lineCap = 'round';
    // A dark edge first, so the tape reads on the bright parts of the floor.
    for (const [colour, extra] of [['rgba(20,8,2,0.55)', 2], ['rgba(52,211,153,0.95)', 0]]) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width + extra;
        ctx.beginPath();
        ctx.moveTo(behind[0], behind[1]);
        ctx.lineTo(ahead[0], ahead[1]);
        ctx.moveTo(left[0], left[1]);
        ctx.lineTo(right[0], right[1]);
        ctx.stroke();
    }
    ctx.restore();
}
function drawTarget(ctx, L, target) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (target.showPath && target.path.length > 1) {
        // A dark edge under bright dashes, like the start mark, so it reads on
        // both the pale and the dark parts of the floor photo. Dashed and yellow
        // so it cannot be mistaken for the rover's own dotted trail.
        for (const [colour, width, dash] of [
            ['rgba(20,8,2,0.55)', 7, []],
            ['rgba(255,214,10,0.95)', 4, [10, 8]],
        ]) {
            ctx.strokeStyle = colour;
            ctx.lineWidth = width;
            ctx.setLineDash(dash);
            ctx.beginPath();
            target.path.forEach(({ x, y }, i) => {
                const [sx, sy] = worldToScreen(L, x, y);
                if (i === 0)
                    ctx.moveTo(sx, sy);
                else
                    ctx.lineTo(sx, sy);
            });
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }
    if (target.goal) {
        // A bullseye whose outer ring is the real tolerance, so "inside the ring"
        // on screen is exactly what the check accepts. Never drawn smaller than a
        // finger can point at, though: the ring is a few cm across on a phone.
        const [cx, cy] = worldToScreen(L, target.goal.x, target.goal.y);
        const rx = Math.max(10, target.goal.radiusCm * L.sx);
        const ry = Math.max(10, target.goal.radiusCm * L.sy);
        const rings = [
            ['rgba(20,8,2,0.55)', 1.15],
            ['rgba(239,68,68,0.95)', 1],
            ['rgba(255,255,255,0.95)', 0.66],
            ['rgba(239,68,68,0.95)', 0.33],
        ];
        for (const [colour, k] of rings) {
            ctx.fillStyle = colour;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx * k, ry * k, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}
function drawTrail(ctx, L, traj, endIdx, P) {
    if (endIdx <= 0)
        return;
    /**
     * Tyre tracks, not a painted line.
     *
     * Two rows of dark prints pressed into the sand, offset either side of the
     * path - what a rover actually leaves behind. The themed dotted line rides
     * down the middle on top, so the child still reads it as "the route I
     * programmed" at a glance.
     */
    ctx.save();
    ctx.fillStyle = 'rgba(35,16,9,0.42)';
    let lastX = NaN;
    let lastY = NaN;
    for (let i = 0; i <= endIdx && i < traj.length; i++) {
        const [sx, sy] = worldToScreen(L, traj[i].x, traj[i].y);
        const dx = sx - lastX;
        const dy = sy - lastY;
        const dist = Math.hypot(dx, dy);
        // A print every few px of travel; standing still leaves no tracks.
        if (!(dist >= 6)) {
            if (Number.isNaN(lastX)) {
                lastX = sx;
                lastY = sy;
            }
            continue;
        }
        const nx = -dy / dist; // perpendicular to travel
        const ny = dx / dist;
        for (const side of [-7, 7]) {
            ctx.beginPath();
            ctx.arc(sx + nx * side, sy + ny * side, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }
        lastX = sx;
        lastY = sy;
    }
    // The programmed route, dotted down the centre.
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = P.trail;
    ctx.globalAlpha = 0.75;
    ctx.setLineDash([0.1, 12]);
    ctx.beginPath();
    for (let i = 0; i <= endIdx && i < traj.length; i++) {
        const [sx, sy] = worldToScreen(L, traj[i].x, traj[i].y);
        if (i === 0)
            ctx.moveTo(sx, sy);
        else
            ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();
}
function drawRover(ctx, L, st, t = 0, odo = 0) {
    const [cx, cy] = worldToScreen(L, st.x, st.y);
    /**
     * TRUE SCALE, near enough: the rover and the yard are in the same measured
     * centimetres.
     *
     * This used to be inflated about 2.5x, because a real 20cm rover in a 640cm
     * yard came out three pixels long and a learner could not see which way it
     * pointed. Shrinking the yard removed the reason for the lie: the body is
     * drawn from its actual size in centimetres, so distance, rover and walls are
     * all finally in the same units.
     *
     * The floor keeps it legible on a small panel, where the whole yard might
     * only be 200px wide.
     */
    // 200mm long, 185mm wide, per the 4tronix spec. Divided by the DRAWN extent
    // rather than the chassis: the ultrasonic head adds about 6.4 units past the
    // body, so mapping 20cm onto bh alone drew the whole rover a third too large.
    const ROVER_LENGTH_CM = 20;
    const DRAWN_LENGTH_UNITS = 44.4; // body (38) + head overhang (~6.4)
    const scale = Math.max(0.7, (ROVER_LENGTH_CM * L.s) / DRAWN_LENGTH_UNITS);
    const bw = 30 * scale;
    const bh = 38 * scale;
    const halfW = bw / 2;
    const halfH = bh / 2;
    // Drawn with its nose up and turned to its compass bearing: the map is north
    // up, so a rover that starts facing south starts pointing down the screen.
    const bearing = drawnBearing(L, st.heading);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((bearing * Math.PI) / 180);
    // Contact shadow, thrown by the same light as the rover's highlights. Drawn
    // in an unrotated frame so it stays on the ground as the body turns.
    ctx.save();
    ctx.rotate((-bearing * Math.PI) / 180);
    ctx.fillStyle = 'rgba(20,8,2,0.38)';
    ctx.beginPath();
    ctx.ellipse(-LIGHT.x * 7, -LIGHT.y * 7, halfW + 6, halfH * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    /**
     * Wheels: black knobbly tyres, drawn from above as a tread strip.
     *
     * The ribs SLIDE with the odometer, wrapping around the wheel, which is what
     * finally shows movement: a rover gliding on frozen wheels read as a fridge
     * magnet. The odometer is distance actually travelled (plus rotation for
     * on-the-spot spins), so scrubbing to any frame shows that frame's exact
     * tread position - nothing on this canvas animates on its own.
     */
    const wheelH = 13 * scale;
    const wheelW = 7.6 * scale;
    const ribSpacing = 3.4 * scale;
    const wheel = (lx, ly, angle) => {
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate((angle * Math.PI) / 180);
        // Tyre.
        ctx.fillStyle = '#17181b';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(-wheelW / 2, -wheelH / 2, wheelW, wheelH, 3 * scale);
        ctx.fill();
        ctx.stroke();
        // Rolling tread ribs, clipped to the tyre.
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(-wheelW / 2 + 1, -wheelH / 2 + 1, wheelW - 2, wheelH - 2, 2.4 * scale);
        ctx.clip();
        ctx.strokeStyle = '#43464d';
        ctx.lineWidth = 1.6;
        const phase = odo % ribSpacing;
        for (let ry = -wheelH / 2 - ribSpacing; ry <= wheelH / 2 + ribSpacing; ry += ribSpacing) {
            ctx.beginPath();
            ctx.moveTo(-wheelW / 2 + 1, ry + phase);
            ctx.lineTo(wheelW / 2 - 1, ry + phase);
            ctx.stroke();
        }
        ctx.restore();
        // White hub peeking past the tread, like the real wheel's spoked centre.
        ctx.fillStyle = '#e8e8e6';
        ctx.beginPath();
        ctx.arc(0, 0, 1.7 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };
    // Six wheels: four corners steer, the middle pair is fixed - the real
    // M.A.R.S. chassis. Middle pair sits a touch more outboard, like the metal.
    const frontY = -halfH * 0.66;
    const rearY = halfH * 0.66;
    // Rocker-bogie rails: the dark arms that join each side's three wheels on
    // the real rover. Two strokes per side, hinged at the middle wheel.
    ctx.strokeStyle = '#20242b';
    ctx.lineWidth = 2.6 * scale;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
        const x = side * (halfW + 1.5);
        ctx.beginPath();
        ctx.moveTo(x, frontY);
        ctx.lineTo(side * (halfW + 2), 0);
        ctx.lineTo(x, rearY);
        ctx.stroke();
    }
    /**
     * Servo wiring: the orange looms that run from the deck out to each corner
     * servo. Straight off the product photos - the real rover is threaded with
     * orange and brown wire - and the warmest thing on an otherwise white robot.
     * Drawn before the body so they emerge from underneath the deck.
     */
    ctx.strokeStyle = '#ff8a3c';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (const [wx, wy] of [
        [-halfW - 1, frontY], [halfW + 1, frontY],
        [-halfW - 1, rearY], [halfW + 1, rearY],
    ]) {
        ctx.beginPath();
        ctx.moveTo(wx * 0.35, wy * 0.55);
        ctx.quadraticCurveTo(wx * 0.9, wy * 0.7, wx, wy);
        ctx.stroke();
    }
    wheel(-halfW - 1, frontY, st.servos?.[FL] ?? 0);
    wheel(halfW + 1, frontY, st.servos?.[FR] ?? 0);
    wheel(-halfW - 2, 0, 0);
    wheel(halfW + 2, 0, 0);
    wheel(-halfW - 1, rearY, st.servos?.[RL] ?? 0);
    wheel(halfW + 1, rearY, st.servos?.[RR] ?? 0);
    /**
     * Body: the white PCB of the real M.A.R.S. rover - shop.4tronix.co.uk shows
     * a white circuit board deck with rows of mounting holes, a micro:bit riding
     * on top, and LEDs at the corners. White, per the photos and per request;
     * the navy solar deck of the previous pass is not on this rover at all.
     */
    ctx.fillStyle = '#f4f5f2';
    ctx.strokeStyle = '#2a2d31';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-halfW, -halfH, bw, bh, 6 * scale);
    ctx.fill();
    ctx.stroke();
    /**
     * Mars-orange band across the deck.
     *
     * The white PCB alone read as dull, and this is the platform's own colour -
     * the same #ff6d00 the original rover icon used for its top plate, and the
     * orange 4tronix print the photos show on the real board. One warm stripe is
     * enough; the rover still reads as the white robot it is.
     */
    ctx.fillStyle = '#ff6d00';
    ctx.beginPath();
    ctx.roundRect(-halfW + 3 * scale, -halfH + 4.5 * scale, bw - 6 * scale, bh * 0.16, 2.5 * scale);
    ctx.fill();
    // A darker lower lip, so the band has a little depth rather than sitting flat.
    ctx.fillStyle = 'rgba(150,55,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(-halfW + 3 * scale, -halfH + 4.5 * scale + bh * 0.115, bw - 6 * scale, bh * 0.045, 1.6 * scale);
    ctx.fill();
    // PCB mounting holes along the edges.
    ctx.fillStyle = 'rgba(90,95,100,0.5)';
    for (let i = 0; i < 5; i++) {
        const hy = -halfH + bh * (0.14 + i * 0.18);
        for (const hx of [-halfW + 2.6 * scale, halfW - 2.6 * scale]) {
            ctx.beginPath();
            ctx.arc(hx, hy, 0.8 * scale, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    // The micro:bit on the deck: dark board, gold edge-connector teeth at the
    // back, and its little red LED matrix.
    const mbW = bw * 0.5;
    const mbH = bh * 0.3;
    const mbY = -bh * 0.02;
    ctx.fillStyle = '#1c1e22';
    ctx.beginPath();
    ctx.roundRect(-mbW / 2, mbY, mbW, mbH, 1.6 * scale);
    ctx.fill();
    ctx.fillStyle = '#c9a227';
    for (let i = 0; i < 6; i++) {
        ctx.fillRect(-mbW / 2 + 1.5 + i * ((mbW - 3) / 6), mbY + mbH - 2.2 * scale, (mbW - 3) / 6 - 1.2, 1.6 * scale);
    }
    ctx.fillStyle = 'rgba(255,80,60,0.85)';
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            ctx.beginPath();
            ctx.arc(-mbW / 6 + (i * mbW) / 6, mbY + mbH * 0.28 + (j * mbH) / 4.2, 0.55 * scale, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    /**
     * The ultrasonic head: the real rover's face. A white board up front with
     * two round sensor eyes side by side - faithful to the photos, and the
     * cutest thing on the chassis without inventing anything. The soft pulse in
     * the pupils follows the playhead, so it reads as switched on.
     */
    const headW = bw * 0.62;
    const headH = 7.5 * scale;
    const headY = -halfH - headH * 0.35;
    ctx.fillStyle = '#f4f5f2';
    ctx.strokeStyle = '#2a2d31';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(-headW / 2, headY - headH / 2, headW, headH, 2.2 * scale);
    ctx.fill();
    ctx.stroke();
    const pulse = 0.5 + 0.3 * Math.sin(t * 0.55);
    for (const ex of [-headW * 0.22, headW * 0.22]) {
        // Transducer barrel.
        ctx.fillStyle = '#33373d';
        ctx.strokeStyle = '#15171a';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ex, headY, 2.7 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Mesh ring.
        ctx.strokeStyle = 'rgba(190,195,200,0.7)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(ex, headY, 1.9 * scale, 0, Math.PI * 2);
        ctx.stroke();
        // Pupil, faintly alive.
        ctx.fillStyle = `rgba(140,230,255,${pulse.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(ex, headY, 0.95 * scale, 0, Math.PI * 2);
        ctx.fill();
    }
    /**
     * The four corner lamps. The real chassis has one at each corner, in the
     * order LED_POSITIONS uses: 0 rear-left, 1 front-left, 2 front-right,
     * 3 rear-right. Drawn last so the glow sits over the chassis.
     */
    const lampR = 3.1 * scale;
    const lampPositions = [
        [-halfW + lampR * 0.6, halfH - lampR * 0.6],
        [-halfW + lampR * 0.6, -halfH + lampR * 0.6],
        [halfW - lampR * 0.6, -halfH + lampR * 0.6],
        [halfW - lampR * 0.6, halfH - lampR * 0.6],
    ];
    lampPositions.forEach(([lx, ly], i) => {
        const rgb = st.leds?.[i];
        if (!rgb) {
            // An unlit lamp is still a lamp: a dark bead, so the child can see there
            // is something there to turn on.
            ctx.fillStyle = 'rgba(15,23,42,0.85)';
            ctx.strokeStyle = 'rgba(148,163,184,0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(lx, ly, lampR * 0.75, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            return;
        }
        const colour = `rgb(${rgb})`;
        // Halo first, so several lit lamps pool their light like the real thing.
        const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, lampR * 4.5);
        glow.addColorStop(0, `rgba(${rgb}, 0.55)`);
        glow.addColorStop(0.5, `rgba(${rgb}, 0.16)`);
        glow.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lx, ly, lampR * 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(lx, ly, lampR, 0, Math.PI * 2);
        ctx.fill();
        // A white centre reads as "lit" rather than "painted".
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(lx - lampR * 0.2, ly - lampR * 0.2, lampR * 0.38, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}
/**
 * Draw a full simulator frame (terrain + trail + rover) for a given playhead.
 * `playhead` may be fractional; the rover position is interpolated for smooth
 * motion. With an empty trajectory the rover is parked at the start pad.
 */
export function drawSimFrame(ctx, L, traj, playhead, 
// Defaulted so any caller that has not been told about themes yet keeps the
// original night-time yard rather than rendering colourless.
P = DARK_SIM_PALETTE, 
/** The yard's floor photo, once loaded (useYardFloor). Plain ground until then. */
floor = null, 
/** A challenge's target, under everything the rover does. */
target = null) {
    // Skip degenerate layouts (container not laid out yet) to avoid drawing with
    // a zero/negative scale.
    if (L.w <= 0 || L.h <= 0 || L.s <= 0)
        return;
    drawTerrain(ctx, L, P, floor);
    if (target)
        drawTarget(ctx, L, target);
    if (traj.length === 0) {
        drawRover(ctx, L, { x: 0, y: 0, heading: 0, servos: {} }, 0);
        return;
    }
    drawTrail(ctx, L, traj, Math.floor(playhead), P);
    // Under the rover, so the rover sits against what it hit.
    const impact = crashImpact(L, traj);
    if (impact && playhead >= impact.frame)
        drawCrashMark(ctx, L, impact);
    const current = interpolate(traj, playhead);
    /**
     * Odometer, in screen px, up to the playhead: how far the wheels have
     * actually rolled. Position deltas cover driving; the heading term covers
     * spinning on the spot, where the wheels turn hard while the rover goes
     * nowhere. Recomputed from the trajectory each frame rather than
     * accumulated, so scrubbing backwards is exact.
     */
    let odo = 0;
    const upTo = Math.min(traj.length - 1, Math.ceil(playhead));
    for (let i = 1; i <= upTo; i++) {
        odo += Math.hypot(traj[i].x - traj[i - 1].x, traj[i].y - traj[i - 1].y) * L.s;
        odo += Math.abs(traj[i].heading - traj[i - 1].heading) * 0.35;
    }
    drawRover(ctx, L, current, playhead, odo);
}
export function crashImpact(L, traj) {
    const frame = crashFrame(traj);
    if (frame < 0)
        return null;
    const point = traj[frame];
    const [cx, cy] = roverToYard(point.x, point.y, L.yard);
    const rock = point.hitRock ? L.yard.rocks.find((r) => r.name === point.hitRock) ?? null : null;
    if (rock) {
        // On the rock's edge, on the line to the rover: the side it was hit from.
        const radius = rockRadius(rock);
        const dx = cx - rock.x;
        const dy = cy - rock.y;
        const d = Math.hypot(dx, dy) || 1;
        return {
            frame,
            contact: [rock.x + (dx / d) * radius, rock.y + (dy / d) * radius],
            away: [dx / d, dy / d],
            rock,
            wall: null,
        };
    }
    // The physics holds the rover's centre a fixed distance off whichever wall
    // stopped it, so that wall is the nearest one.
    const { widthCm: w, depthCm: d } = L.yard;
    const walls = [
        { wall: 'west', contact: [0, cy], away: [1, 0] },
        { wall: 'east', contact: [w, cy], away: [-1, 0] },
        { wall: 'north', contact: [cx, 0], away: [0, 1] },
        { wall: 'south', contact: [cx, d], away: [0, -1] },
    ];
    const gaps = [cx, w - cx, cy, d - cy];
    const nearest = walls[gaps.indexOf(Math.min(...gaps))];
    return { frame, ...nearest, rock: null };
}
function rockRadius(rock) {
    return Math.max(rock.widthCm, rock.depthCm) / 2;
}
/**
 * Where a run crashed: the rock it hit ringed in red, or the stretch of wall
 * it ran into. Nothing moves: the real rover stops against a rock and pushes,
 * and the rock stays put, so the simulator shows exactly that (AB#466). An
 * earlier version shook the yard, bounced the rover back, knocked the rock
 * and threw grit, which made the simulator less like the yard it predicts.
 *
 * Kept on screen after the crash frame, so a learner who looked away, or a
 * run that backs off and carries on, still sees the spot the pre-flight check
 * is complaining about.
 */
function drawCrashMark(ctx, L, impact) {
    const s = L.s;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(239,68,68,0.95)';
    if (impact.rock) {
        const [rx, ry] = yardToScreen(L, impact.rock.x, impact.rock.y);
        const r = rockRadius(impact.rock) + 2;
        ctx.lineWidth = Math.max(2, 0.6 * s);
        ctx.beginPath();
        ctx.ellipse(rx, ry, r * L.sx, r * L.sy, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    else {
        const [x, y] = impact.contact;
        const along = [impact.away[1], -impact.away[0]];
        const [ax, ay] = yardToScreen(L, x - along[0] * 16, y - along[1] * 16);
        const [bx, by] = yardToScreen(L, x + along[0] * 16, y + along[1] * 16);
        ctx.lineWidth = Math.max(3, 1.2 * s);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
    }
    ctx.restore();
}

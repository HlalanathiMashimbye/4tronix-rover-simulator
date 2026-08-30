// GENERATED FILE - DO NOT EDIT.
// Built from mission-control/src/lib by scripts/build-roversim.mjs.
// Edit the TypeScript source and re-run `npm run build:roversim`.
/**
 * 2D rover-simulator drawing for the live simulator panel (RoverSimulator).
 *
 * Inspired by the 4tronix Qt simulator: a top-down yard with a vector
 * rover whose four wheels steer to their servo angles.
 */
/** Mars at night: the original look, unchanged. */
export const DARK_SIM_PALETTE = {
    backdrop: '#1a0f0a',
    groundInner: '#7c4a2b',
    groundMid: '#5a3320',
    groundOuter: '#34190d',
    craterCore: 'rgba(0,0,0,0.28)',
    craterMid: 'rgba(0,0,0,0.10)',
    craterRim: 'rgba(255,210,170,0.05)',
    grid: 'rgba(255,190,150,0.08)',
    vignetteTop: 'rgba(0,0,0,0.30)',
    vignetteBottom: 'rgba(0,0,0,0.35)',
    border: 'rgba(255,109,0,0.55)',
    trail: '#2196f3',
};
/**
 * Paper & Ink: sunlit regolith rather than night. Tuned to sit inside the
 * light theme's warm paper without becoming a bright hole in the page, and
 * every overlay (craters, grid, vignette) flips from black-based to a warm
 * brown so it darkens the sand instead of greying it.
 */
export const LIGHT_SIM_PALETTE = {
    backdrop: '#efeae1',
    groundInner: '#e3d5bf',
    groundMid: '#cfbda2',
    groundOuter: '#b6a086',
    craterCore: 'rgba(88,66,42,0.20)',
    craterMid: 'rgba(88,66,42,0.08)',
    craterRim: 'rgba(255,252,245,0.55)',
    grid: 'rgba(88,66,42,0.12)',
    vignetteTop: 'rgba(88,66,42,0.16)',
    vignetteBottom: 'rgba(88,66,42,0.20)',
    border: 'rgba(45,38,30,0.28)',
    trail: '#1668c9',
};
// The physical yard (matches the Qt simulator: 400 x 300 cm).
/**
 * The driveable yard, in centimetres.
 *
 * SIZED SO THE ROVER'S REAL SPEED READS AS MOVEMENT.
 *
 * The rover covers 6cm a second at speed 60, which is what the hardware
 * actually does. In a 640cm yard that made a default square about 4% of the
 * width - smaller than the rover icon - so a child drew a perfect square and
 * saw nothing happen.
 *
 * The fix is the yard, not the speed. FULL_SPEED_CM_PER_SECOND is tied to real
 * hardware, and inflating it would make the simulator trace a neat square on
 * screen while the real rover traced something else, which destroys the only
 * thing a simulator is for. The old 400x300 was inherited from the 4tronix Qt
 * simulator rather than measured from anything, so the yard was always the
 * free parameter.
 *
 * CHOSEN FOR HOW IT LOOKS, not to match a room anyone has measured. 400x300
 * came from the old Qt simulator and nothing since has been a physical fact, so
 * this is the one number here free to be picked.
 *
 * With the rover drawn at its true 20cm, its size on screen IS the yard size:
 * an eighth of the width at 240, a sixth at 120. Wanting a small rover and a
 * big square pulls this in opposite directions, and the way out is a larger
 * world with longer default drives - which is why the drive blocks default to
 * 5 seconds rather than 1. Together they give a rover at 8% and a default
 * square at 18%, so the shape is comfortably bigger than the thing drawing it.
 *
 * rover-physics.ts bounds the rover to the same numbers, and the two must not
 * drift.
 */
export const YARD_W = 240;
export const YARD_H = 180;
export const SIM_FPS = 10; // trajectory is sampled at 0.1s steps
const MARGIN = 10; // px inset so the rover never clips the panel edge
// Servo ids for the four steerable wheels (front/rear, left/right).
const FL = '9';
const FR = '15';
const RL = '11';
const RR = '13';
// Deterministic crater field (world cm) so the terrain reads as Mars without a
// muddy photo. Each is [x, y, radius].
/**
 * The original six craters, scaled with the yard so they sit exactly where they
 * always did as a fraction of the ground.
 */
const CRATERS = [
    [-78, 48, 20],
    [54, 36, 16],
    [84, -42, 24],
    [-54, -54, 13],
    [12, 72, 11],
    [-96, -18, 10],
];
/**
 * One light direction for the whole scene, up and to the left.
 *
 * This is what makes a flat canvas read as ground rather than as circles on a
 * brown rectangle: every crater darkens on the same side and every rock casts
 * its shadow the same way. Get it inconsistent and the eye stops believing any
 * of it.
 */
const LIGHT = { x: -0.55, y: -0.83 };
export function computeLayout(w, h) {
    // Clamp to >= 0: a container briefly smaller than the margins (mid-layout)
    // would otherwise yield a negative scale and an illegal gradient radius.
    const s = Math.max(0, Math.min((w - 2 * MARGIN) / YARD_W, (h - 2 * MARGIN) / YARD_H));
    return { w, h, s, ox: (w - YARD_W * s) / 2, oy: (h - YARD_H * s) / 2 };
}
function worldToScreen(L, wx, wy) {
    return [L.ox + (wx + YARD_W / 2) * L.s, L.oy + (YARD_H / 2 - wy) * L.s];
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
function drawTerrain(ctx, L, P) {
    const key = `${L.w}x${L.h}@${L.s.toFixed(4)}:${P.groundInner}`;
    if (terrainCache?.key !== key) {
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const off = typeof document !== 'undefined' ? document.createElement('canvas') : null;
        const g = off?.getContext('2d');
        if (!off || !g) {
            // No offscreen canvas (test environments) - paint straight through.
            paintTerrain(ctx, L, P);
            return;
        }
        off.width = Math.max(1, Math.round(L.w * dpr));
        off.height = Math.max(1, Math.round(L.h * dpr));
        g.scale(dpr, dpr);
        paintTerrain(g, L, P);
        terrainCache = { key, canvas: off };
    }
    ctx.drawImage(terrainCache.canvas, 0, 0, L.w, L.h);
}
function paintTerrain(ctx, L, P) {
    const { w, h, s } = L;
    /**
     * The original ground, simply stretched to the whole panel.
     *
     * A previous pass layered mottled drifts, wind ripples, grit and boulders on
     * top of this. It was busier, not better: the yard is the backdrop a child
     * reads their rover's path against, and every extra mark competed with the
     * one thing that matters on the canvas. Simple wash, six craters, faint
     * grid - as it was.
     */
    const ground = ctx.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.1, w / 2, h / 2, Math.max(w, h) * 0.75);
    ground.addColorStop(0, P.groundInner);
    ground.addColorStop(0.55, P.groundMid);
    ground.addColorStop(1, P.groundOuter);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);
    // Craters: a darker bowl with a faint sunlit rim for depth.
    for (const [cx, cy, cr] of CRATERS) {
        const [px, py] = worldToScreen(L, cx, cy);
        const r = cr * s;
        if (r <= 0.5)
            continue;
        const cg = ctx.createRadialGradient(px, py - r * 0.2, r * 0.2, px, py, r);
        cg.addColorStop(0, P.craterCore);
        cg.addColorStop(0.8, P.craterMid);
        cg.addColorStop(1, P.craterRim);
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
    }
    // Faint measurement grid every 30cm, keeping the same handful of divisions.
    ctx.strokeStyle = P.grid;
    ctx.lineWidth = 1;
    for (let gx = -YARD_W * 1.5; gx <= YARD_W * 1.5; gx += 30) {
        const [sx] = worldToScreen(L, gx, 0);
        if (sx < -2 || sx > w + 2)
            continue;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
        ctx.stroke();
    }
    for (let gy = -YARD_H * 1.5; gy <= YARD_H * 1.5; gy += 30) {
        const [, sy] = worldToScreen(L, 0, gy);
        if (sy < -2 || sy > h + 2)
            continue;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
        ctx.stroke();
    }
    // Edge shadow, over the whole panel since nothing frames it now.
    const vg = ctx.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, P.vignetteTop);
    vg.addColorStop(0.15, 'rgba(0,0,0,0)');
    vg.addColorStop(0.85, 'rgba(0,0,0,0)');
    vg.addColorStop(1, P.vignetteBottom);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    // Start pad at the origin, where every run begins.
    const [hx, hy] = worldToScreen(L, 0, 0);
    ctx.strokeStyle = 'rgba(52,211,153,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(52,211,153,0.18)';
    ctx.fill();
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
     * TRUE SCALE, near enough, now the yard is 160cm rather than 640.
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
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((st.heading * Math.PI) / 180); // front points along heading
    // Contact shadow, thrown by the same light as the terrain. Drawn in an
    // unrotated frame so it stays on the ground as the body turns.
    ctx.save();
    ctx.rotate((-st.heading * Math.PI) / 180);
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
function drawWallHit(ctx, L, st) {
    const [cx, cy] = worldToScreen(L, st.x, st.y);
    const radius = 18 * Math.max(0.7, Math.min(1.7, L.s / 1.4));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, 'rgba(239,68,68,0.55)');
    glow.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = glow;
    ctx.fill();
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
P = DARK_SIM_PALETTE) {
    // Skip degenerate layouts (container not laid out yet) to avoid drawing with
    // a zero/negative scale.
    if (L.w <= 0 || L.h <= 0 || L.s <= 0)
        return;
    drawTerrain(ctx, L, P);
    if (traj.length === 0) {
        drawRover(ctx, L, { x: 0, y: 0, heading: 0, servos: {} }, 0);
        return;
    }
    drawTrail(ctx, L, traj, Math.floor(playhead), P);
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
    if (current.hitWall) {
        drawWallHit(ctx, L, current);
    }
}

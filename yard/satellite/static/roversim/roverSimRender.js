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
    rockLit: 'rgba(190,138,100,0.95)',
    rockMid: 'rgba(126,80,52,0.95)',
    rockDark: 'rgba(64,35,20,0.95)',
    rockShadow: 'rgba(24,10,4,0.42)',
    rockHighlight: 'rgba(255,230,200,0.28)',
    craterLip: 'rgba(255,226,190,0.22)',
    dustLight: 'rgba(255,225,190,0.10)',
    dustDark: 'rgba(60,25,10,0.16)',
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
    // Sunlit stone, not night stone. The dark-theme browns read as mud here.
    rockLit: 'rgba(214,192,163,0.98)',
    rockMid: 'rgba(178,150,118,0.98)',
    rockDark: 'rgba(126,101,74,0.98)',
    rockShadow: 'rgba(96,72,46,0.30)',
    rockHighlight: 'rgba(255,253,246,0.55)',
    craterLip: 'rgba(255,253,246,0.60)',
    dustLight: 'rgba(255,252,244,0.35)',
    dustDark: 'rgba(96,72,46,0.14)',
};
// The physical yard (matches the Qt simulator: 400 x 300 cm).
/**
 * The driveable yard, in centimetres.
 *
 * Grown from 400x300. At the old size a couple of forward blocks put the rover
 * against a wall, which is a dull thing to discover when the whole point of a
 * simulator is to give a child room to play. rover-physics.ts bounds the rover
 * to the same numbers, and the two must not drift.
 */
export const YARD_W = 640;
export const YARD_H = 480;
export const SIM_FPS = 10; // trajectory is sampled at 0.1s steps
const MARGIN = 10; // px inset so the rover never clips the panel edge
// Servo ids for the four steerable wheels (front/rear, left/right).
const FL = '9';
const FR = '15';
const RL = '11';
const RR = '13';
// Deterministic crater field (world cm) so the terrain reads as Mars without a
// muddy photo. Each is [x, y, radius].
const CRATERS = [
    [-210, 130, 46],
    [150, 95, 34],
    [235, -110, 52],
    [-150, -145, 30],
    [30, 190, 24],
    [-265, -55, 22],
    [95, -35, 16],
    [-60, 55, 13],
    // Outside the fence. The ground carries on past the play area, which is what
    // stops the panel looking like a small box floating in the dark.
    [-430, 250, 60],
    [420, 210, 44],
    [-390, -260, 38],
    [400, -240, 56],
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
/**
 * Boulders, in world cm as [x, y, radius, roundness].
 *
 * Hand-placed rather than random, and deterministic: the terrain has to be
 * identical on every frame and every reload, or the ground would shimmer as
 * the rover drives over it and a learner would never recognise their own yard.
 * Placed off the centre line so the start pad stays clear.
 */
const ROCKS = [
    [-245, 60, 13, 0.8], [178, 150, 10, 0.7], [-108, -182, 15, 0.85],
    [262, 28, 9, 0.75], [-60, 152, 7, 0.9], [118, -158, 12, 0.7],
    [-292, -128, 8, 0.8], [72, 88, 6, 0.85], [-172, 12, 9, 0.72],
    [228, -186, 14, 0.78], [-24, -96, 7, 0.88], [152, -62, 8, 0.8],
    [-368, 178, 17, 0.75], [352, 132, 13, 0.82], [-338, -212, 11, 0.78],
];
/** Deterministic speckle, so the dust does not crawl between frames. */
function dustAt(i) {
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const b = Math.sin(i * 78.233) * 24634.6345;
    const c = Math.sin(i * 39.425) * 15731.743;
    return [(a - Math.floor(a)), (b - Math.floor(b)), (c - Math.floor(c))];
}
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
function drawTerrain(ctx, L, P) {
    const { w, h, s } = L;
    /**
     * THE GROUND COVERS THE WHOLE PANEL, not just the driveable yard.
     *
     * The yard is 4:3 and the panel rarely is, so fitting one inside the other
     * left bars of dead background above and below: a small box floating in the
     * dark, which is what made the arena feel cramped however large the numbers
     * were. Mars now runs to every edge and the fence sits on top of it, so the
     * play area reads as part of a bigger place rather than the whole world.
     */
    const ground = ctx.createRadialGradient(w / 2, h * 0.38, Math.min(w, h) * 0.05, w / 2, h * 0.5, Math.max(w, h) * 0.75);
    ground.addColorStop(0, P.groundInner);
    ground.addColorStop(0.5, P.groundMid);
    ground.addColorStop(1, P.groundOuter);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);
    // Dust and grit, thickest toward the edges where the light falls off.
    for (let i = 1; i <= 420; i++) {
        const [rx, ry, rv] = dustAt(i);
        const px = rx * w;
        const py = ry * h;
        const size = 0.6 + rv * 1.7;
        ctx.fillStyle = rv > 0.55 ? P.dustLight : P.dustDark;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
    }
    /**
     * Craters, dug rather than drawn.
     *
     * Three passes: a shadow crescent on the far side of the light, the bowl
     * itself, and a lit rim on the near side. A single radial gradient reads as a
     * smudge; this reads as a hole.
     */
    for (const [cx, cy, cr] of CRATERS) {
        const [px, py] = worldToScreen(L, cx, cy);
        const r = cr * s;
        if (r <= 0.5)
            continue;
        // Raised rim, catching the light on one side.
        const rim = ctx.createRadialGradient(px, py, r * 0.82, px, py, r * 1.12);
        rim.addColorStop(0, 'rgba(0,0,0,0)');
        rim.addColorStop(0.5, P.craterLip);
        rim.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rim;
        ctx.beginPath();
        ctx.arc(px, py, r * 1.12, 0, Math.PI * 2);
        ctx.fill();
        // The bowl, offset toward the light so the far wall stays dark.
        const cg = ctx.createRadialGradient(px - LIGHT.x * r * 0.45, py - LIGHT.y * r * 0.45, r * 0.12, px, py, r);
        cg.addColorStop(0, P.craterCore);
        cg.addColorStop(0.72, P.craterMid);
        cg.addColorStop(1, P.craterRim);
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        // Bright lip on the lit edge, the detail that sells the depth.
        ctx.save();
        ctx.strokeStyle = P.craterLip;
        ctx.lineWidth = Math.max(1, r * 0.08);
        ctx.beginPath();
        ctx.arc(px, py, r * 0.96, Math.PI * 0.85, Math.PI * 1.85);
        ctx.stroke();
        ctx.restore();
    }
    /**
     * Boulders. Each one is a shadow, a body, and a highlight, all agreeing on
     * where the light is.
     */
    for (const [cx, cy, cr, round] of ROCKS) {
        const [px, py] = worldToScreen(L, cx, cy);
        const r = cr * s;
        if (r <= 0.5)
            continue;
        ctx.fillStyle = P.rockShadow;
        ctx.beginPath();
        ctx.ellipse(px - LIGHT.x * r * 1.5, py - LIGHT.y * r * 1.5, r * 1.15, r * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        const body = ctx.createRadialGradient(px + LIGHT.x * r * 0.5, py + LIGHT.y * r * 0.5, r * 0.15, px, py, r);
        body.addColorStop(0, P.rockLit);
        body.addColorStop(0.6, P.rockMid);
        body.addColorStop(1, P.rockDark);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * round, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = P.rockHighlight;
        ctx.beginPath();
        ctx.ellipse(px + LIGHT.x * r * 0.42, py + LIGHT.y * r * 0.42, r * 0.34, r * 0.22 * round, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    // Measurement grid, every 80 cm now the yard is larger.
    ctx.strokeStyle = P.grid;
    ctx.lineWidth = 1;
    // Runs off every edge, like the ground it is drawn on. Stopping the lines at
    // the yard would put the box straight back.
    for (let gx = -YARD_W * 1.5; gx <= YARD_W * 1.5; gx += 80) {
        const [sx] = worldToScreen(L, gx, 0);
        if (sx < -2 || sx > w + 2)
            continue;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
        ctx.stroke();
    }
    for (let gy = -YARD_H * 1.5; gy <= YARD_H * 1.5; gy += 80) {
        const [, sy] = worldToScreen(L, 0, gy);
        if (sy < -2 || sy > h + 2)
            continue;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
        ctx.stroke();
    }
    // Vignette over the whole panel, which is what frames the scene now that
    // nothing else does.
    const vg = ctx.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, P.vignetteTop);
    vg.addColorStop(0.18, 'rgba(0,0,0,0)');
    vg.addColorStop(0.82, 'rgba(0,0,0,0)');
    vg.addColorStop(1, P.vignetteBottom);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    // Start pad at the origin, where every run begins.
    const [hx, hy] = worldToScreen(L, 0, 0);
    ctx.save();
    ctx.strokeStyle = 'rgba(52,211,153,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(hx, hy, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(52,211,153,0.14)';
    ctx.beginPath();
    ctx.arc(hx, hy, 13, 0, Math.PI * 2);
    ctx.fill();
    /*
     * NO FENCE.
     *
     * There used to be a rounded rectangle around the driveable area, which put
     * a square inside a square: a box floating on a panel that is itself a box.
     * The ground now simply carries on to every edge, which is what a yard on
     * Mars would actually look like from above.
     *
     * The boundary still exists in the physics, and the rover still cannot leave
     * it. When it reaches the edge, drawWallHit says so at the point of contact -
     * which is a better way to learn where the edge is than a line drawn around
     * everything for the whole run.
     */
}
function drawTrail(ctx, L, traj, endIdx, P) {
    if (endIdx <= 0)
        return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = P.trail;
    ctx.beginPath();
    for (let i = 0; i <= endIdx && i < traj.length; i++) {
        const [sx, sy] = worldToScreen(L, traj[i].x, traj[i].y);
        if (i === 0)
            ctx.moveTo(sx, sy);
        else
            ctx.lineTo(sx, sy);
    }
    ctx.stroke();
}
function drawRover(ctx, L, st) {
    const [cx, cy] = worldToScreen(L, st.x, st.y);
    /**
     * Deliberately bigger than scale, and bigger again since the yard grew.
     *
     * A true-to-scale rover in a 640cm yard is a speck. The learner has to be
     * able to see which way it is pointing, whether its wheels have turned, and
     * now which of its four lamps are lit - none of which survive at true size on
     * a panel this size. The yard is the honest measurement; the rover is an icon
     * standing in the right place.
     */
    const scale = Math.max(1.15, Math.min(2.6, L.s / 0.85));
    const bw = 30 * scale;
    const bh = 38 * scale;
    const halfW = bw / 2;
    const halfH = bh / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((st.heading * Math.PI) / 180); // front points along heading
    // Contact shadow, thrown away from the same light the terrain uses. Drawn
    // before the rotate would have pinned it to the body, so it stays put on the
    // ground as the rover turns.
    ctx.save();
    ctx.rotate((-st.heading * Math.PI) / 180);
    ctx.fillStyle = 'rgba(20,8,2,0.38)';
    ctx.beginPath();
    ctx.ellipse(-LIGHT.x * 7, -LIGHT.y * 7, halfW + 6, halfH * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const wheelH = 11 * scale;
    const wheel = (lx, ly, angle) => {
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(-3.1 * scale, -wheelH / 2, 6.2 * scale, wheelH, 2.6 * scale);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(148,163,184,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-2 * scale, 0);
        ctx.lineTo(2 * scale, 0);
        ctx.stroke();
        ctx.restore();
    };
    // The M.A.R.S. rover has six wheels: the four corners steer to their servo
    // angles; the middle pair is fixed (front toward -y). Middle wheels sit a
    // touch more outboard, like the real chassis.
    const frontY = -halfH * 0.66;
    const rearY = halfH * 0.66;
    wheel(-halfW - 1, frontY, st.servos?.[FL] ?? 0);
    wheel(halfW + 1, frontY, st.servos?.[FR] ?? 0);
    wheel(-halfW - 2, 0, 0);
    wheel(halfW + 2, 0, 0);
    wheel(-halfW - 1, rearY, st.servos?.[RL] ?? 0);
    wheel(halfW + 1, rearY, st.servos?.[RR] ?? 0);
    // Chassis.
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-halfW, -halfH, bw, bh, 7 * scale);
    ctx.fill();
    ctx.stroke();
    // Solar / top plate (Mars orange).
    ctx.fillStyle = '#ff6d00';
    ctx.beginPath();
    ctx.roundRect(-halfW + 4 * scale, -halfH + 6 * scale, bw - 8 * scale, bh * 0.42, 4 * scale);
    ctx.fill();
    // Camera mast (a friendly "eye") near the front.
    ctx.fillStyle = '#0ea5e9';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, -halfH * 0.45, 4 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Headlight blip marking the front.
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(0, -halfH - 2 * scale, 2.4 * scale, 0, Math.PI * 2);
    ctx.fill();
    /**
     * The four corner lamps.
     *
     * The real chassis has one at each corner, and the blocks have always let a
     * child choose a colour for any of them - it simply never showed up here, so
     * "Set all LEDs to green" did nothing a learner could see. Index order
     * matches LED_POSITIONS in roverBlockly: 0 rear-left, 1 front-left,
     * 2 front-right, 3 rear-right.
     *
     * Drawn last so the glow sits over the chassis rather than under it.
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
        drawRover(ctx, L, { x: 0, y: 0, heading: 0, servos: {} });
        return;
    }
    drawTrail(ctx, L, traj, Math.floor(playhead), P);
    const current = interpolate(traj, playhead);
    drawRover(ctx, L, current);
    if (current.hitWall) {
        drawWallHit(ctx, L, current);
    }
}

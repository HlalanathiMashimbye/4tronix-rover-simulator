/**
 * 2D rover-simulator drawing for the live simulator panel (RoverSimulator).
 *
 * Inspired by the 4tronix Qt simulator: a top-down yard with a vector
 * rover whose four wheels steer to their servo angles.
 */

export interface SimPoint {
  x: number;
  y: number;
  heading: number;
  servos: Record<string, number>;
  hitWall?: boolean;
  /** The four corner lamps: 'r, g, b' or null for off. */
  leds?: (string | null)[];
}

export interface SimLayout {
  w: number;
  h: number;
  s: number; // px per cm
  ox: number; // x offset of the yard within the canvas
  oy: number; // y offset of the yard within the canvas
}

/**
 * Terrain colours, so the yard can follow the page theme.
 *
 * These are passed in rather than read from CSS inside the renderer: this
 * module draws to a canvas, and canvas takes colour strings, not custom
 * properties - `var(--clay)` in a fillStyle is simply ignored and the shape
 * paints transparent. Resolving them once per frame in the component (which
 * can call getComputedStyle) keeps that lookup out of the draw path.
 *
 * Only the GROUND is themed. The rover keeps one set of colours in both
 * themes: it is a physical object with a fixed identity, and its dark outline
 * already separates it from either background.
 */
export interface SimPalette {
  backdrop: string;    // behind the letterboxed yard
  groundInner: string; // radial wash, centre
  groundMid: string;
  groundOuter: string;
  craterCore: string;  // crater bowl, darkest at centre
  craterMid: string;
  craterRim: string;   // faint sunlit lip
  grid: string;        // 50cm measurement lines
  vignetteTop: string; // arena edge shadow
  vignetteBottom: string;
  border: string;      // frame around the play area
  trail: string;       // the path the rover has driven
  // Scenery. Themed for the same reason the ground is: hardcoded browns turned
  // the light theme's pale regolith into a field of mud-coloured blobs.
  rockLit: string;     // boulder, facing the light
  rockMid: string;
  rockDark: string;    // boulder, facing away
  rockShadow: string;  // the shadow it throws
  rockHighlight: string;
  craterLip: string;   // bright arc on the lit edge
  dustLight: string;   // grit catching the light
  dustDark: string;
  mottleLight: string; // soft sand patches, lighter than the ground
  mottleDark: string;  // and darker, for the wind-blown look
  rippleInk: string;   // sand ripple strokes
}

/** Mars at night: the original look, unchanged. */
export const DARK_SIM_PALETTE: SimPalette = {
  backdrop: '#3a1a10',
  // Proper Mars red, not brown. The old ground read as mud; this is regolith.
  groundInner: '#a0492d',
  groundMid: '#8a3b22',
  groundOuter: '#5c2413',
  craterCore: 'rgba(30,12,7,0.60)',   // dark basin
  craterMid: 'rgba(40,18,10,0.45)',   // shadowed rim ring
  craterRim: 'rgba(150,75,45,0.55)',  // sunlit inner wall
  grid: 'rgba(255,190,150,0.045)',
  vignetteTop: 'rgba(0,0,0,0.30)',
  vignetteBottom: 'rgba(0,0,0,0.35)',
  border: 'rgba(255,109,0,0.55)',
  trail: '#2196f3',
  rockLit: 'rgba(190,138,100,0.95)',
  rockMid: 'rgba(126,80,52,0.95)',
  rockDark: 'rgba(64,35,20,0.95)',
  rockShadow: 'rgba(24,10,4,0.42)',
  rockHighlight: 'rgba(255,230,200,0.28)',
  craterLip: 'rgba(210,130,90,0.30)',
  dustLight: 'rgba(255,225,190,0.10)',
  dustDark: 'rgba(60,25,10,0.16)',
  mottleLight: 'rgba(255,205,160,0.055)',
  mottleDark: 'rgba(30,12,4,0.075)',
  rippleInk: 'rgba(45,16,6,0.11)',
};

/**
 * Paper & Ink: sunlit regolith rather than night. Tuned to sit inside the
 * light theme's warm paper without becoming a bright hole in the page, and
 * every overlay (craters, grid, vignette) flips from black-based to a warm
 * brown so it darkens the sand instead of greying it.
 */
export const LIGHT_SIM_PALETTE: SimPalette = {
  backdrop: '#efeae1',
  groundInner: '#e3d5bf',
  groundMid: '#cfbda2',
  groundOuter: '#b6a086',
  craterCore: 'rgba(88,66,42,0.34)',
  craterMid: 'rgba(88,66,42,0.24)',
  craterRim: 'rgba(255,246,228,0.38)',
  grid: 'rgba(88,66,42,0.08)',
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
  dustLight: 'rgba(255,252,244,0.18)',
  dustDark: 'rgba(96,72,46,0.14)',
  mottleLight: 'rgba(255,253,246,0.11)',
  mottleDark: 'rgba(122,96,66,0.07)',
  rippleInk: 'rgba(96,72,46,0.13)',
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
const CRATERS: [number, number, number][] = [
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
const ROCKS: [number, number, number, number][] = [
  [-245, 60, 13, 0.8], [178, 150, 10, 0.7], [-108, -182, 15, 0.85],
  [262, 28, 9, 0.75], [-60, 152, 7, 0.9], [118, -158, 12, 0.7],
  [-292, -128, 8, 0.8], [72, 88, 6, 0.85], [-172, 12, 9, 0.72],
  [228, -186, 14, 0.78], [-24, -96, 7, 0.88], [152, -62, 8, 0.8],
  [-368, 178, 17, 0.75], [352, 132, 13, 0.82], [-338, -212, 11, 0.78],
];

/** Seeded 0..1, so scenery is identical on every frame and every reload. */
function rand(i: number, salt = 1): number {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Deterministic speckle, so the dust does not crawl between frames. */
function dustAt(i: number): [number, number, number] {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 24634.6345;
  const c = Math.sin(i * 39.425) * 15731.743;
  return [(a - Math.floor(a)), (b - Math.floor(b)), (c - Math.floor(c))];
}

export function computeLayout(w: number, h: number): SimLayout {
  // Clamp to >= 0: a container briefly smaller than the margins (mid-layout)
  // would otherwise yield a negative scale and an illegal gradient radius.
  const s = Math.max(0, Math.min((w - 2 * MARGIN) / YARD_W, (h - 2 * MARGIN) / YARD_H));
  return { w, h, s, ox: (w - YARD_W * s) / 2, oy: (h - YARD_H * s) / 2 };
}

function worldToScreen(L: SimLayout, wx: number, wy: number): [number, number] {
  return [L.ox + (wx + YARD_W / 2) * L.s, L.oy + (YARD_H / 2 - wy) * L.s];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function interpolate(traj: SimPoint[], p: number): SimPoint {
  const len = traj.length;
  const i0 = Math.max(0, Math.min(len - 1, Math.floor(p)));
  const i1 = Math.min(len - 1, i0 + 1);
  const f = Math.max(0, Math.min(1, p - i0));
  const a = traj[i0];
  const b = traj[i1];
  const sv = (k: string) => lerp(a.servos?.[k] ?? 0, b.servos?.[k] ?? 0, f);
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
let terrainCache: { key: string; canvas: HTMLCanvasElement } | null = null;

function drawTerrain(ctx: CanvasRenderingContext2D, L: SimLayout, P: SimPalette) {
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

function paintTerrain(ctx: CanvasRenderingContext2D, L: SimLayout, P: SimPalette) {
  const { w, h, s } = L;

  // Base wash, lit from the same corner as everything else.
  const ground = ctx.createRadialGradient(
    w * 0.42, h * 0.34, Math.min(w, h) * 0.05,
    w / 2, h / 2, Math.max(w, h) * 0.8,
  );
  ground.addColorStop(0, P.groundInner);
  ground.addColorStop(0.5, P.groundMid);
  ground.addColorStop(1, P.groundOuter);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);

  /**
   * Mottling: broad soft patches of lighter and darker sand.
   *
   * This is most of the difference between "brown rectangle" and "ground".
   * Real regolith is blotchy at every scale, so two sizes of patch are layered
   * - wide drifts first, smaller variation on top.
   */
  for (let i = 1; i <= 150; i++) {
    const px = rand(i, 2) * w;
    const py = rand(i, 3) * h;
    const r = (i <= 60 ? 40 + rand(i, 4) * 90 : 12 + rand(i, 4) * 30) * Math.max(0.6, s / 1.2);
    const light = rand(i, 5) > 0.5;
    const blob = ctx.createRadialGradient(px, py, 0, px, py, r);
    blob.addColorStop(0, light ? P.mottleLight : P.mottleDark);
    blob.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Wind ripples: short, near-horizontal curved strokes, all bowing the same
   * way, as if one prevailing wind combed the sand. Random directions here
   * would read as scratches.
   */
  ctx.strokeStyle = P.rippleInk;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  for (let i = 1; i <= 22; i++) {
    const px = rand(i, 6) * w;
    const py = rand(i, 7) * h;
    const r = (18 + rand(i, 8) * 36) * Math.max(0.6, s / 1.2);
    ctx.save();
    ctx.translate(px, py);
    // One prevailing wind: every dune leans the same way, with only a little
    // scatter. Random rotations made them read as scratches.
    ctx.rotate(0.35 + (rand(i, 9) - 0.5) * 0.4);
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * (0.5 + k * 0.25), r * 0.15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Fine grit on top of the ripples.
  for (let i = 1; i <= 420; i++) {
    const [rx, ry, rv] = dustAt(i);
    ctx.fillStyle = rv > 0.55 ? P.dustLight : P.dustDark;
    ctx.beginPath();
    ctx.arc(rx * w, ry * h, 0.6 + rv * 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Grid: runs off every edge, like the ground it is drawn on.
  ctx.strokeStyle = P.grid;
  ctx.lineWidth = 1;
  for (let gx = -YARD_W * 1.5; gx <= YARD_W * 1.5; gx += 80) {
    const [sx] = worldToScreen(L, gx, 0);
    if (sx < -2 || sx > w + 2) continue;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
  }
  for (let gy = -YARD_H * 1.5; gy <= YARD_H * 1.5; gy += 80) {
    const [, sy] = worldToScreen(L, 0, gy);
    if (sy < -2 || sy > h + 2) continue;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }

  /**
   * Craters, dug rather than drawn: raised rim, a bowl offset toward the
   * light, a bright lip on the near edge, and a few flecks of rubble in the
   * bowl so the floor is not a perfect gradient.
   */
  let craterIndex = 0;
  for (const [cx, cy, cr] of CRATERS) {
    craterIndex++;
    const [px, py] = worldToScreen(L, cx, cy);
    const r = cr * s;
    if (r <= 0.5) continue;

    // Four concentric passes: shadow rim, sunlit inner wall offset toward the
    // light, dark basin, highlight lip. Offset rings carry the depth; a single
    // gradient never did.
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = P.craterMid;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px + LIGHT.x * r * 0.12, py + LIGHT.y * r * 0.12, r * 0.82, 0, Math.PI * 2);
    ctx.fillStyle = P.craterRim;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, r * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = P.craterCore;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.strokeStyle = P.craterLip;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Rubble on the basin floor.
    for (let f = 1; f <= 4; f++) {
      const fa = rand(craterIndex * 13 + f, 14) * Math.PI * 2;
      const fr = rand(craterIndex * 13 + f, 15) * r * 0.5;
      ctx.fillStyle = P.dustDark;
      ctx.beginPath();
      ctx.arc(px + Math.cos(fa) * fr, py + Math.sin(fa) * fr, 1 + rand(f, 16) * r * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Boulders. Irregular outlines - eight points at wobbling radii - because an
   * ellipse reads as a sticker and a lumpy polygon reads as a rock. Shadow,
   * body and highlight all agree on where the light is.
   */
  let rockIndex = 0;
  for (const [cx, cy, cr, round] of ROCKS) {
    rockIndex++;
    const [px, py] = worldToScreen(L, cx, cy);
    const r = cr * s;
    if (r <= 0.5) continue;

    ctx.fillStyle = P.rockShadow;
    ctx.beginPath();
    ctx.ellipse(px - LIGHT.x * r * 1.5, py - LIGHT.y * r * 1.5, r * 1.15, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();

    const outline: [number, number][] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const wobble = 0.72 + rand(rockIndex * 8 + k, 17) * 0.38;
      outline.push([px + Math.cos(a) * r * wobble, py + Math.sin(a) * r * wobble * round]);
    }

    const body = ctx.createRadialGradient(
      px + LIGHT.x * r * 0.5, py + LIGHT.y * r * 0.5, r * 0.15,
      px, py, r,
    );
    body.addColorStop(0, P.rockLit);
    body.addColorStop(0.6, P.rockMid);
    body.addColorStop(1, P.rockDark);
    ctx.fillStyle = body;
    ctx.beginPath();
    outline.forEach(([ox2, oy2], k) => (k === 0 ? ctx.moveTo(ox2, oy2) : ctx.lineTo(ox2, oy2)));
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = P.rockHighlight;
    ctx.beginPath();
    ctx.ellipse(
      px + LIGHT.x * r * 0.42, py + LIGHT.y * r * 0.42,
      r * 0.34, r * 0.22 * round, 0, 0, Math.PI * 2,
    );
    ctx.fill();
  }

  // Vignette over the whole panel, which is what frames the scene now.
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
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  L: SimLayout,
  traj: SimPoint[],
  endIdx: number,
  P: SimPalette
) {
  if (endIdx <= 0) return;

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
      if (Number.isNaN(lastX)) { lastX = sx; lastY = sy; }
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
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.restore();
}

function drawRover(ctx: CanvasRenderingContext2D, L: SimLayout, st: SimPoint, t = 0) {
  const [cx, cy] = worldToScreen(L, st.x, st.y);
  /**
   * Deliberately bigger than scale. A true-to-scale rover in a 640cm yard is a
   * speck: the learner has to see which way it points, whether the wheels have
   * turned, and which lamps are lit. The yard is the honest measurement; the
   * rover is a character standing in the right place.
   */
  const scale = Math.max(1.15, Math.min(2.6, L.s / 0.85));
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

  // Chunky wheels with two tread lines each - toy-like on purpose.
  const wheelH = 12.5 * scale;
  const wheel = (lx: number, ly: number, angle: number) => {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.fillStyle = '#1c2536';
    ctx.strokeStyle = '#0a0f1a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(-3.6 * scale, -wheelH / 2, 7.2 * scale, wheelH, 3 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(148,163,184,0.65)';
    ctx.lineWidth = 1.2;
    for (const ty of [-wheelH * 0.22, wheelH * 0.22]) {
      ctx.beginPath();
      ctx.moveTo(-2.2 * scale, ty);
      ctx.lineTo(2.2 * scale, ty);
      ctx.stroke();
    }
    ctx.restore();
  };

  // Six wheels: four corners steer, the middle pair is fixed - the real
  // M.A.R.S. chassis. Middle pair sits a touch more outboard, like the metal.
  const frontY = -halfH * 0.66;
  const rearY = halfH * 0.66;
  wheel(-halfW - 1, frontY, st.servos?.[FL] ?? 0);
  wheel(halfW + 1, frontY, st.servos?.[FR] ?? 0);
  wheel(-halfW - 2, 0, 0);
  wheel(halfW + 2, 0, 0);
  wheel(-halfW - 1, rearY, st.servos?.[RL] ?? 0);
  wheel(halfW + 1, rearY, st.servos?.[RR] ?? 0);

  // Chassis: proper spacecraft grey, dark enough that the deck, the lens and
  // the lamps all read against it.
  ctx.fillStyle = '#2b2f36';
  ctx.strokeStyle = '#15171b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-halfW, -halfH, bw, bh, 7 * scale);
  ctx.fill();
  ctx.stroke();

  /**
   * Solar deck: deep photovoltaic blue with a cell grid and a gloss strip
   * across the top of each cell. The single biggest realism lever on the
   * body - this is the part everyone recognises from photos of the real thing.
   */
  const deckX = -halfW + 3.5 * scale;
  const deckY = -halfH + 5 * scale;
  const deckW = bw - 7 * scale;
  const deckH = bh * 0.44;
  ctx.fillStyle = '#10184a';
  ctx.beginPath();
  ctx.roundRect(deckX, deckY, deckW, deckH, 2.5 * scale);
  ctx.fill();
  ctx.strokeStyle = '#3b4cc7';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const cols = 4;
  const rows = 3;
  const cw = deckW / cols;
  const chh = deckH / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = deckX + i * cw;
      const y = deckY + j * chh;
      ctx.fillStyle = (i + j) % 2 === 0 ? '#1c2a8c' : '#2436a8';
      ctx.fillRect(x + 1, y + 1, cw - 2, chh - 2);
      ctx.fillStyle = 'rgba(120,160,255,0.18)';
      ctx.fillRect(x + 1, y + 1, cw - 2, chh * 0.4);
    }
  }

  // Front nub: a pale wedge on the nose, so the facing direction survives even
  // when the lens is hidden under a glow.
  ctx.fillStyle = '#c9ced6';
  ctx.beginPath();
  ctx.moveTo(-4 * scale, -halfH);
  ctx.lineTo(0, -halfH - 4.5 * scale);
  ctx.lineTo(4 * scale, -halfH);
  ctx.closePath();
  ctx.fill();

  // Antenna off the back corner, light mast with a hot orange tip.
  ctx.strokeStyle = '#c9ced6';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-halfW * 0.55, halfH * 0.75);
  ctx.lineTo(-halfW * 0.95, halfH + 7 * scale);
  ctx.stroke();
  ctx.fillStyle = '#ff5a3c';
  ctx.beginPath();
  ctx.arc(-halfW * 0.95, halfH + 7 * scale, 2.2 * scale, 0, Math.PI * 2);
  ctx.fill();

  /**
   * The camera turret: housing, lens ring, and a soft cyan glow that pulses
   * with the playhead. The pulse is what makes the rover read as switched on
   * and slightly alive - the fun half of "realistic but fun" - and because it
   * is driven by the playhead, scrubbing to a frame always shows that frame's
   * exact glow. Nothing on this canvas animates on its own.
   */
  const eyeY = -halfH * 0.42;
  const turretR = 5.8 * scale;
  ctx.fillStyle = '#1c2026';
  ctx.strokeStyle = '#0a0c0f';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, eyeY, turretR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#0a0c0f';
  ctx.beginPath();
  ctx.arc(0, eyeY, turretR * 0.62, 0, Math.PI * 2);
  ctx.fill();
  const pulse = 0.62 + 0.38 * Math.sin(t * 0.55);
  const lens = ctx.createRadialGradient(0, eyeY, 0, 0, eyeY, turretR * 0.48);
  lens.addColorStop(0, `rgba(120,255,255,${pulse.toFixed(3)})`);
  lens.addColorStop(1, 'rgba(0,120,160,0.25)');
  ctx.fillStyle = lens;
  ctx.beginPath();
  ctx.arc(0, eyeY, turretR * 0.48, 0, Math.PI * 2);
  ctx.fill();
  // Glint, up toward the light like every other highlight in the scene.
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(turretR * 0.16 * LIGHT.x * -1 - turretR * 0.18, eyeY - turretR * 0.2, 1.4 * scale * 0.6, 0, Math.PI * 2);
  ctx.fill();

  /**
   * The four corner lamps. The real chassis has one at each corner, in the
   * order LED_POSITIONS uses: 0 rear-left, 1 front-left, 2 front-right,
   * 3 rear-right. Drawn last so the glow sits over the chassis.
   */
  const lampR = 3.1 * scale;
  const lampPositions: [number, number][] = [
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

function drawWallHit(ctx: CanvasRenderingContext2D, L: SimLayout, st: SimPoint) {
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
export function drawSimFrame(
  ctx: CanvasRenderingContext2D,
  L: SimLayout,
  traj: SimPoint[],
  playhead: number,
  // Defaulted so any caller that has not been told about themes yet keeps the
  // original night-time yard rather than rendering colourless.
  P: SimPalette = DARK_SIM_PALETTE
) {
  // Skip degenerate layouts (container not laid out yet) to avoid drawing with
  // a zero/negative scale.
  if (L.w <= 0 || L.h <= 0 || L.s <= 0) return;
  drawTerrain(ctx, L, P);
  if (traj.length === 0) {
    drawRover(ctx, L, { x: 0, y: 0, heading: 0, servos: {} }, 0);
    return;
  }
  drawTrail(ctx, L, traj, Math.floor(playhead), P);
  const current = interpolate(traj, playhead);
  drawRover(ctx, L, current, playhead);
  if (current.hitWall) {
    drawWallHit(ctx, L, current);
  }
}

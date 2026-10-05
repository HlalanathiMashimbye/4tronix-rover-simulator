/**
 * 2D rover-simulator drawing for the live simulator panel (RoverSimulator).
 *
 * The real yard from above, north up (AB#464): the floor is a photo of it,
 * straightened and measured, with a vector overlay on top so it still reads
 * as a simulator rather than a photo, like a map. The rover is drawn, not
 * photographed, and steers its four wheels to their servo angles.
 */

import { YARD, roverToYard, type Yard } from './rover-physics';

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
  yard: Yard;
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
  /**
   * The ground is a radial wash from the centre out, and it is painted across
   * the whole canvas - there is no letterbox and no frame any more, so the
   * outer stop is also the colour at every edge. Anything sitting behind the
   * canvas has to use groundOuter to be invisible.
   */
  groundInner: string; // radial wash, centre
  groundMid: string;
  groundOuter: string;
  craterCore: string;  // crater bowl, darkest at centre
  craterMid: string;
  craterRim: string;   // faint sunlit lip
  grid: string;        // 50cm measurement lines
  vignetteTop: string; // arena edge shadow
  vignetteBottom: string;
  trail: string;       // the path the rover has driven
  /** Laid over the floor photo, so it sits in the theme instead of glaring. */
  floorShade: string;
  /** The compass mark. */
  label: string;
}

/** Mars at night: the original look, unchanged. */
export const DARK_SIM_PALETTE: SimPalette = {
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
export const LIGHT_SIM_PALETTE: SimPalette = {
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
const MARGIN = 10; // px inset so the rover never clips the panel edge

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

export function computeLayout(w: number, h: number, yard: Yard = YARD): SimLayout {
  // Clamp to >= 0: a container briefly smaller than the margins (mid-layout)
  // would otherwise yield a negative scale and an illegal gradient radius.
  const s = Math.max(0, Math.min((w - 2 * MARGIN) / yard.widthCm, (h - 2 * MARGIN) / yard.depthCm));
  return { w, h, s, ox: (w - yard.widthCm * s) / 2, oy: (h - yard.depthCm * s) / 2, yard };
}

/** Room around a cover's crop for the rover's body, which the path does not include. */
const COVER_PAD_CM = 15;

/**
 * A layout that fills the canvas edge to edge, for a mission's cover (AB#464).
 *
 * The yard is near square and a card is wide, so fitting all of it left a
 * thin column of floor between two bars of sand. A cover is a picture of
 * what the mission did, not a view anyone steers by, so it crops the yard
 * instead: scaled to fill, with the crop centred on the trail but never so
 * far that the rover, parked where it finished, leaves the card. It never
 * crops past a wall, which would bring the bars back.
 *
 * The simulator itself keeps computeLayout and the whole yard: a learner
 * driving has to see every wall.
 */
export function computeCoverLayout(w: number, h: number, traj: SimPoint[], yard: Yard = YARD): SimLayout {
  const s = Math.max(w / yard.widthCm, h / yard.depthCm);
  if (!(s > 0)) return computeLayout(w, h, yard);
  const viewW = w / s;
  const viewH = h / s;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let end: [number, number] = roverToYard(0, 0, yard);
  for (const point of traj) {
    end = roverToYard(point.x, point.y, yard);
    minX = Math.min(minX, end[0]);
    maxX = Math.max(maxX, end[0]);
    minY = Math.min(minY, end[1]);
    maxY = Math.max(maxY, end[1]);
  }
  if (traj.length === 0) [minX, maxX, minY, maxY] = [end[0], end[0], end[1], end[1]];

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  // The trail's middle, held close enough to the finish to keep it on the
  // card. A trail longer than the card loses its start, not its end.
  const centre = (lo: number, hi: number, view: number, last: number) => {
    const reach = Math.max(0, view / 2 - COVER_PAD_CM);
    return clamp((lo + hi) / 2, last - reach, last + reach);
  };
  const left = clamp(centre(minX, maxX, viewW, end[0]) - viewW / 2, 0, yard.widthCm - viewW);
  const top = clamp(centre(minY, maxY, viewH, end[1]) - viewH / 2, 0, yard.depthCm - viewH);
  return { w, h, s, ox: -left * s, oy: -top * s, yard };
}

/** A point in the yard's measured frame (cm from the west and back walls) on screen. */
function yardToScreen(L: SimLayout, x: number, y: number): [number, number] {
  return [L.ox + x * L.s, L.oy + y * L.s];
}

/** A point in the rover's frame, as the physics reports it, on screen. */
export function worldToScreen(L: SimLayout, wx: number, wy: number): [number, number] {
  const [x, y] = roverToYard(wx, wy, L.yard);
  return yardToScreen(L, x, y);
}

/** The compass bearing the rover's nose points at, from its heading in its own frame. */
function bearingOf(L: SimLayout, heading: number): number {
  return L.yard.start.facingDegrees + heading;
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

function drawTerrain(ctx: CanvasRenderingContext2D, L: SimLayout, P: SimPalette, floor: CanvasImageSource | null) {
  // The floor photo arrives after the first frames, so having it is part of
  // the key: the yard repaints once when it lands, and not again. So is where
  // the yard sits, because a cover crops it to its own mission's trail.
  const key = `${L.w}x${L.h}@${L.s.toFixed(4)}+${L.ox.toFixed(1)},${L.oy.toFixed(1)}:${P.groundInner}:${floor ? 'photo' : 'plain'}`;

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

function paintTerrain(ctx: CanvasRenderingContext2D, L: SimLayout, P: SimPalette, floor: CanvasImageSource | null) {
  const { w, h, s, yard } = L;
  const [x0, y0] = yardToScreen(L, 0, 0);
  const yw = yard.widthCm * s;
  const yh = yard.depthCm * s;

  // Beyond the walls: the panel's own colour, so the yard sits on it like a
  // map on a table. The yard is near square and the panels are not.
  ctx.fillStyle = P.groundOuter;
  ctx.fillRect(0, 0, w, h);

  if (floor) {
    ctx.drawImage(floor, x0, y0, yw, yh);
    ctx.fillStyle = P.floorShade;
    ctx.fillRect(x0, y0, yw, yh);
  } else {
    // Until the photo has loaded, or wherever there is none: plain ground.
    // Never invented craters: this is a real yard, and a mark on its floor
    // reads as something that is there.
    const ground = ctx.createRadialGradient(
      x0 + yw / 2, y0 + yh * 0.42, Math.min(yw, yh) * 0.1,
      x0 + yw / 2, y0 + yh / 2, Math.max(yw, yh) * 0.75,
    );
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
    const r = (Math.max(rock.widthCm, rock.depthCm) / 2 + 2) * s;
    ctx.beginPath();
    ctx.arc(rx, ry, r, 0, Math.PI * 2);
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
  ctx.fillText('N', x0 + yw / 2, y0 > 14 ? y0 - 7 : y0 + 9);

  // Start pad at the start spot, where every run begins.
  const [hx, hy] = worldToScreen(L, 0, 0);
  ctx.strokeStyle = 'rgba(52,211,153,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hx, hy, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(52,211,153,0.18)';
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

function drawRover(ctx: CanvasRenderingContext2D, L: SimLayout, st: SimPoint, t = 0, odo = 0) {
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
  const bearing = bearingOf(L, st.heading);
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
  const wheel = (lx: number, ly: number, angle: number) => {
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
  ] as [number, number][]) {
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
  P: SimPalette = DARK_SIM_PALETTE,
  /** The yard's floor photo, once loaded (useYardFloor). Plain ground until then. */
  floor: CanvasImageSource | null = null
) {
  // Skip degenerate layouts (container not laid out yet) to avoid drawing with
  // a zero/negative scale.
  if (L.w <= 0 || L.h <= 0 || L.s <= 0) return;
  drawTerrain(ctx, L, P, floor);
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

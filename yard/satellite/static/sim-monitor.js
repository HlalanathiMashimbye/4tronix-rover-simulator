/**
 * Simulated rover view for the monitor page.
 *
 * A yard running the FAKE rover driver has no camera and nothing to film, so
 * the monitor's camera panel sits on "Connecting to camera..." forever. This
 * fills that panel with the 2D simulator instead, driven by the same mission
 * code the rover was told to run - so a demo, a classroom without hardware, or
 * a dev laptop shows the rover moving rather than a dead placeholder.
 *
 * It draws with mission-control's own simulator, compiled to ES modules under
 * ./roversim/ (see mission-control/scripts/build-roversim.mjs). The physics and
 * the renderer are literally the same code the learner's mission page runs, so
 * the two cannot disagree about how a rover moves.
 *
 * Switching is automatic and comes from the rover itself: RoverQueueService
 * reports `hardware: false` for FakeRoverDriver, which reaches the browser via
 * /api/status. Real hardware is never affected - this module hands the canvas
 * straight back to the camera client if hardware is present.
 */

import { parseRoverCode } from './roversim/parseRoverCode.js';
import { simulateCommands } from './roversim/simulateCommands.js';
import {
  drawSimFrame,
  computeLayout,
  DARK_SIM_PALETTE,
  SIM_FPS,
} from './roversim/roverSimRender.js';

export class RoverSimView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layout = computeLayout(canvas.width, canvas.height);
    this.traj = [];
    this.playhead = 0;
    this.raf = null;
    this.lastTs = 0;
  }

  /** Parked rover on empty terrain - what an idle fake yard should look like. */
  showIdle() {
    this.stop();
    this.traj = [];
    this.playhead = 0;
    this.#draw();
  }

  /**
   * Simulate `code` and animate it once, at the rate the trajectory was
   * sampled at. Returns false if the code produced no movement, so the caller
   * can tell "nothing to show" from "playing".
   */
  play(code) {
    let traj;
    try {
      traj = simulateCommands(parseRoverCode(code || ''));
    } catch (e) {
      console.warn('[sim] could not simulate mission code:', e);
      return false;
    }
    if (!traj || traj.length <= 1) {
      this.showIdle();
      return false;
    }

    this.stop();
    this.traj = traj;
    this.playhead = 0;
    this.lastTs = 0;

    const tick = (ts) => {
      if (!this.lastTs) this.lastTs = ts;
      // Clamped because requestAnimationFrame is paused while the page is
      // hidden: a monitor that gets backgrounded and later restored resumes
      // with a multi-second (or multi-minute) gap since the last frame, and
      // an unclamped dt would jump the playhead straight to the end, skipping
      // the whole run. Capping it makes that resume look like a brief stall
      // and then continue, rather than the animation silently not happening.
      const dt = Math.min((ts - this.lastTs) / 1000, 0.25);
      this.lastTs = ts;
      // The trajectory is one sample per 1/SIM_FPS second; advancing the
      // playhead in those units keeps playback at real speed regardless of
      // the display's refresh rate.
      this.renderAt(this.playhead + dt * SIM_FPS);
      if (this.playhead < this.traj.length - 1) {
        this.raf = requestAnimationFrame(tick);
      } else {
        this.raf = null;
      }
    };
    this.raf = requestAnimationFrame(tick);
    return true;
  }

  /** Draw a specific point on the trajectory. Fractional values interpolate. */
  renderAt(playhead) {
    const end = Math.max(0, this.traj.length - 1);
    this.playhead = Math.max(0, Math.min(playhead, end));
    drawSimFrame(this.ctx, this.layout, this.traj, this.playhead, DARK_SIM_PALETTE);
  }

  stop() {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  #draw() {
    drawSimFrame(this.ctx, this.layout, this.traj, this.playhead, DARK_SIM_PALETTE);
  }
}

/**
 * Wire the sim into the monitor page if - and only if - the rover in front of
 * us is a fake one.
 *
 * `hooks` is the small surface monitor.html exposes rather than this module
 * reaching into its internals: { camera, onQueueEvent(fn), setLabel(text) }.
 */
export async function initSimIfFakeRover(hooks) {
  let isFake = false;
  try {
    const resp = await fetch('/api/status');
    if (resp.ok) {
      const data = await resp.json();
      // Explicit false only. A rover that is merely unreachable reports
      // `hardware: null`, and quietly swapping in a simulation because the
      // real rover dropped off the network would be a lie about a machine
      // that may well still be moving.
      isFake = (data.rover || {}).hardware === false;
    }
  } catch (e) {
    return null; // offline: leave the camera panel alone
  }
  if (!isFake) return null;

  const canvas = document.getElementById('cameraCanvas');
  if (!canvas) return null;

  hooks.camera?.disable?.();
  const view = new RoverSimView(canvas);
  view.showIdle();
  hooks.setLabel?.('Simulated');

  // Replay whatever the rover is running now. `current` carries the
  // dispatched instruction, and run_python's params hold the mission's
  // Python - the same string the learner submitted.
  let lastCode = null;
  let seenAnything = false;

  /** The newest run_python in the rover's history, or null. */
  function lastRunFrom(status) {
    const history = (status && status.history) || [];
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry && entry.cmd === 'run_python' && (entry.params || {}).code) {
        return entry.params.code;
      }
    }
    return null;
  }

  hooks.onQueueEvent?.((status) => {
    const cur = status && status.current;
    const code = cur && cur.cmd === 'run_python' ? (cur.params || {}).code : null;

    if (!code) {
      // Nothing running. On the FIRST snapshot this is the interesting case:
      // the page has just opened and the run it should be showing already
      // finished, so `current` is empty and this drew a parked rover on an
      // empty yard. The TV then sat like that until somebody ran the next
      // mission. Replay the last run instead - which is also what the branch
      // below has always assumed, that the last run stays on screen.
      if (!seenAnything) {
        seenAnything = true;
        const previous = lastRunFrom(status);
        if (previous) {
          lastCode = previous;
          view.play(previous);
          return;
        }
      }
      lastCode = null;
      return; // idle: leave the last run on screen rather than blanking it
    }
    seenAnything = true;
    if (code === lastCode) return; // same run still in flight
    lastCode = code;
    view.play(code);
  });

  return view;
}

/**
 * Single owner of the Blockly CDN load.
 *
 * Two things this exists to get right, both of which bit us in production:
 *
 * 1. THE MONACO CONFLICT. Monaco's loader.js installs an AMD loader, so
 *    `window.define` exists with `define.amd` truthy. Blockly ships a UMD
 *    bundle, and UMD checks for exactly that: finding it, Blockly registers
 *    as an anonymous AMD module and never assigns `window.Blockly`. The
 *    editor then renders an empty canvas - no toolbox, no blocks, no error.
 *
 *    It only shows up when Monaco loads FIRST, which is why authoring a
 *    mission normally looked fine (you land on Drive or Blocks, so Blockly
 *    wins the race) while remixing a Python-authored mission was broken:
 *    that opens ?mode=code, Monaco mounts first and claims `define`.
 *
 *    So `define` is hidden for exactly the span of Blockly's own execution,
 *    which pushes UMD down its global branch, then restored.
 *
 * 2. ONE LOAD, SHARED. BlocklyEditor and BlocklyViewer each used to inject
 *    their own <script>, so both could be in flight at once (we observed two
 *    tags for the same URL). The in-flight promise is cached here instead, so
 *    every caller waits on the same load.
 */

// Pinned deliberately. An unversioned unpkg URL resolves to whatever is
// newest, so an upstream release can break every page load with no local
// change and no warning. The yard templates pin the same version by hand -
// they have no build step to share this from.
const BLOCKLY_CDN_URL = 'https://unpkg.com/blockly@13.2.0/blockly.min.js';

declare global {
  interface Window {
    // Blockly is loaded from a CDN <script> and ships no type definitions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Blockly: any;
    // Present only when an AMD loader (Monaco's) got here first.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    define?: any;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadBlockly(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Blockly can only load in the browser'));
  }
  if (window.Blockly) return Promise.resolve(window.Blockly);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = BLOCKLY_CDN_URL;
    script.async = true;

    // See (1) above. Only touched when an AMD loader is actually present, so
    // the common case is untouched.
    const previousDefine = window.define;
    const amdPresent = !!previousDefine?.amd;
    if (amdPresent) window.define = undefined;
    const restoreDefine = () => {
      if (amdPresent) window.define = previousDefine;
    };

    script.onload = () => {
      restoreDefine();
      if (window.Blockly) {
        resolve(window.Blockly);
      } else {
        // The script ran but produced no global - almost certainly the UMD/AMD
        // path above. Fail loudly rather than leaving a blank canvas.
        loadPromise = null;
        reject(new Error('Blockly loaded but did not register a global'));
      }
    };

    script.onerror = () => {
      restoreDefine();
      script.remove();
      // Cleared so a retry can genuinely re-attempt rather than re-await a
      // promise that is already rejected.
      loadPromise = null;
      reject(new Error('Failed to fetch Blockly'));
    };

    document.body.appendChild(script);
  });

  return loadPromise;
}

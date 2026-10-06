/**
 * Single owner of loading Blockly.
 *
 * FROM OUR OWN BUNDLE, NOT A CDN. Blockly used to arrive as a <script> from
 * unpkg.com, pinned to 13.2.0, while package.json, the yard's vendored copy and
 * every test in this repo use 12.5.1. So the editor children actually used ran
 * a version nothing had been tested against, and opening the Blocks tab took
 * about 3.7s on a good connection: a new DNS lookup and TLS handshake to a
 * third party, then the whole of Blockly, before the first block appeared.
 *
 * Now it is a dynamic import of the package we already depend on. The bundler
 * splits it into its own chunk, served from our domain with an immutable
 * cache, fetched only when something asks for Blockly, and in the one version
 * the block definitions are tested against.
 *
 * It also retires the Monaco workaround this file used to carry. Monaco's
 * loader installs an AMD `define`, and Blockly's UMD <script> then registered
 * as an anonymous AMD module instead of setting window.Blockly, which rendered
 * an empty canvas. A bundled import never consults the page's `define`, so the
 * two can load in either order.
 *
 * ONE LOAD, SHARED. The editor, the read-only viewer and the background
 * prefetch all wait on the same promise.
 *
 * window.Blockly is still set, because the editor and viewer read it there.
 */

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Blockly: any;
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

  loadPromise = import('blockly')
    .then((mod) => {
      // The package's ESM entry has a default export; interop for the
      // CommonJS one puts it on the namespace instead.
      const Blockly = (mod as { default?: unknown }).default ?? mod;
      window.Blockly = Blockly;
      return Blockly;
    })
    .catch((error: unknown) => {
      // Cleared so a retry genuinely re-attempts rather than re-awaiting a
      // promise that has already rejected - the chunk can fail on a flaky
      // school connection and succeed a moment later.
      loadPromise = null;
      throw error instanceof Error ? error : new Error('Failed to load Blockly');
    });

  return loadPromise;
}

/**
 * Start loading Blockly when the browser has nothing better to do.
 *
 * Called on the mission page, which opens on the Drive tab. Most learners move
 * on to Blocks, and by then it is already here. Idle-time, so it never competes
 * with what is on screen; failures are ignored because the editor will try
 * again itself when it is opened.
 */
export function prefetchBlockly(): () => void {
  if (typeof window === 'undefined') return () => {};
  const start = () => {
    loadBlockly().catch(() => {});
  };
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(start, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(start, 1500);
  return () => clearTimeout(id);
}

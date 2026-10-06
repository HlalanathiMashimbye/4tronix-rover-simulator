/**
 * Fetch the Python editor's code, once, on the first sign it is wanted.
 *
 * CodeMirror is bundled with the app but split into its own chunk, so the
 * Drive and Blocks tabs never download it. Most learners never open Python,
 * and data they never use is a real cost on a school's mobile connection.
 * Hovering or focusing the tab is a reliable signal a click is coming, and the
 * moment before the click is enough to get the chunk moving.
 *
 * The same import() the tab itself renders from, so the bundler hands both
 * the one request rather than fetching twice.
 */
export const loadPythonEditor = () => import('@/components/mission/PythonCodeEditor');

let started = false;

/**
 * Takes no arguments on purpose: it is passed straight to onPointerEnter and
 * onFocus, which call it with the event. warmOnce is the testable core.
 */
export function prefetchPythonEditor(): void {
  warmOnce(loadPythonEditor);
}

export function warmOnce(load: () => Promise<unknown>): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  load().catch(() => {
    // The tab retries when it mounts; a failed warm-up costs nothing.
    started = false;
  });
}

import { loader } from '@monaco-editor/react';

/**
 * Start downloading the Python editor the moment a learner shows they want it.
 *
 * Monaco is about 1MB from jsDelivr and used to start downloading only once
 * the Python tab had opened, so the tab sat empty for seconds. Hovering or
 * focusing the tab is a reliable signal a click is coming, and the few hundred
 * milliseconds before the click are enough to get most of it moving.
 *
 * Not prefetched on page load like Blockly: most learners never open Python,
 * and a megabyte they never use is a real cost on a school's mobile data.
 *
 * `loader` is the same singleton the <Editor> uses, so this warms exactly the
 * instance the tab will mount rather than a second copy.
 */
let started = false;

export function prefetchMonaco(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  loader.init().catch(() => {
    // The editor retries when it mounts; a failed warm-up costs nothing.
    started = false;
  });
}

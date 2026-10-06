/**
 * Whether the learner wants sound, remembered across visits (AB#409).
 *
 * Mostly this is the REAL RUN'S VIDEO. The one sound the app makes itself -
 * the launch when finishing a challenge unlocks a level (levelUnlockSound.ts)
 * - obeys the same switch, so a learner has one place to make the product
 * quiet rather than one per noise. A learner watching a rover video in a
 * classroom, a library, or a room with thirty other children needs to be able
 * to turn it off, and needs it to stay off without being asked again on the
 * next mission they open.
 *
 * A tiny external store rather than context, for the same reason the yard
 * picker is one: it is read by components in different trees, it must survive
 * navigation, and useSyncExternalStore gives a server snapshot for free so the
 * markup does not depend on a browser API that does not exist during render.
 */

export const SOUND_STORAGE_KEY = 'mission-sound-muted';

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Cached because getSnapshot must return a stable value between renders.
 * Reading localStorage directly each call returns a fresh string comparison
 * and React would loop.
 */
let muted: boolean | null = null;

function read(): boolean {
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) === 'true';
  } catch {
    // Private browsing, or storage disabled entirely. A preference nobody can
    // save is not worth failing a page over: fall back to sound on, which is
    // what a learner gets today.
    return false;
  }
}

export function subscribeToSound(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readStoredSound(): boolean {
  if (muted === null) muted = read();
  return muted;
}

/** Sound on during render on the server, where there is no stored choice. */
export function serverSoundSnapshot(): boolean {
  return false;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, String(next));
  } catch {
    // The toggle still works for this session; it just will not be remembered.
  }
  listeners.forEach((l) => l());
}

/**
 * The launch sound played when finishing a challenge unlocks a new level.
 *
 * A real NASA launch recording rather than a synthesised effect: the point is
 * that it sounds like the thing the learner is pretending to be part of. NASA
 * audio is generally not copyrighted - see public/sounds/README.md for where
 * this clip came from, which is what lets anyone check that claim.
 *
 * Every failure is swallowed on purpose. The sound is a flourish on top of a
 * celebration overlay that already says "Level 2 unlocked!"; a browser that
 * blocks autoplay, a missing file, or a device with no audio output must
 * never turn finishing a challenge into an error.
 */

export const LEVEL_UNLOCK_SOUND_URL = '/sounds/level-unlock.mp3';

/** Below full volume: this plays in classrooms, often on several devices at once. */
const VOLUME = 0.6;

export function playLevelUnlockSound(): void {
  try {
    const audio = new Audio(LEVEL_UNLOCK_SOUND_URL);
    audio.volume = VOLUME;
    void audio.play().catch(() => {});
  } catch {
    // No Audio constructor (very old browser, or a non-browser test runner).
  }
}

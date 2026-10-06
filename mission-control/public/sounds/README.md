# Sounds

| File | Played when | Source |
|---|---|---|
| `level-unlock.mp3` | Finishing a challenge unlocks a new level (`infrastructure/browser/levelUnlockSound.ts`) | **TODO before merge:** the NASA page this clip was downloaded from, and the mission it records |

## Rules for anything added here

- **Say where it came from.** A link to the exact NASA page, so anyone can
  check the clip is what we say it is. NASA audio is generally not
  copyrighted, but NASA's media guidelines still ask that it is not used to
  imply endorsement, and some clips on NASA sites belong to third parties.
- **Keep it short and small.** A few seconds, well under 200 KB. It downloads
  on a classroom network, on every device in the room.
- **It must respect the mute.** Anything played here goes through the
  learner's sound preference (`hooks/soundPreference.ts`), the same switch that
  mutes rover videos.

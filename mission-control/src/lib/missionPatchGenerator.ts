const MISSION_PATCHES = Array.from({ length: 40 }, (_, i) => `/patches/patch${i + 1}.jpeg`);

export function getRandomMissionPatch(): string {
  return MISSION_PATCHES[Math.floor(Math.random() * MISSION_PATCHES.length)];
}

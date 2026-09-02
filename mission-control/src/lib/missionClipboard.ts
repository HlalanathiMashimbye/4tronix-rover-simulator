/**
 * What the Copy button puts on the clipboard, for every Copy button.
 *
 * There used to be two: the operator queue wrote a JSON envelope, and the
 * mission page wrote bare `mission.code`. Copying from the mission page - the
 * obvious place, since that is where you are when you are looking at a mission
 * - therefore produced a paste the run station could not identify, so the
 * mission name, the mission id and with them the run id all stayed empty. The
 * run id is the recording's filename, so those runs recorded to a file that
 * said nothing about which mission it was.
 *
 * The identity travels as Python comments rather than as JSON so that one
 * payload serves both readers: the yard parses the header, and a person who
 * pastes this into an editor gets runnable Python with a note of where it came
 * from. A JSON envelope is useless to the second reader, and bare code is
 * useless to the first.
 */
export interface CopyableMission {
  id: string;
  name?: string | null;
  code: string;
}

/** Header keys the yard's run station matches on. Changing either is a breaking change. */
const NAME_KEY = 'Mission';
const ID_KEY = 'MissionID';

export function missionClipboardText(mission: CopyableMission): string {
  // A name spanning lines would end the comment and leave the rest of it
  // sitting in the code as a syntax error, so it is flattened to one line.
  const name = (mission.name || '').replace(/\s+/g, ' ').trim();
  const header = [
    name ? `# ${NAME_KEY}: ${name}` : null,
    `# ${ID_KEY}: ${mission.id}`,
  ].filter(Boolean).join('\n');

  return `${header}\n\n${mission.code}`;
}

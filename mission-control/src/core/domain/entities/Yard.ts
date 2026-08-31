/**
 * A yard: a physical place with a rover in it.
 *
 * This was a hardcoded array. It becomes data because an admin has to be able
 * to add the next venue without a deploy, and because the list an operator
 * picks from at sign-in has to be the list of places that actually exist.
 *
 * WHAT A YARD NEEDS, and why each field is here rather than convenient:
 *
 * `id` is the rover's own name on the network. The rover answers to
 * `curiosity.local` on the yard LAN, the satellite's YARD_ID is `curiosity`,
 * and every mission carries `yardId: 'curiosity'`. One word, so somebody
 * debugging can read a tag in the console and ssh to the machine. It is never
 * shown to a learner.
 *
 * `name`, `area` and `city` are what people read. The city is the one that
 * matters: a child wants to know their program ran on a real robot in Cape
 * Town, and that sentence is what makes this bigger than a simulator.
 *
 * `formerIds` exists because missions keep the id they were submitted with.
 * The Cape Town yard has been `uct-rover-1` and `cape-town` before now, and a
 * learner opening an old mission must still see where it ran.
 *
 * `active` exists because A YARD CAN NEVER BE DELETED. Missions reference it
 * forever, so removing one orphans every mission that ran there and a child's
 * page silently loses its location. Retiring a yard means taking it out of the
 * sign-in list while it goes on resolving for everything already recorded.
 */
export interface Yard {
  id: string;
  name: string;
  area: string;
  city: string;
  formerIds?: string[];
  /** In the sign-in list. False means retired, not gone. */
  active: boolean;
  createdAt?: string;
  /** Who added it, for a list that is now editable by a person. */
  addedBy?: string;
}

/** The venue and suburb: "Cape Town Science Centre, Observatory". */
export function yardLabelOf(yard: Yard): string {
  return `${yard.name}, ${yard.area}`;
}

/**
 * Resolve an id, including one a yard used to have.
 *
 * Lenient in what is read, strict in what is written: a retired or renamed
 * yard still resolves here, while `isSelectableYard` decides what an operator
 * may pick and what a write may claim.
 */
export function findYardIn(yards: Yard[], yardId: string | undefined): Yard | undefined {
  if (!yardId) return undefined;
  return yards.find((y) => y.id === yardId || y.formerIds?.includes(yardId));
}

/** Whether an operator may sign in at this yard, or a write may name it. */
export function isSelectableYard(yards: Yard[], yardId: string): boolean {
  return yards.some((y) => y.id === yardId && y.active);
}

/** The list an operator chooses from, alphabetical by city then venue. */
export function selectableYards(yards: Yard[]): Yard[] {
  return yards
    .filter((y) => y.active)
    .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
}

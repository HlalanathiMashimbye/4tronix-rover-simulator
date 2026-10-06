/**
 * The learner's Python draft, as kept in this browser.
 *
 * Still under a Monaco-era key on purpose: renaming it would hand every
 * returning learner an empty editor (CodeMirror replaced Monaco in AB#456).
 * One home for the key because four places read or write the draft: the
 * Python editor, Show as Python, the Blocks-to-Python tab switch and a
 * mission page's Remix button.
 */
export const PYTHON_DRAFT_KEY = 'rover_monaco_code';

/**
 * The Python this page last copied into the draft from the blocks, so a tab
 * switch can tell generated code nobody has touched from a learner's own.
 */
const FROM_BLOCKS_KEY = 'rover_python_from_blocks';

/** Show the blocks as Python, replacing the draft. Asked for explicitly. */
export function showBlocksAsPython(blocklyCode: string): void {
  localStorage.setItem(PYTHON_DRAFT_KEY, blocklyCode);
  localStorage.setItem(FROM_BLOCKS_KEY, blocklyCode);
}

/**
 * Going from the Blocks tab to the Python tab: bring the blocks along, unless
 * that would destroy something the learner wrote.
 *
 * On a phone there is no Show as Python button (no room), so the tab switch
 * has to do that job. Overwriting every time would wipe hand-written code,
 * which the Python editor's own mount logic refuses to do. So only a draft
 * that is empty, or still exactly what the blocks last put there, is
 * replaced. Returns whether it was.
 */
export function carryBlocksToPython(blocklyCode: string): boolean {
  if (!blocklyCode.trim()) return false;
  const draft = localStorage.getItem(PYTHON_DRAFT_KEY);
  if (draft && draft.trim() && draft !== localStorage.getItem(FROM_BLOCKS_KEY)) return false;
  showBlocksAsPython(blocklyCode);
  return true;
}

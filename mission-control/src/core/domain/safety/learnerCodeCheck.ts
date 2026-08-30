/**
 * What the editor tells a learner while they are still writing (AB#348).
 *
 * THE RULES ALREADY EXISTED. analyzeCodeForAllowlist has known since PR #78
 * that a speed of 6300 is out of range, and it reports the line. The editor
 * simply never asked it: live validation checked seven dangerous patterns
 * (import, eval, os.) and nothing else, so a learner typing rover.forward(6300)
 * saw a clean editor and found out at submit time, in a banner, if at all.
 *
 * That is not hypothetical. Mission "Elsje" carries rover.forward(6300) to this
 * day. It passed every check, was queued, and the rover refused it. Nobody told
 * the child anything was wrong, and the operator saw a mission that never moved.
 *
 * This module is the LEARNER-FACING layer, deliberately separate from the
 * allowlist analyser rather than a change to it. That one is a security control
 * that runs server-side and must keep failing closed; this one exists to
 * teach, may be wrong in the learner's favour, and never decides whether code
 * is allowed to run.
 *
 * Messages follow the pattern already used for mission names: give the RULE,
 * not the verdict. "Speed goes from 0 to 100" tells a nine-year-old what to do
 * next. "Invalid argument" tells them they have failed at something.
 */

import { analyzeCodeForAllowlist } from '@/core/domain/safety/ast-allowlist-analyzer';
import { ROVER_COMMAND_ALLOWLIST } from '@/core/domain/safety/rover-command-allowlist';

export interface CodeProblem {
  /** 1-based, so it can go straight to a Monaco marker. */
  line: number;
  message: string;
}

/** Levenshtein, small and local: the only use is ranking a handful of names. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

/**
 * The closest real command to something a learner typed, if it is close enough
 * to be a typo rather than a different idea entirely.
 */
export function closestCommand(name: string): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;

  for (const command of ROVER_COMMAND_ALLOWLIST) {
    const distance = editDistance(name.toLowerCase(), command.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = command;
    }
  }

  // Three edits is about where "typo" stops and "different word" begins.
  // Suggesting rover.forward for someone who typed rover.jump would be worse
  // than saying nothing.
  return bestDistance <= 3 ? best : null;
}

/**
 * Brackets and quotes that never close.
 *
 * The card is right that there is no syntax checking, and right about why: the
 * analyser is regex over lines rather than a parser. A real Python parser in
 * the browser means shipping Pyodide or Skulpt, which is megabytes for a page
 * children open on venue wifi.
 *
 * So this checks the two mistakes that actually happen, rather than pretending
 * to be a parser. A missing bracket and an unclosed quote are most of what goes
 * wrong when a nine-year-old types a line of Python, and both are invisible in
 * an editor that only looks for the word "import".
 *
 * Strings are walked character by character so a bracket inside quotes does not
 * count, which is the thing a naive counter gets wrong.
 */
export function findSyntaxProblems(code: string): CodeProblem[] {
  const problems: CodeProblem[] = [];
  const stack: Array<{ char: string; line: number }> = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

  code.split('\n').forEach((rawLine, index) => {
    const line = index + 1;
    let quote: string | null = null;

    for (let i = 0; i < rawLine.length; i++) {
      const char = rawLine[i];

      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      // Everything after # is a comment, brackets included.
      if (char === '#') break;

      if (char === '(' || char === '[' || char === '{') {
        stack.push({ char, line });
      } else if (char in pairs) {
        const open = stack.pop();
        if (!open || open.char !== pairs[char]) {
          problems.push({
            line,
            message: `There is a closing ${char} here with nothing to close. Check the brackets on this line.`,
          });
        }
      }
    }

    if (quote) {
      problems.push({
        line,
        message: `This line opens a quote (${quote}) but never closes it. Every quote needs a partner.`,
      });
    }
  });

  for (const unclosed of stack) {
    problems.push({
      line: unclosed.line,
      message: `This ${unclosed.char} is never closed. Add the matching ${
        unclosed.char === '(' ? ')' : unclosed.char === '[' ? ']' : '}'
      }.`,
    });
  }

  return problems;
}

/** Turn an analyser finding into something a child can act on. */
function humanise(finding: { ruleId: string; message: string }): string {
  if (finding.ruleId === 'argument-out-of-range') {
    // "rover.forward() takes a speed between 0 and 100, but got 6300"
    const match = finding.message.match(/^(\S+)\(\) takes a (\w+) between (\S+) and (\S+), but got (\S+)/);
    if (match) {
      const [, command, label, min, max, got] = match;
      return `${got} is too big for ${label}. ${command}() goes from ${min} to ${max}, so try ${command}(${max}).`;
    }
  }

  if (finding.ruleId === 'disallowed-function') {
    const match = finding.message.match(/^Function '([^']+)'/);
    if (match) {
      const typed = match[1];
      const suggestion = closestCommand(typed);
      // The original message lists all nineteen allowed commands in one line,
      // which is a wall of text rather than an answer.
      return suggestion
        ? `There is no command called ${typed}. Did you mean ${suggestion}?`
        : `There is no command called ${typed}. Check the blocks palette for the commands the rover knows.`;
    }
  }

  return finding.message;
}

/**
 * Everything worth telling the learner about this code, newest problem first
 * by line.
 *
 * Syntax comes before the allowlist deliberately: a line with an unclosed
 * bracket will also confuse the pattern matcher, and telling somebody their
 * command does not exist when the real problem is a missing bracket sends them
 * looking in the wrong place.
 */
export function checkLearnerCode(code: string): CodeProblem[] {
  const syntax = findSyntaxProblems(code);
  const brokenLines = new Set(syntax.map((p) => p.line));

  const allowlist = analyzeCodeForAllowlist(code)
    .filter((finding) => finding.line !== undefined && !brokenLines.has(finding.line))
    .map((finding) => ({ line: finding.line as number, message: humanise(finding) }));

  return [...syntax, ...allowlist].sort((a, b) => a.line - b.line);
}

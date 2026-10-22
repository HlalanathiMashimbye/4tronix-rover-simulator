/**
 * The feedback message bank (AB#471), held to the rules a reviewer of it
 * would check - the same standing as the mission-name word lists.
 *
 * Every message reaches a child under an operator's name. These run over the
 * whole bank, so a message added later is held to them without anyone
 * remembering to write a test for it.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  FEEDBACK_MESSAGES,
  THING_PLACEHOLDER,
  allFeedbackMessages,
  fillFeedbackMessage,
  suggestFeedbackOutcome,
  type FeedbackOutcome,
} from '@/core/domain/services/feedbackMessages';

const SRC = join(__dirname, '..', '..');

describe('the feedback bank (AB#471)', () => {
  it('has at least 15 messages, grouped by outcome', () => {
    expect(allFeedbackMessages().length).toBeGreaterThanOrEqual(15);
    for (const outcome of Object.keys(FEEDBACK_MESSAGES) as FeedbackOutcome[]) {
      // Varied within a group too: one message per outcome would be a stamp.
      expect(FEEDBACK_MESSAGES[outcome].length).toBeGreaterThanOrEqual(4);
    }
  });

  it('has no message twice', () => {
    const all = allFeedbackMessages();
    expect(new Set(all).size).toBe(all.length);
  });

  it('fits every message, filled in, in the one line the learner page gives a note', () => {
    // OperatorFeedback shows a note on one truncated line; 120 characters is
    // what that line holds on a laptop. Well inside the API's 280 cap.
    for (const template of allFeedbackMessages()) {
      for (const crash of [{ into: 'wall' as const }, { into: 'rock' as const }, null]) {
        expect(fillFeedbackMessage(template, crash).length).toBeLessThanOrEqual(120);
      }
    }
  });

  it('names what was hit in every crash message, and only there', () => {
    for (const template of FEEDBACK_MESSAGES.crash) expect(template).toContain(THING_PLACEHOLDER);
    for (const template of [...FEEDBACK_MESSAGES.success, ...FEEDBACK_MESSAGES.stopped]) {
      expect(template).not.toMatch(/\{\w+\}/);
    }
  });

  it('never sends a placeholder', () => {
    for (const template of allFeedbackMessages()) {
      for (const crash of [{ into: 'wall' as const }, { into: 'rock' as const }, null]) {
        expect(fillFeedbackMessage(template, crash)).not.toMatch(/[{}]/);
      }
    }
  });

  it('says what the rover hit in words a child uses', () => {
    const template = FEEDBACK_MESSAGES.crash[0];
    expect(fillFeedbackMessage(template, { into: 'wall' })).toContain('the wall');
    expect(fillFeedbackMessage(template, { into: 'rock' })).toContain('a rock');
  });
});

describe('the suggested group', () => {
  it('is the crash group when the preview hits something, whatever the status', () => {
    expect(suggestFeedbackOutcome('completed', { into: 'rock' })).toBe('crash');
    expect(suggestFeedbackOutcome('failed', { into: 'wall' })).toBe('crash');
  });

  it('is the stopped group for a run that did not finish', () => {
    expect(suggestFeedbackOutcome('failed', null)).toBe('stopped');
    expect(suggestFeedbackOutcome('cancelled', null)).toBe('stopped');
  });

  it('is the success group for a clean, completed run', () => {
    expect(suggestFeedbackOutcome('completed', null)).toBe('success');
  });
});

describe('the bank lives in one place', () => {
  it('no other source file carries a copy of a message', () => {
    /**
     * "Messages live in one place" (AB#471). A second copy - pasted into a
     * component as a placeholder, say - is a message that escaped review and
     * will drift from the reviewed one. Asserted over the files, because no
     * behavioural test notices a copy that happens to say the same thing.
     */
    const home = join(SRC, 'core', 'domain', 'services', 'feedbackMessages.ts');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__' && name !== 'node_modules') walk(path);
        } else if (/\.(ts|tsx)$/.test(name) && path !== home) {
          files.push(path);
        }
      }
    };
    walk(SRC);

    const copies = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      // The first 40 characters are distinctive enough to be a copy.
      return allFeedbackMessages().some((message) => text.includes(message.slice(0, 40)));
    });
    expect(copies.map((file) => relative(SRC, file))).toEqual([]);
  });
});

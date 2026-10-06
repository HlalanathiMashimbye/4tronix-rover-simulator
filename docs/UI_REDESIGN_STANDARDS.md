# UI/UX Redesign Standards & Educational Frameworks

**Scope:** the learner-facing Progressive Challenges surface of Mission Control
(`/challenges` and `/challenges/[challengeId]`). The rest of the platform (mission
feed, Create Mission, operator console) is unchanged.

## 1. Executive Summary

The Challenges surface was styled like the rest of Mission Control: a dark
navy theme designed for a developer console, with small text, thin buttons,
and a vertical list of challenges that looked the same whether a challenge was
done, open or locked. That suits the operator console. It does not suit the
platform's main audience, young learners taking their first steps in
programming.

The redesign borrows patterns that platforms for young learners have already
tested at scale:

| Pattern | Borrowed from | What it does here |
|---|---|---|
| A path of nodes, one highlighted as "do this next" | Duolingo's learning path | The challenges hub is a **mission map** |
| Bright, saturated block colours on a calm canvas | Scratch | The palette (Scratch Blue `#4C97FF`, orange `#FFAB19`, green `#10B981`) |
| Large, rounded, physically "pressable" controls | Duolingo, YouTube Kids | 3D pill buttons with a 44px minimum target |
| A short goal screen before the activity | Duolingo lesson start | A **Mission Goals** briefing with a single "Start Mission" action |

The change is limited to presentation. Challenge content, progress tracking,
unlocking rules and the checks that grade each step are the same code as
before. That means the redesign can be judged on its own, without also
changing what is being taught.

### What was built

| Change | Where |
|---|---|
| A scoped palette and rounded reading face (Nunito body, Fredoka headings, line-height 1.6) | `mission-control/src/app/globals.css`, `app/challenges/layout.tsx`, `app/layout.tsx` |
| Tactile pill buttons with a 4px lip (`border-b-4`) that compresses on press, minimum 44 × 44px | `components/challenges/pill.ts` |
| The mission map: one coloured zone per level and a node per challenge, in four states (done ★, up next (glowing), ready, locked) | `components/challenges/ChallengesHub.tsx` |
| The Mission Goals briefing before each challenge, with Start Mission | `components/challenges/ChallengeBriefing.tsx` |
| A collapsed "Teacher & Standards Info" panel on that briefing | `components/challenges/ChallengeBriefing.tsx` |
| Step progress as dots, plus a checklist of the step's checks shown on the panel (previously hidden behind an icon) | `components/challenges/ChallengeInstructionsPanel.tsx` |

### What was not built, and is not claimed

The brief this redesign answers also mentioned **mascot-driven prompt
overlays** and **purpose-built drag-and-drop targets**. Neither exists. The
only drag-and-drop on this surface is the Blockly editor, which is unchanged,
and its toolbox text is still 11px. Both are listed as future work in
section 4 rather than credited here.

## 2. Underpinning Standards & Frameworks

### A. Universal Design for Learning (UDL)

UDL (CAST, *UDL Guidelines 3.0*, 2024) asks designers to provide multiple
means of engagement, representation, and action and expression.

**Multiple means of engagement.**
- The mission map makes progress visible: completed challenges become
  stars, and a progress bar counts them.
- Exactly one node glows at a time, the first unfinished challenge in track
  order. A learner never has to choose where to start.
- During a challenge, each step's checks are shown as a checklist that ticks
  green live as the learner works. Previously the checklist was behind an
  icon button. That was the one piece of feedback telling a child what Next
  was waiting for, and it took a tap to see.

**Multiple means of representation.**
- Status is shown three ways at once: colour, icon (star, play, lock) and
  word ("Done", "Up next", "Ready", "Locked"). Colour is never the only
  signal, as WCAG 1.4.1 requires.
- Step progress is shown as a row of dots, with "Step 2 of 4" kept for
  screen readers.
- Each level is its own colour zone (orange, then blue, then green), so a
  zone can be recognised before it is read.

**Multiple means of action & expression.**
- Every control on the surface meets a 44px minimum touch target.
- Learners can still work in either blocks (Level 2) or typed Python
  (Level 3), and can view their blocks as Python. That choice existed before
  the redesign; it is restated here because it is the main UDL action and
  expression provision.

### B. ISO/IEC 24751 (AccessForAll)

ISO/IEC 24751 ("Individualized adaptability and accessibility in e-learning,
education and training") is a metadata framework. It describes a learner's
access needs and preferences, and the properties of a resource, so that a
system can **match resources to the individual**. It does not prescribe a
visual design or cognitive-load rules.

This redesign does **not** implement 24751. There is no learner preference
profile and no resource metadata. The relevant AccessForAll *principle* it
follows is separating content for different audiences, so that each sees
what they need:

- **Teacher information is separated from learner information.** The
  briefing's "Teacher & Standards Info" panel is a native `<details>`
  element: closed by default, keyboard-operable, and announced correctly by
  screen readers without extra scripting. It lists the level, the editor
  used, the points awarded, and exactly what the platform checks at each
  step. The check wording comes from the same function that labels the
  learner's checklist, so the two cannot disagree.
- **One primary action per screen.** The briefing has one large button,
  "Start Mission". The map has one glowing node.

Implementing actual 24751 matching, for example a learner profile that
switches text size or turns off animation, is listed as future work.

> **On curriculum codes.** The panel currently says that standards are not
> mapped. The challenges once carried CAPS and CSTA codes, which were removed
> because nobody on the team could vouch for the mapping
> (`infrastructure/config/challenges.ts`, and a test in
> `challengeContent.test.ts`). Tucking an unverified claim into a teacher
> panel does not verify it: a teacher is the reader most likely to check.
> Separate work (AB#444) adds learning outcomes with CSTA's own wording
> behind a "For teachers" disclosure. When it is merged, this panel is where
> those codes belong.

### C. WCAG 2.2, Level AA

The brief cited "WCAG 2.1 Level AA, SC 2.5.5 / 2.5.8" and "SC 1.4.3 / 1.4.12
for rounded typography". Three of those citations need correcting, and the
corrected versions are what this redesign is built against:

| Criterion | What it actually requires | What this redesign does |
|---|---|---|
| **2.5.8 Target Size (Minimum)**, AA, *new in WCAG 2.2* (not in 2.1) | Targets at least **24 × 24px**, or enough spacing | Exceeded |
| **2.5.5 Target Size (Enhanced)**, **AAA** (not AA) | Targets at least **44 × 44px** | Met for every button, link and toggle on the surface (`min-h-11 min-w-11`). The 44px figure is also Apple's HIG minimum, and motor control is still developing at primary-school age, so the AAA target was chosen deliberately. |
| **1.4.3 Contrast (Minimum)**, AA | Text at least **4.5:1** (3:1 for large text) | Met, see below |
| **1.4.11 Non-text Contrast**, AA | UI component boundaries at least 3:1 | Every button has a filled face plus a darker lip |
| **1.4.12 Text Spacing**, AA | Content survives a *user* increasing line, letter, word and paragraph spacing | No fixed-height text containers were added. This criterion is about user overrides, not font choice; it is **not** a requirement for rounded typefaces. |
| **1.4.1 Use of Colour**, A | Colour is not the only way information is conveyed | Every node and checklist state also carries an icon and a word |
| **2.3.3 Animation from Interactions**, AAA | Motion can be disabled | The glowing node's animation stops under `prefers-reduced-motion` |

There is no WCAG criterion for rounded typefaces. The choice of Nunito and
Fredoka rests on legibility for early readers: open counters,
rounded terminals and a generous x-height. It is a design judgement,
not a compliance claim.

**Contrast in detail.** The brand colours as given **fail** with white text:

| Fill | White text | Ink text (`#14213D`) |
|---|---|---|
| Scratch Blue `#4C97FF` | 2.93:1 ✗ | 5.46:1 ✓ |
| Orange `#FFAB19` | 1.89:1 ✗ | 8.44:1 ✓ |
| Green `#10B981` | 2.54:1 ✗ | 6.30:1 ✓ |

So text on a coloured fill is always dark ink, never white. Scratch itself
uses white on `#4C97FF`, which is one place this design deliberately departs
from its inspiration. When the colours are used as text on the light theme's
white panel, they are deepened (blue `#1F5FCC` 5.89:1, orange `#A35C00`
5.14:1, green `#047857` 5.48:1). On the dark panel, the vivid fills already
clear 4.5:1.

**These figures are enforced, not just recorded.**
`mission-control/src/__tests__/unit/kidPalette.test.ts` reads the hex values
from `globals.css` and recomputes every pair. A future "brighter" palette that
drops any pair under 4.5:1 fails the build.

## 3. Mapping Matrix: Developer Console UI vs. K-12 Gamified UI

| Component | Before | After | Usability benefit | Basis |
|---|---|---|---|---|
| Palette | Dark navy, or monochrome "Paper & Ink" in light mode; one orange accent | Scratch-derived blue, orange and green on dark-space or white panels; dark ink on every fill | Colour carries meaning (level zone, state) and every pair clears 4.5:1 | WCAG 1.4.3, 1.4.1 |
| Body typeface | Inter at 12–14px | Nunito at 16px, line-height 1.6; Fredoka headings | Rounded, open letterforms; more room between lines for early readers | Legibility (design judgement) |
| Buttons | Thin rectangles, about 32px tall, 12px text | Full-round pills, ≥44px tall, 14–18px text, 4px pressable lip | Bigger targets; the press is visible, so the button gives feedback | WCAG 2.5.5 (AAA), 2.5.8 (AA) |
| Challenges hub | One card per level holding near-identical rows (title, summary, Start chip) | Mission map: colour-coded zones, round nodes on a path, one glowing "Up next" | Answers "what do I do now?" at a glance; locked nodes are visibly not buttons | UDL engagement; Duolingo path |
| Progress | Thin 8px bar, "3/6 complete" | Star count and a 16px bar, exposed as an ARIA progressbar | Concrete reward; readable by assistive technology | UDL engagement |
| Before a challenge | Dropped straight into the workspace | Mission Goals briefing: one goal per step, each with a check icon, and one "Start Mission" button | Learner knows the shape of the task before starting | UDL representation |
| Teacher metadata | Previously CAPS/CSTA pills on the learner's panel (later removed) | Collapsed "Teacher & Standards Info" panel on the briefing | Out of the child's way; one tap for the teacher | AccessForAll principle |
| Step progress | "STEP 2 OF 4" caption | Dot row (done green, current blue), text kept for screen readers | Chunked, visual, countable | UDL representation |
| Step checks | Hidden in a popover behind an icon with no accessible name | Shown on the panel as a checklist that ticks green live | Immediate feedback; fixes an unlabelled button | UDL engagement; WCAG 4.1.2 |
| Hints | Shared a popover with the checks | Own labelled "Hint" pill, shown only when the step has hints | Help is asked for, not imposed | UDL action & expression |
| Animation | n/a | Gentle glow on one node, off under reduced motion | Draws the eye once without pulling at it all session | WCAG 2.3.3 |

## 4. Limitations and future work

- **Not yet tested with learners.** The design is grounded in published
  standards and in platforms that have themselves been user-tested, but not
  in sessions with this platform's own audience. A short think-aloud study
  with a handful of learners in the target age range is the obvious next step.
- **The Blockly editor is unchanged.** Its toolbox labels are still 11px. Its
  colours and sizes are Blockly's own and are themed separately.
- **No mascot or character guide** has been built.
- **No ISO/IEC 24751 preference matching:** no per-learner text size,
  contrast or motion profile.
- **Curriculum mapping** awaits the AB#444 work described in section 2B.

## References

- CAST (2024). *Universal Design for Learning Guidelines version 3.0.* <https://udlguidelines.cast.org>
- ISO/IEC 24751-1:2008. *Information technology – Individualized adaptability and accessibility in e-learning, education and training – Part 1: Framework and reference model.*
- W3C (2023). *Web Content Accessibility Guidelines (WCAG) 2.2.* <https://www.w3.org/TR/WCAG22/>
- W3C. *Understanding SC 2.5.8 Target Size (Minimum)* and *Understanding SC 2.5.5 Target Size (Enhanced).*
- Resnick, M. et al. (2009). "Scratch: Programming for All." *Communications of the ACM*, 52(11), 60–67.

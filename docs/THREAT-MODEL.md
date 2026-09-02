# Threat model: unsafe or unintended communication

**Story AB#402.** Raised by the marker because of how young the users are.

This document is about one question: **what can a child put in front of a
stranger, and what can a stranger put in front of a child?** It is not a
general security review. Where something is not covered, it says so.

---

## Why there is a channel at all

Mission documents are **world-readable by design**. The discovery feed is meant
to be shared, and learners are never signed in, so `firestore.rules` allows
`get, list` on `missions/{id}` to anybody.

That is the right call for the product and it means every learner-controlled
field on a mission document is a potential broadcast. There is no
authentication to hide behind: if a child can write it, the internet can read
it.

---

## What a learner controls, and what stops it

| Field | Learner controls | Public | Control |
|---|---|---|---|
| `name` | re-roll only | yes, prominently | **Closed vocabulary**, enforced in the API schema |
| `code` | freely | yes | Allowlist + range checks. **Free text survives** (see gaps) |
| `blocklyState` | freely | yes | Structure only; block fields are numbers and dropdowns |
| `sessionId` | no (minted) | yes | Format-checked to `nanoid`'s alphabet |
| `learnerId` | no (minted) | **no** | Hashed to `learnerRef` before storage |
| `learnerEmail` | yes | **no** | Hashed to `learnerEmailHash`; address lives in a subcollection browsers cannot read |
| `yardId` | picks from a list | yes | Must be a known yard |

### The name is a closed vocabulary, not a filter

`isGeneratedMissionName` accepts exactly two words from two reviewed lists,
separated by one space. Anything else is refused by the API.

A blocklist of rude words was rejected deliberately. A blocklist is an endless
argument with the person trying to get past it, and it loses to spacing, accents
and misspelling. A list of permitted pairings has nothing to argue with.

**Adding a word to those lists adds it to what a child may publish.** Treat
`missionNameGenerator.ts` as reviewed content, not as configuration.

### Why the API and not the input box

The name input has been read-only in the browser for some time. That stopped
nobody: the API took any string up to 100 characters, so a single `curl` put
arbitrary text on a public document. **47 of the first 400 missions carry names
the generator could never have produced**, including one deliberately
inappropriate entry that reached an operator's queue during an event.

A control that lives only in the browser is a suggestion.

### No learner identity on a public document

`learnerId` is hashed to `learnerRef` before it is stored. Email addresses are
hashed to `learnerEmailHash` and the plaintext lives in a `learners`
subcollection whose rules deny browser reads, after an earlier hole where
addresses could be recovered by collecting ids from the public feed.

The operator queue deliberately shows **no** learner field at all, not even the
one-way hash. The mission name is the handle an operator uses, and it identifies
nobody.

### Operator feedback IS free text, and that is a deliberate exception

An operator can write a short note back to the learner on a run: "Good job!",
or "the turn was too small, try 90 degrees for a square". That text lands on a
run document, and run documents are world-readable by design.

This is the one place free text reaches a public document, and it is worth
being explicit that it contradicts the rule above rather than pretending it
fits. What makes it a different risk from a learner-typed mission name:

- **The author is different.** Writing it requires an authenticated Firebase
  account carrying an `operator` or `admin` claim. It is not reachable by an
  anonymous child, or by anyone who has not been granted a role by an admin.
- **The path is different.** Firestore rules deny every browser write to a run
  (`allow write: if false`). Feedback goes through
  `POST /api/operator/missions/[id]`, which verifies the session cookie server
  side before the Admin SDK touches anything.
- **It is bounded.** 280 characters, enforced by the Zod schema at the
  boundary rather than by the input's `maxLength`, which is only a hint.
- **It is attributed.** The operator's email is stored alongside it and shown
  to the learner, so a note is never anonymous.

What this does NOT do is moderate the content. An operator who wants to write
something inappropriate to a child can. The control is that operators are
known adults who were granted access deliberately, the same trust already
required to dispatch a rover at a child or delete their work. If that trust
model changes, this is one of the things to revisit.

---

## What this does NOT cover

Listed plainly, because a threat model that only lists wins is marketing.

### 1. Mission code is still free text

`code` is a program a child writes, and it is displayed on the public mission
page and in the operator console. Two channels survive inside it:

- **Comments.** `# anything at all` is ignored by the allowlist analyser by
  design, because comments are how AB#413 teaches.
- **String literals.** `print()` is allowed for learning, so
  `print('anything at all')` reaches a public document.

This is **not fixed**, and the reason is that fixing it properly means
forbidding a child from writing comments or printing messages, which is most of
what makes the editor teachable.

What reduces it in practice: every mission passes through an operator queue
where a human sees the code before the rover runs it, and an operator can cancel
or delete. That is a **human control, not a technical one**, and it does nothing
about a mission that is submitted and read by a stranger before any operator
looks at it.

### 2. The feed is public and unmoderated at write time

Anyone can read every mission the moment it is created. There is no approval
step between submission and publication.

### 3. Nothing rate-limits submissions

A script can create missions as fast as it can post. Nothing here addresses
flooding the feed.

### 4. Blockly state is trusted structurally

`blocklyState` is stored as submitted. Its fields are numbers and dropdowns
rather than text, so it is a poor channel, but it is not parsed or validated
server-side.

### 5. This says nothing about the yard

Operator authentication, arming and the satellite are covered elsewhere. This
document is only about what appears on public learner-facing documents.

---

## If you change something here

- Adding a word to the name lists **widens what a child can publish**.
- Adding a learner-controlled field to a mission document adds a channel. Ask
  whether it is displayed, and whether it can be a closed set instead of a
  string.
- Relaxing the `code` allowlist to permit new builtins may add a way to get text
  onto the page. `print` already is one.

Tests live in `src/__tests__/unit/publicDocumentSafety.test.ts` and are written
around the real names that reached production, so a regression fails loudly.

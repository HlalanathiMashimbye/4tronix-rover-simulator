# Prototypes: challenges, leaderboard, recovery codes and avatars

> **These are prototypes, not the product. Do not open a PR that brings any of
> them into `main`.** If you have just picked this repository up: the work
> that matters is the core loop, a learner somewhere sending a mission and
> getting a video of the real rover back, with nobody from the team nudging it
> along. Start there, not here.

`main` has none of these. They live on branches, kept mergeable so they can
be shown, not so they can be shipped:

| Branch | What is on it |
|---|---|
| `feat/challenges` | Progressive Challenges (five levels, CAPS and CSTA standards), the leaderboard, the avatar picker and learner profile, recovery codes |
| `feat/Recovery_Code` | an earlier cut of the recovery code on its own |

## Why

David (the sponsor) does not want them in the product, and said why at the
8 October 2026 standup:

- **The system is mission-centred on purpose.** A mission has a name and a
  badge; a person has no account. Profiles, avatars, progress and a
  leaderboard bring learner accounts back in, which is the problem the design
  set out to sidestep.
- **A mission's name is its recovery code.** Type the three words and you are
  back. A second code is another mechanism to maintain and to break, so the
  fix is that no two missions may share a name.
- **A learning pathway needs real pedagogy.** Which step comes first, and how
  many tries it takes to click, is research - he suggested it as an honours
  or masters project - not something to guess and ship. What fits the product
  now is creative and open: predict, run, modify, make your own (PRIMM).

The lecturers asked to see learning objectives and progression, so the
prototypes show what that could look like. Both asks are reasonable, and
they cannot both be true of one deployed site, so the prototypes are branches
you switch to for a demonstration and switch away from afterwards. Label them
as prototypes wherever they are shown.

The alternatives were considered and rejected:

- **A feature flag.** The dead code stays in `main` either way, which is the
  thing the Separation of Concerns mark was docked for, and a flag that is off
  in every environment is untested code pretending to be tested code.
- **A second deployment.** It needs Terraform, and therefore needs Werner, for
  something that is only ever shown from a laptop in a room.

## What is on which branch

`main` keeps two things and only two things:

```ts
// core/domain/entities/Mission.ts, and the matching DTO and zod schema
origin?: 'challenge';
challengeId?: string;
```

They are carried, validated and persisted on `main`, and nothing on `main` ever
sets or displays them. That is deliberate for two reasons. A mission written on
`feat/challenges` round-trips through `main` unchanged, so the two branches
never corrupt each other's data. And `Mission.ts`, `dto/mission.ts` and
`schemas.ts` are files `main` edits often, so leaving these fields in place
keeps them out of every rebase.

`firestore.rules` also keeps its `leaderboardEntries` block on `main`, for a
sharper reason: rules deploy from `main` for every environment. If that block
only existed on the branch, switching would need a rules deploy as well as an
app deploy, and "switch instantly" would quietly stop being true.

`firestore.indexes.json` keeps the two `leaderboardEntries` composite indexes
on `main` for the same reason. The public leaderboard (`optedIn` equality,
ordered by `score`, `displayName`, id) and a learner's rank (`optedIn`
equality, `score` range) both need one, and without them both queries fail in
a real project with "The query requires an index". The Firestore emulator does
not enforce composite indexes, which is why the feature works locally without
them. Deploy them separately from the app:

```bash
firebase deploy --only firestore:indexes --project bt-impact-academy
```

Answer **No** if it offers to delete indexes that are not in the file, and
never pass `--force`, which deletes them without asking. The account needs
permission to manage Firestore indexes on the project (for example
`roles/datastore.indexAdmin`); an account that cannot run
`firebase firestore:indexes` cannot deploy them either.

`feat/challenges` carries the other 42 files: the pages, the API routes, the
components, the domain entities and services, the repositories, the hooks, the
config and the tests.

## Switching

```bash
git checkout feat/challenges     # challenges and leaderboard present
git checkout main                # neither
```

`ci.yml` runs on both branches, so the branch cannot silently rot. Staging
deploys from `main` only, on purpose: `deploy-staging.yml` is not to be given a
second branch, or the thing David asked for stops holding.

## The shape of the branch, and why it matters

`feat/challenges` is **`main` plus exactly one commit**, and that commit is a
revert of the removal. Check it before trusting a rebase:

```bash
git log --oneline feat/challenges ^main   # must print exactly one line
```

If that prints nothing, the branch is a bare pointer at some commit `main` has
already absorbed, and **`git rebase main` will fast-forward it straight to
`main` and delete the feature** - no conflict, no warning, nothing to notice.
That is how the branch was first cut, and it was corrected rather than
discovered the hard way. Rebuild it like this:

```bash
git checkout -B feat/challenges origin/main
git revert --no-commit <the commit that removed the feature>
# three files belong on BOTH branches - keep main's copies, not the revert's
git checkout origin/main -- .github/workflows/ci.yml docs/challenges-branch.md firestore.rules
git add -A && git commit
git push --force-with-lease
```

**That third line is not optional**, and a plain `git revert` without it is
wrong in a way that bites later. The revert drags back three files that are not
part of the feature:

| File | What a plain revert does to it |
|---|---|
| `.github/workflows/ci.yml` | removes `feat/challenges` from the triggers, so the commit meant to keep the branch alive is the one that stops it being tested |
| `docs/challenges-branch.md` | deletes this document, which is what made the first rebase conflict |
| `firestore.rules` | reverts a comment on a block that is byte-identical on both branches, buying a permanent conflict for nothing |

## Keeping the branch alive

Rebase it on `main` whenever `main` moves:

```bash
git checkout feat/challenges && git rebase main && git push --force-with-lease
```

`git log --oneline feat/challenges ^main` should still print one line
afterwards. The branch is green on its own: 86 suites and 804 tests, against
`main`'s 76 and 727.

Nearly all of it is files that exist only on the branch, so they cannot
conflict. Six files are edits to code `main` also owns, and those are where a
conflict will appear:

| File | What the branch adds back |
|---|---|
| `components/layout/Navbar.tsx` | the Challenges and Leaderboard entries, the progress badge, the mobile tab |
| `components/mission/MissionWorkspace.tsx` | the "Finish & Export" handoff, and `origin` on submission |
| `components/mission/BlocklyEditor.tsx` | exports the workspace storage key so a handoff can seed it |
| `components/mission-feed/MissionFeed.tsx` | the `onLoadMore` / `onFeedState` props Challenge 1 observes |
| `components/MissionCard/MissionCard.tsx` | the CHALLENGE SOLUTION badge |
| `app/layout.tsx`, `infrastructure/container.*.ts` | `MilestoneTracker`, and the DI wiring |

If a rebase gets ugly, it will be in that list, and nowhere else.

## The mobile tab bar

`feat/challenges` changes the mobile bottom bar. On `main` the row is Home,
History and Alerts; on the branch it is Home, Challenges, History and
Leaderboard, and the bell moves up to the top bar to make room. The row is read
from `NAV_ITEMS`, so every destination the laptop bar has is on the phone too.
Create Mission is the floating button below the row on both, and is not one of
the slots.

Three slots is a normal tab bar and needs no decision. Noted only so the count
changing between branches is expected rather than alarming.

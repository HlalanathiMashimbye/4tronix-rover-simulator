# Progressive Challenges and the leaderboard live on a branch

`main` has no challenges and no leaderboard. The whole feature lives on
`feat/challenges`, which is a real branch kept mergeable, not an archive.

## Why

David does not want the challenges in the product. The lecturers do want to see
them working. Both are reasonable and they cannot both be true of one deployed
site, so the feature is a branch you switch to for a demonstration and switch
away from afterwards.

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

## Keeping the branch alive

Rebase it on `main` whenever `main` moves:

```bash
git checkout feat/challenges && git rebase main && git push --force-with-lease
```

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

## One consequence to know about

With the Challenges tab gone, `main`'s mobile bottom bar is down to two
destinations, Home and My History. It is not broken, but a two-item tab bar is
a thin row and somebody should decide whether it still earns being a tab bar at
all. That decision belongs to `main`, not to this branch.

# Handing the repo over to David's upstream

At handoff this repository merges into David's upstream,
`coderlevelup/4tronix-rover-simulator`, and every account that runs it becomes
David's. This is the list of what that merge does not carry across.

A merge moves code, history and any branch that is pushed. It does not move
anything stored in the repo's settings: Actions variables, environments,
branch rules, collaborators, open pull requests. Nor does it move the one piece
of trust that lives outside GitHub entirely, which is Google Cloud's rule about
which repo may deploy. Everything below is one of those.

Checked against both repos on 25 Sep 2026; commits, branches, open PRs and
collaborators rechecked on 5 Oct 2026. The Actions variables were not
rechecked, because reading them needs admin. Re-check anything marked with a
count before relying on it, because the fork keeps moving.

## Before the merge

- [x] **Bring in upstream's three commits.** Done on 5 Oct 2026: MacBook
      satellite mode, the `mac-env/` ignore and the CHANGELOG plus
      `start-mac.sh` fix are merged, so the handoff is a fast-forward. His
      separate Mac camera server was not kept, because the fork's
      `camera_server.py` already does that job; his camera list and launcher
      now drive it. The CHANGELOG entry says what moved where, so David can
      see his work landed. If upstream gains commits before the handoff,
      repeat this:

      ```bash
      git fetch upstream && git log --oneline origin/main..upstream/main
      ```

- [ ] **Check Actions is enabled on upstream.** It has no workflows today, and
      GitHub leaves Actions off on some forks until someone turns it on
      (Settings -> Actions -> General). Without it, the merge lands and nothing
      runs, which looks exactly like everything passing.
- [ ] **Decide who keeps access.** The fork's collaborators are
      `HlalanathiMashimbye` (admin) and `wernervrens`, `kamolinks`, `Kelani12`,
      `CLXKON001` (write). David decides who carries over. Werner needs write
      at least, because he owns `infra/` and the prod/staging plan.

## The move, in order

The order matters in one place: step 4 must happen before anyone expects a
deploy, because until then every workflow that touches Google Cloud fails at
the login step.

1. **Push `main`.**
2. **Push the branches that are still alive.** Most of the fork's 47 branches
   are merged or dead. These are not:
   - `feat/challenges`, which carries the whole Challenges feature as one
     commit on top of `main`. Read [challenges-branch.md](challenges-branch.md)
     before touching it: a plain rebase onto a `main` that already contains it
     silently deletes the feature.
   - `docs/prod-staging-split-plan`, Werner's draft PR #186.
   - `fix/cloud-run-request-cpu`, draft PR #240 (Cloud Run billed per
     request).

   Merging or closing #240 on the fork before the handoff leaves less to
   carry. Push it only if it is still open.

   ```bash
   git push upstream main feat/challenges docs/prod-staging-split-plan \
     fix/cloud-run-request-cpu
   ```

3. **Copy the Actions variables.** There are 19, and no secrets: everything
   authenticates through workload identity, so no key needs moving. The values
   are safe to copy verbatim, including the Firebase web config, which is
   public by design. Needs admin on upstream.

   ```bash
   FROM=HlalanathiMashimbye/4tronix-rover-simulator
   TO=coderlevelup/4tronix-rover-simulator
   gh variable list -R "$FROM" --json name,value --jq '.[] | [.name, .value] | @tsv' |
     while IFS=$'\t' read -r name value; do
       gh variable set "$name" -R "$TO" --body "$value"
     done
   ```

   `deploy-staging.yml` also reads `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`,
   which the fork never set. Builds pass without it and Analytics simply gets
   no measurement ID. Set it on upstream if Analytics is wanted, otherwise
   leave it.

4. **Tell Google Cloud to trust the new repo.** `bt-impact-academy` only
   accepts GitHub logins from the repo named in `var.github_repository`,
   which defaults to the fork ([infra/variables.tf](../infra/variables.tf)).
   Werner changes it and applies. [infra/README.md](../infra/README.md)
   explains what the change touches and why it is cheap; this is the step,
   not the explanation.

   Until this is applied, staging deploys and `terraform-plan` fail at
   authentication on upstream, and keep working on the fork.

5. **Recreate the branch rules on `main`.** Two separate settings, both
   needed:
   - Branch protection, requiring these five checks to pass. The names must
     match the job names exactly or GitHub waits for a check that never
     reports:
     - `mission-control (build + test)`
     - `yard rover (python tests)`
     - `yard satellite (python tests)`
     - `yard browser tests (blockly codegen)`
     - `firestore rules`
   - A ruleset on the default branch (the fork's is called `main
     protection`): block deletion, block force-push, require a pull request.
     The fork requires 0 approvals, so the PR rule is there to stop direct
     pushes, not to require review.

6. **Create the `production` environment, with required reviewers.** It has
   never existed on the fork. `deploy-prod.yml` names it, and GitHub creates
   a missing environment unprotected on first use, so the first prod
   promotion would ship with no approval at all. Create it before anyone
   runs that workflow. Werner's plan (#186) makes this Phase 0.

7. **Repoint the yard's Pis.** The satellite and the rover each run from a
   git checkout, and pulling is how they update. Their `origin` may still be
   the fork. The satellite has a history of serving stale code, so check it is
   clean before changing anything:

   ```bash
   git log --oneline -1 && git status --porcelain   # status must be empty
   git remote -v
   git remote set-url origin https://github.com/coderlevelup/4tronix-rover-simulator.git
   git pull
   ```

8. **Reopen the open PRs on upstream.** Pull requests do not move with a
   merge. #186 matters most, because its discussion is the prod/staging plan;
   do the same for #240 if it is still open. Their branches are
   pushed in step 2; link each old PR from its new one so the comments are not
   lost.

## How to know it worked

- [ ] A throwaway PR on upstream runs all five checks, and they pass.
- [ ] Merging it triggers `Deploy staging`, which authenticates and deploys.
      This is the real proof of step 4.
- [ ] `terraform-plan` runs green on a PR that touches `infra/`.
- [ ] The satellite's `git pull` fetches from upstream.

## Only if the Drive backup gets built

The off-site backup proposed in Sep (a weekly zip of the managed Firestore
export, copied to a Drive folder David owns) would add the repo's first
secret: David's Drive token. Secrets are never readable back out of GitHub,
so it cannot be copied like the variables above. David signs in again and
the secret is created fresh on upstream.

## Deliberately left pointing at the fork

The two `INF4027W_Team06_Iteration*_ReadMe2026.md` files link to the fork
because they are submission records. They describe the repo as it was when
it was marked. Do not rewrite them.

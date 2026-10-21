# Handing the repo over to David's upstream

At handoff this repository merges into David's upstream,
`coderlevelup/4tronix-rover-simulator`, and every account that runs it becomes
David's. This is the list of what that merge does not carry across.

A merge moves code, history and any branch that is pushed. It does not move
anything stored in the repo's settings: Actions variables, environments,
branch rules, collaborators, open pull requests. Nor does it move the one piece
of trust that lives outside GitHub entirely, which is Google Cloud's rule about
which repo may deploy. Everything below is one of those.

Checked against both repos on 25 Sep 2026, and rechecked on 5 Oct and on
14 Oct 2026. The 14 Oct pass was made with admin on the fork, so it is the
first since September to cover the Actions variables, the branch rules and
the environments as well as commits, branches, open PRs and collaborators.
Re-check anything marked with a count before relying on it, because the fork
keeps moving.

## Before the merge

- [x] **Bring in upstream's three commits.** Done on 5 Oct 2026: MacBook
      satellite mode, the `mac-env/` ignore and the CHANGELOG plus
      `start-mac.sh` fix are merged, so the handoff is a fast-forward. His
      separate Mac camera server was not kept, because the fork's
      `camera_server.py` already does that job; his camera list and launcher
      now drive it. The CHANGELOG entry says what moved where, so David can
      see his work landed. On 14 Oct upstream still had nothing the fork
      lacks: its last push was 20 Aug 2026, and the fork is 655 commits
      ahead of it. If upstream gains commits before the handoff, repeat this:

      ```bash
      git fetch upstream && git log --oneline origin/main..upstream/main
      ```

- [ ] **Check Actions is enabled on upstream.** It has no workflows today, and
      GitHub leaves Actions off on some forks until someone turns it on
      (Settings -> Actions -> General). Without it, the merge lands and nothing
      runs, which looks exactly like everything passing.
- [ ] **Decide who keeps access.** The fork's collaborators are
      `HlalanathiMashimbye` (admin) and `wernervrens`, `kamolinks`, `Kelani12`,
      `CLXKON001` (write), unchanged on 14 Oct. David decides who carries
      over. Werner needs write at least, because he owns `infra/` and the
      prod/staging plan.

## The move, in order

The order matters in one place: step 4 must happen before anyone expects a
deploy, because until then every workflow that touches Google Cloud fails at
the login step.

1. **Push `main`.**
2. **Push the branches that are still alive.** The fork has 35 branches
   (14 Oct; it had 47 on 5 Oct), and most are merged or dead. These are not:
   - `docs/prod-staging-split-plan`, Werner's draft PR #186.
   - `fix/cloud-run-request-cpu`, draft PR #240 (Cloud Run billed per
     request).
   - `feat/challenges`, the prototypes: challenges, the leaderboard, avatars
     and recovery codes. They are kept out of `main` on purpose, and David
     does not want them in the product. Read
     [challenges-branch.md](challenges-branch.md) before touching the branch,
     or before deciding it moves at all: it says why they are prototypes, and
     why a plain rebase onto a `main` that already contains them silently
     deletes them. It was 5 commits ahead of `main` on 14 Oct.
   - Four branches with unmerged work and no open pull request. Nothing on
     GitHub says whether they are alive, so ask their authors before the
     move: `fix/challenges_responsiveness` and `feat/Welcome_Tour` (Kamogelo
     Tsele), and `feat/test-feedback-and-scoring-ab448-449` and
     `feat/feedback-bank-ab471-main` (Konke Cele; the last one's PR, #292,
     was closed without merging).

   Merging or closing #240 on the fork before the handoff leaves less to
   carry. Push it only if it is still open.

   ```bash
   git push upstream main feat/challenges docs/prod-staging-split-plan \
     fix/cloud-run-request-cpu
   ```

3. **Copy the Actions variables.** There are 19, and no secrets (recounted
   on 14 Oct): everything authenticates through workload identity, so no key
   needs moving. The values are safe to copy verbatim, including the Firebase
   web config, which is public by design. Needs admin on upstream.

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
   leave it. It is the only one: the workflows read 20 variables and the
   other 19 are all set.

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

   Both were read back on 14 Oct: the five names still match the jobs in
   `ci.yml`, and the ruleset is active.

6. **Create the `production` environment, with required reviewers.** It has
   never existed on the fork, and still did not on 14 Oct. `deploy-prod.yml`
   names it, and GitHub creates a missing environment unprotected on first
   use, so the first prod promotion would ship with no approval at all.
   Create it before anyone runs that workflow. Werner's plan (#186) makes
   this Phase 0.

   The fork does have one environment, `copilot`. It has no part in any
   deploy and does not need recreating.

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

   A Pi's own settings are not in git and are not touched by this. The
   satellite keeps its yard id, the rover's address and its camera settings
   in `satellite_config.json`, which is ignored.

8. **Reopen the open PRs on upstream.** Pull requests do not move with a
   merge. #186 matters most, because its discussion is the prod/staging plan;
   do the same for #240 if it is still open. Their branches are
   pushed in step 2; link each old PR from its new one so the comments are not
   lost.

## How to know it worked

- [ ] A throwaway PR on upstream runs all five checks, and they pass.
- [ ] Merging it triggers `Deploy staging`, which authenticates, deploys and
      ends on the smoke check (`scripts/smoke-check.sh`). This is the real
      proof of step 4.
- [ ] `terraform-plan` runs green on a PR that touches `infra/`.
- [ ] The satellite's `git pull` fetches from upstream.

## No secrets to move

The fork has no Actions secrets (14 Oct), so step 3 is the whole of it.

Two things looked as if they would add one, and neither did:

- **The off-site backup proposed in September** would have copied a zip to a
  Drive folder with David's token. It was not built. Backups are a managed
  Firestore export on a schedule, set up in Terraform
  (`infra/modules/firestore-backup`), and what Terraform made stays in Google
  Cloud whichever repo deploys to it.
- **Automatic YouTube upload** (#304) keeps its credentials in Secret Manager,
  created by Terraform. The satellite's half is in the Pi's own environment.

If a secret is ever added, it cannot be copied like the variables: secrets are
never readable back out of GitHub. Whoever holds the value creates it again on
upstream.

## The yard's hardware, which no merge moves

The router and the two Pis are in a box, not in the repo, and what lets
someone use them is passwords and a key that GitHub never sees. Hand each over
in person, through the team's password manager once there is one (AB#429),
never in a commit or a chat. Checked on 21 October 2026.

- [ ] **The router**, a Cudy LT300. Its admin password for `http://cudy.net`
      (set by Hlali on 21 October), and the password of the network it serves,
      `mars-relay-network`. Which venue network it joins for the internet is
      set on its own page and changed at each new place; see
      [`yard/docs/yard-network.md`](../yard/docs/yard-network.md).
- [ ] **The `mars` password on the satellite and on the rover.** The rover's
      `mars` has passwordless sudo for everything. The satellite's needs the
      password except for restarting its two services and powering off, which
      `/etc/sudoers.d/satellite` allows (installed on 21 October).
- [ ] **SSH keys on the satellite.** One key may log in as `mars`, from
      Hlali's Mac. Add the new owner's to `~/.ssh/authorized_keys` and remove
      the team's when the team stops working on it. The rover was not checked.
- [ ] **The wifi passwords are in git history**, in `yard/docs/rover-server.md`
      and elsewhere (AB#429). Changing them means changing the router and then
      each Pi's saved profile, which on the rover can only be done over SSH
      while it is still on the old network.
- [ ] **Repoint the Pis' checkouts** as in step 7 above: on 21 October the
      satellite still pulled from the fork.

## Deliberately left pointing at the fork

The two `INF4027W_Team06_Iteration*_ReadMe2026.md` files link to the fork
because they are submission records. They describe the repo as it was when
it was marked. Do not rewrite them.

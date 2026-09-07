# Copilot instructions

**Read `AGENTS.md` at the repository root before writing code here.** It is the
single source for how this repository is structured and what is enforced. This
file deliberately does not restate it, because a rule written in two places is
a rule that drifts - which is itself one of the rules.

The four things not to get wrong, so they are in front of you even if you read
nothing else:

1. **Look before you add.** Find where the thing already half-exists and which
   layer it belongs to. Additive damage is what took Separation of Concerns to
   2.2/4 on a codebase whose build was green.
2. **`core` depends outward on nothing.** It must never import from
   `infrastructure`. This is asserted in
   `mission-control/src/__tests__/unit/architecture.test.ts` and fails CI.
3. **Extend by adding an implementation, not a branch.** `RoverDriver` and
   `IMissionRepository` are the patterns to match.
4. **Every behavioural change needs a test that fails without it** - verified
   by breaking the code on purpose and watching it go red.

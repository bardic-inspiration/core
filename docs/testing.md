# Testing

Test-driven development is **required**: write a failing test before the code
that makes it pass. This is the stack-agnostic contract; the runner, the
layout, and the commands come from the stack ([`AGENTS.md`](../AGENTS.md)
"Commands").

With an agent writing the code, the failing test is the one claim of "done"
it can't talk its way past.

## Core workflow

- **Red → Green → Refactor**, per behavior, not per module. Write the smallest
  failing test that encodes one acceptance criterion, make it pass with
  minimal code, then refactor with the test as a safety net.
- **Acceptance criteria are the pre-written failing tests.** If a criterion
  can't become a test, it isn't specific enough — raise it on the issue.
- **Bug fixes ship with a regression test** that fails before the fix.

## Organization

- **Vitest**, in a `tests/` tree: `tests/<area>.test.ts`, one file per
  ruleset or area of core. Shared helpers are in `tests/helpers.ts`; test-only
  rulesets (such as the tick fixture) are in `tests/fixtures/`.
- The shipped rulesets under `rulesets/` are test data too. `npm run check`
  compiles every one, loads every map and scenario, plays every scenario, and
  compares play with the recorded matches in `data/` before the tests run
  ([`scripts/check.ts`](../scripts/check.ts)).
- Test names state the behavior: "returns an empty list when the input is
  empty", not "test_parse_2".
- Shared test data lives in one fixtures directory. For each surface, provide
  a **minimal**, a **typical**, and a **maxed-out** case.

## Deterministic, always

- No wall-clock time, unseeded randomness, live network, or dependence on
  test order. Inject a clock, seed the random source, stub the network.
- A flaky test is a defect to fix, not a reason to re-run CI until it passes.

## Tests that guard invariants

Every invariant in [`architecture.md`](architecture.md) "Invariants" that a machine can check has a
test or lint rule that fails when it breaks. Name the invariant's ID in it
(`INV-2`), so a failure points straight at the rule, and `grep INV-2` finds
everything that enforces it.

Lessons that carry across projects:

- **Reproducibility tests** compare two *independent* runs that share no state
  (a fresh process, or a reset module cache), and compare the **raw output
  bytes** — never a re-serialization of parsed objects, which can hide drift
  such as key order.
- **Boundary rules** (module A never imports module B) belong in lint, where
  they fail at the cheapest step.
- **Identity tests** ("these two entry points call the *same* function")
  assert the reference itself, not merely equal output.

## Checking by hand

If a change alters how a match plays, watch one — `npm run play -- <ruleset>
<scenario> <seed>` prints its event log ([`AGENTS.md`](../AGENTS.md)
"Commands") — and say in the PR's Testing section what you looked at. Passing
tests don't show that a match still plays sensibly.

## Quality bar to merge

- `check` is green, which means the full suite is. No skipped tests, unless
  marked with a reason in the code and justified in the PR.
- New behavior ships with its tests, in the same PR.

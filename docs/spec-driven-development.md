# Spec-Driven Development

What the spec holds, how a part of it is built and moves into the docs, and
what a release leaves behind.

[`SPEC.md`](../SPEC.md) and its area files in [`spec/`](../spec/) hold
**design that isn't built yet**: what to build. [`docs/`](README.md)
describes **what is built**. [`AGENTS.md`](../AGENTS.md) is the source of
truth for **how to work**. The spec and the docs never overlap, and code and
docs never disagree on `main`.

## Four homes

Docs rot when one document carries several tenses: what the system is, the
design for what it will be, the plan to build it, and the history of how it
was decided. Once a build is done, a cold-start session can no longer tell
which statements describe the system. Keep them apart:

| Kind | Tense | Lives in | Lifespan | A session reads it |
|---|---|---|---|---|
| **Docs** | Present — what core is and does | [`docs/`](README.md) | The life of the project, edited in place | Always: the sections its task touches |
| **Spec** | Future — design not built yet | `SPEC.md`, `spec/<area>.md` | Until built — then it moves to the docs | When its task builds part of it |
| **Plan** | Future — how to get from here to there | A GitHub issue labeled `plan`, its tasks as sub-issues | Until its exit criteria hold — then closed | While it's open |
| **History** | Past — what changed, and why | [`CHANGELOG.md`](../CHANGELOG.md) per release; squash commits, closed PRs and issues | Forever | On demand, never by default |

**The docs hold the present, the spec the designed future, GitHub the
plans, and the changelog and git the past.** Nothing finished is ever a file
in the tree. The one exception is the frozen [`archive/`](../archive/) of
the prototype's pre-process docs ([`documentation.md`](documentation.md)
"Present tense; history lives in git").

## What the spec contains

- **One section per piece of design**, each naming the plan issue that
  builds it (`Plan: #N.`) on its first line.
- **The design itself**, at the precision a test can be written from:
  rules, state transitions, error cases, and the surfaces it adds or
  changes. It links to the docs for what already exists, and says only what
  changes.
- **Open questions:** what is still undecided. **Not contract** — don't
  build against it; resolve it first. An open question about built
  behavior lives here too, until its answer is designed.
- **Area files.** Past a few hundred lines, an area moves to
  `spec/<area>.md`, and `SPEC.md` routes to it.

What core is — purpose, non-goals, invariants, concepts, components, and
quality bars — is built, so it lives in
[`docs/architecture.md`](architecture.md), and the spec cites it.

**Never in the spec:** what is already built, build phases or task lists (a
plan), status ("done", "in progress"), amendment history, meeting notes, and
long accounts of rejected alternatives (the PR).

## Writing it

- **Present tense, as if built.** "The server rejects bodies over 1 MiB" —
  not "we decided the server will…". Superseded design is replaced, never
  struck through or annotated.
- **Testable.** Every behavioral statement can become an acceptance criterion.
  If it can't, it isn't precise enough yet.
- **Rationale in a line, deliberation in the PR.** A rule that looks arbitrary
  or easy to reverse carries a one- or two-line `Why:` — naming the obvious
  alternative, if it was rejected — so nobody undoes it by accident. The
  options weighed and the debate go in the PR description, which becomes the
  squash commit body ([`workflow.md`](workflow.md) "The PR is the record").
- **Cite by ID or heading, not position.** Refer to invariants and sections
  by ID or heading, not by numbers that shift.
- **One home per fact** ([`documentation.md`](documentation.md)). The spec
  points at the docs; it doesn't copy them.

## Using it

- **Issues cite the spec.** A task names the spec section it builds, and its
  acceptance criteria are derived from that section's statements
  ([`workflow.md`](workflow.md) "Issues"). A fix or change to built behavior
  cites the docs section instead.
- **Read before you write.** A session reads the cited sections before
  touching code ([`AGENTS.md`](../AGENTS.md) "Working loop").
- **Building moves the design.** The PR that builds part of the spec
  describes it in `docs/`, in the present tense, and deletes it from the
  spec, in the same PR. A PR that changes built behavior updates `docs/` in
  the same PR. Either way `main` is complete after every merge.
- **Ambiguity stops work.** If the spec or the docs are silent or look
  wrong, don't invent behavior. Add an open question to the spec, and
  resolve it by editing the spec before writing the code that depends on
  it.
- **Disagreement is a bug.** If code and docs disagree on `main`, one of
  them is wrong: file an issue, decide which, and fix that one.
- **History is in git and the changelog.** `git log -- SPEC.md docs/` lists
  every change, one squash commit per PR with its why in the body; `git
  blame` a line, or `git log -S '<phrase>'`, to find why it says what it
  does. What each release changed is in [`CHANGELOG.md`](../CHANGELOG.md).

## Plans

A **plan** turns design too big for one PR into ordered work. A plan is a
GitHub issue labeled `plan` ([template](../.github/ISSUE_TEMPLATE/plan.md)) —
never a file.

1. **Propose.** Open the plan issue: goal, phases with Entry / Build / Exit
   criteria, out of scope. In a PR, write the design it builds into the
   spec, each section naming the plan.
2. **Open a phase.** File the phase's tasks as sub-issues of the plan — each
   citing the spec section it builds, with `Depends on #N` where order
   matters. Later phases wait until theirs opens, so the queue only ever holds
   work that's ready.
3. **Build.** Sessions work the tasks through the working loop
   ([`AGENTS.md`](../AGENTS.md) "Working loop"), each moving what it builds
   from the spec to the docs.
4. **QA pass.** When a phase's tasks are merged, walk its Exit criteria against
   the assembled `main`, run `check`, and confirm the docs describe what
   shipped. Tick the criteria in the plan, and comment the result on it. A
   failed or partial pass isn't a close: file the gaps as sub-issues of the
   same phase.
5. **Finish.** When the last phase passes, confirm no spec section names the
   plan, and close the plan.

A plan holds only the *how* — order, slicing, and done-criteria. Design
deliberation happens in the tasks' issues and PRs, and its outcome goes into
the spec.

## Releases

A release is a tagged point on `main` ([`workflow.md`](workflow.md)
"Releases"). At a release:

- **The docs describe everything the release built**, and the spec holds
  only what it did not. Nothing is moved at release time: each PR moved its
  own part.
- **A version's plan is finished first.** A plan that builds a version is
  closed before that version's release PR opens, unless the owner defers
  part of it. A deferred part stays in the spec, and the plan or a new one
  names the version that takes it.
- **The tag keeps both as they stood.** `git show v<version>:SPEC.md` and
  `git show v<version>:docs/api.md` read the spec and docs of any release.
- **The changelog says what changed** for someone using core, written from
  the PRs merged since the last tag.

## Keeping it lean

The doc audit ([`documentation.md`](documentation.md) "Doc audit") checks that:

- the docs describe `main` — no stale statements;
- the spec holds nothing built, and no section names a closed plan;
- neither carries history — no version annotations, amendment tables, or
  past-tense narration;
- resolved open questions are gone, and nothing finished lives as a file in
  the tree.

Periodically, a **conformance audit** checks `main` against the whole of the
docs, including the seams no single issue owned. Its findings are ordinary
`bug` and `task` issues.

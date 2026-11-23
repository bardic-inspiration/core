# Workflow

How a change gets from an idea to `main` — issues, branches, commits, pull
requests, CI, and merging — and how a spike explores without getting there.
Everything Git and GitHub lives here.

Every change takes the same path, whichever mode produced it
([`AGENTS.md`](../AGENTS.md) "How work happens"): a task, a branch, a PR with
a green check, a human merge — and one squash commit on `main` as the record.

## Issues

An issue is a prompt that outlives its session: the task, written down where
the next session — or you, next month — can find it.

- **Routines always work from an issue.** An interactive session files one for
  work it won't finish itself; a task that comes from chat and lands in this
  session's PR needs no issue — the PR description carries it.
- **Sized for one PR.** If it won't fit, split it before starting.
- **Testable acceptance criteria**, derived from the section the issue
  cites: the spec section it builds, or the docs section whose behavior it
  fixes or changes. They're the failing tests to write first
  ([`testing.md`](testing.md)); if one can't become a test, it isn't specific
  enough yet.
- **Out of scope, stated** — the first guard against creep.
- **Dependencies** as a `Depends on #N` line, so the queue skips the issue
  until they close.
- **Ends with a `## TL;DR`:** a few plain-English bullets, no jargon — why it
  exists, and what changes once it's done.

The [templates](../.github/ISSUE_TEMPLATE/) lay these out — Feature / task,
Bug report, Docs change. They apply only in GitHub's web form; an agent filing
through the API writes the same sections itself.

### Labels

| Label | Meaning |
|---|---|
| `task` | A feature or change sized for one PR. In the queue. |
| `bug` | Behavior that contradicts the spec. In the queue. |
| `documentation` | A substantive docs-only change. |
| `plan` | A plan: phases and done-criteria for work bigger than one PR, with its tasks as sub-issues ([`spec-driven-development.md`](spec-driven-development.md) "Plans"). Not in the queue itself. |
| `needs-discussion` | Needs a human decision before anyone builds it — usually a design interview (`ask-me`, `grill-me`), with the decisions recorded as a comment and the acceptance criteria rewritten and confirmed. Out of the queue until the label comes off. |

Labels are lowercase, colon-scoped where hierarchical (`area:parser`).

### The queue

A routine that isn't handed an issue takes the **lowest-numbered open issue
labeled `task` or `bug`** that has no open PR linked to it, isn't labeled
`needs-discussion`, and has every "Depends on" issue closed. Filing order is
priority and dependency order — file prerequisites first.

The rule assumes one picker at a time. Routines that run in parallel each
work their own queue, split by a label such as `area:parser`. Plans don't
change the queue: a plan's tasks are filed only when their phase opens
([`spec-driven-development.md`](spec-driven-development.md) "Plans").

### Closing

Issues close through a merged PR carrying `Closes #N`, which keeps the trail
from issue to commit intact. One that turns out invalid or superseded is
closed with a comment saying why, and the matching reason ("not planned",
"duplicate") — never deleted or left to go stale.

## Scope

Sessions don't remember each other, so nobody cleans up "temporary" scope
creep later — it just becomes permanent drift. Every PR is one concern:

- **Do what the task asks — nothing more.** A file the acceptance criteria
  don't touch isn't part of this PR, even if the change is one line and
  obviously right. No drive-by refactors, no "while I'm in here" fixes.
- **File, don't fold.** Anything worth doing that's out of scope becomes a new
  issue saying where it came from ("Surfaced while working #N"), and the PR
  gets one line pointing at it — not a `TODO`, not a note buried in the PR.
- **A PR that outgrows its task means the task was under-scoped.** Split the
  extra ground into issues rather than growing the PR.
- **Two lists name the tempting-but-out-of-scope work:** the non-goals in
  [`architecture.md`](architecture.md) (what the project never does) and each open plan's "Out of scope" (what
  this stretch of work leaves for later).

**When something unplanned comes up,** ask one question: does proceeding mean
guessing at behavior, or risking an invariant? **Yes** → stop, and resolve it
in the spec first ([`spec-driven-development.md`](spec-driven-development.md)
"Using it"). **No** → keep going, and file the rest.

## Branches

- Branch from `main` as `type/short-description` (`feat/login-form`,
  `fix/empty-list-crash`), using the commit types below. If your agent
  platform assigns the branch name, use it as given.
- One branch per PR. A spike's branch is `spike/<question>`
  ([Spikes](#spikes)).
- **Once pushed, a branch's history is shared** — another session may have it
  checked out. Add commits; never amend, rebase, or force-push. To catch up
  with `main`, merge it in (or use GitHub's "Update branch"); the squash
  absorbs the merge commit.

## Commits

`main` gets **one commit per PR**, because PRs land by squash merge: the PR
title becomes the commit subject (with ` (#N)` appended) and the PR
description becomes its body. So `git log --oneline` reads as the project's
changelog, one line per change, and `git show` gives the why without leaving
the repo.

**PR titles are Conventional Commits subjects** — CI checks them, because
each becomes a commit subject on `main`:

```
type(scope): imperative subject
```

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`,
  `build`, `style`, and `release` for a release PR ([Releases](#releases)).
- **Scope** (optional): the lowercase name of the package, module, or area.
- **Breaking changes:** `!` after the type or scope (`feat(api)!: ...`), plus
  a `BREAKING CHANGE:` line in the PR description saying what breaks.
- **Subject:** imperative, lower-case, no trailing period, ≤ 72 characters
  including the ` (#N)` GitHub appends.

The commit's body is the PR description
([The PR is the record](#the-pr-is-the-record)).

**Branch commits** never reach `main`, so they need no particular format —
just a message that says what the step did, so a reviewer, or a session
picking the branch up mid-flight, can follow along.

### Versioned surfaces

Core's versioned surfaces:

| Surface | Version | Defined in |
|---|---|---|
| The format: rulesets, behaviors, maps, scenarios | `format:` in each document | [`format.md`](format.md) |
| Each ruleset | `version:` in its `ruleset.yaml` | The ruleset |
| The host contract and the exported API | `version` in `package.json` | [`host.md`](host.md), [`api.md`](api.md) |
| The log | Every recorded match's `logHash` | [`format.md`](format.md), [`data/README.md`](../data/README.md) |

A breaking change to any of them is marked `!` in the PR title, and the PR
says under `BREAKING CHANGE:` what an author, an engine, or a host must
change. How each moves:

- **A ruleset's `version`** is bumped in the PR that changes the ruleset
  (additive → minor, breaking → major), with every document written for it,
  so the compiler's version check ([`matches.md`](matches.md) "Compiling")
  stays true on `main`.
- **`format:`** goes up by one in the PR that breaks the format.
- **Core's `version`** in `package.json` is the latest release's. PRs leave
  it alone; the release PR sets it from the changes since the last tag
  ([Releases](#releases)).
- **The log** never changes silently: a change to how a match plays changes
  its `logHash`, and the gate fails until the recorded matches are
  regenerated with `npm run sim` and committed in the same PR.

## Pull requests

### The PR is the record

| PR field | Becomes | So write it as |
|---|---|---|
| Title | The commit subject on `main` | A Conventional Commits subject ([Commits](#commits)). |
| Description | The commit body | What a reader of `git log` needs a year from now: what, why, where it came from, how it was tested, the TL;DR. No leftover template comments. |

If review changes the approach, **update the description before merge**, so
the record matches what landed.

### Opening one

- **Open it when the work is ready.** A routine's run isn't done until it has
  produced a PR. (Exception: you're told not to.)
- **Run the pre-flight checklist** (below) first.
- **Fill in the [template](../.github/pull_request_template.md)**, then delete
  the sections that don't apply and every guidance comment.
- **Link its task:** `Closes #N` for an issue. A chat task with no issue
  states the task and its acceptance criteria in the Summary instead.
- **Say where it comes from** — the spec section it builds, or the docs
  section it changes — so a reader can trace commit → PR → issue → spec.
- **End with a `## TL;DR`:** plain-English bullets — why, and what changes.
  It's the reviewer's fast path, and it lands in history as the plain-English
  line of the project.

### Pre-flight checklist

This lives here rather than in the PR template, so it doesn't repeat in every
commit on `main`.

**Code changes:**

- [ ] Tests written first, and passing; `check` green
      ([`AGENTS.md`](../AGENTS.md) "Commands").
- [ ] `docs/` describes the behavior as merged — updated if behavior
      changed, and what this PR builds deleted from the spec.
- [ ] A breaking change is marked `!`, with `BREAKING CHANGE:`, and any
      ruleset it changes has its `version` bumped.
- [ ] One concern, scoped to its task; the invariants still hold.
- [ ] Title and description written for `git log`.

**Docs-only changes:** every changed file is Markdown; the title is
`docs: ...`; links resolve and cross-references are updated; no process
narration in doc content ([`documentation.md`](documentation.md)).

## Watching CI

**A PR you open is yours until it's merged or closed.** Opening it isn't the
end of the task: with several PRs open at once, each merge moves `main` under
the others, and a PR that was green an hour ago may not be now.

- **Red check** → read the log, fix the cause on the same branch, push. Never
  skip, disable, or weaken a test to get green. If the failure isn't this PR's
  (it's red on `main` too), say so once on the PR instead of fixing it here.
- **Behind `main`, or conflicting** → merge `main` in, resolve, run `check`,
  push.
- **Review comments** → fix and push, or answer why not, on the thread.
- **Blocked on something only a human can decide** → say so once on the PR,
  and stop.

**Spike PRs are the exception** ([Spikes](#spikes)): they're red by design, so
nobody watches or "fixes" them.

In an interactive session, tell the user where things stand; in a routine,
the PR's own comments are the report. How a session watches is tool-specific
— for Claude Code, see [`CLAUDE.md`](../CLAUDE.md).

## Merging

- **A human reviews and merges.** Agents open and fix PRs; they don't merge
  them.
- Merge when `gate` and `pr-title` are green on the latest commit, the branch
  is up to date with `main`, and review threads are resolved. After reviewing,
  **"Enable auto-merge"** lets GitHub merge the moment that's all true.
- Land with **"Squash and merge,"** and check the pre-filled message reads
  well as a commit.
- **Dependency updates** from Dependabot need no issue: read what changed, and
  merge when green.

## Releases

A release is a tagged point on `main`. Core isn't published to a package
registry; a release is its tag and its GitHub release.

- **Version numbers** take [Semantic Versioning](https://semver.org)'s
  `MAJOR.MINOR.PATCH` form, for core's host contract and exported API
  ([`AGENTS.md`](../AGENTS.md) "Versioning"): major for a breaking change,
  minor for an addition, patch for fixes alone.
- **Tags** are `v<version>`, on the release PR's squash commit on `main`,
  each with a GitHub release whose notes are its changelog section.
  `package.json`'s `version` is the latest release's. v1.0.0 is an internal
  pre-release: its GitHub release is marked as a pre-release.
- **The changelog**, [`CHANGELOG.md`](../CHANGELOG.md), follows
  [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): newest release
  first, one section per release under `## [<version>] - <YYYY-MM-DD>`, with
  only the groups that apply of `Added`, `Changed`, `Deprecated`, `Removed`,
  `Fixed`, and `Security`. Lines are written for someone using core — an
  engine, or a ruleset's author — not copied from commits, and cite their
  PRs. Each version links to its compare view at the bottom of the file.
- **A release PR** is titled `release: v<version>`, on a branch
  `release/v<version>`. It sets `version` in `package.json` and the lockfile
  (`npm version <version> --no-git-tag-version`), writes the release's
  changelog section from the PRs merged since the last tag
  (`git log <tag>..main`, one squash commit per PR), and dates it the day it
  merges. The bump follows from those PRs: any marked `!` makes it major.
  Other PRs don't edit the changelog, so parallel sessions never conflict
  over it.
- **Before it opens,** the docs describe what the release built and the
  spec holds only what it didn't
  ([`spec-driven-development.md`](spec-driven-development.md) "Releases").
- **After the merge,** the owner tags the squash commit and publishes the
  GitHub release.
- **Version names.** Versions are named by their tags, written in full.
  Before v1.0.0, plan #19's version was called v1.1; it is v2.0.0, because it
  breaks the host contract. Issue and PR titles from before then keep the old
  name.

## Docs-only changes

A change is **docs-only** when every changed file ends in `.md`. Anything
else in the diff — code, tests, config, a workflow, a lockfile — makes it a
code change. When in doubt, it's a code change.

- **Skip:** writing tests first, and running `check`. CI skips the gate on a
  Markdown-only diff by itself ([`ci.md`](ci.md)).
- **Issues:** a substantive change (a new doc, a rule change) gets one, using
  the Docs change template; a trivial fix (a typo, a broken link) doesn't.
- **A spec change** follows
  [`spec-driven-development.md`](spec-driven-development.md): the spec holds
  only what `main` doesn't do yet, each section naming its plan.
- **Still required:** correct content, links that resolve, cross-references
  updated in the same PR, no process narration in doc content, and the TL;DR.

## Spikes

A spike spends cheap code to buy understanding: whether an approach works,
which of several designs to pick, what an interface feels like to use. It's
the one place code is written to be thrown away — so it's the one place the
rules above are off. What crosses into `main` is what you learned, never the
code.

1. **Start from a question, not a task:** "Can this sync offline?" "A, B, or
   C?" Branch `spike/<question>` — or, where the agent platform assigns the
   branch name, mark it with the PR title instead (step 4).
2. **Explore freely.** No issue, no tests first, no scope rules, messy commits
   welcome. Competing approaches can run as parallel spikes.
3. **Time-box it** to a session or an afternoon. A spike that keeps growing is
   answering the wrong question.
4. **Open a draft PR titled `spike: <the question>`** and write the findings
   in its description — the one required output:

   ```markdown
   ## Question
   ## What I tried
   ## What worked, and what didn't
   ## Recommendation
   ## Follow-ups   <!-- the spec edits and issues this led to -->
   ```

5. **Turn the findings into the real path:** answer the spec's open questions
   in a docs-only PR, and file issues for the work ("Explored in #N").
6. **Close the spike PR unmerged**, linking the follow-ups, and delete the
   branch. The closed PR keeps the diff and the findings on GitHub for good.

The real work then goes through the normal loop — test first, `check`, a PR.
A session may read the spike for reference, but it rewrites the code rather
than merging it.

**The guard.** The required `pr-title` check fails any PR whose branch starts
with `spike/` or whose title starts with `spike:`, so a spike can't be merged
by accident ([`ci.md`](ci.md) "PR title check"). It catches accidents, not
decisions: promoting a spike means rebuilding it through the normal loop, not
retitling it.

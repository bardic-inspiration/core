# Documentation

How docs are written, named, and kept truthful. Documentation drift is a
defect.

## Source of truth

- [`SPEC.md`](../SPEC.md) is authoritative for **what to build**; code
  conforms to it ([`spec-driven-development.md`](spec-driven-development.md)).
- [`AGENTS.md`](../AGENTS.md) is authoritative for **how to work**.
- **Every fact has one home.** Other docs describe it in a line and link
  there — duplication drifts.

## Present tense; history lives in git

- Docs describe the project **as it is now**. The active future lives in
  plan issues on GitHub; the past lives in git — squash commits, PRs, and
  issues ([`spec-driven-development.md`](spec-driven-development.md)
  "Three tenses, three homes").
- A doc that has done its job is deleted, not moved to an archive folder.
  Superseded text is replaced, not struck through or annotated.
- **One exception:** [`archive/`](../archive/) holds the prototype's brief,
  decision log, and handoff note from before this process was adopted. It is
  frozen — read it for background, never edit it, never add to it, and never
  treat it as describing `main`. What it says that still holds belongs in the
  spec.
- **No process narration.** Docs don't reference chat sessions, "as
  discussed," or session links. How a change came to be belongs in its PR
  description, which becomes the commit body on `main`.

## Structure

- **Purpose line.** Every doc opens with a `# Title` and a one-line statement
  of what it's for.
- **Routing tables.** A doc that hands the reader off to others uses a table
  of link and "read when" — [`AGENTS.md`](../AGENTS.md) "Protocol docs" is the
  model. Point at another doc's table; don't copy it.
- **Stable rules apart from churn-prone detail.** Timeless rules don't embed
  what changes as the project grows (which tool enforces a rule, current
  status) — they point at where that lives.
- **Cite by name, not number.** Link docs relatively, and refer to sections
  by heading or stable ID (`INV-2`), never by a number that shifts.

## Keep in sync

- A change that alters observable behavior updates the affected docs **in the
  same PR**.
- When a shared term, identifier, or heading changes, every doc that names it
  changes in the same PR, with identical spelling.
- Where a doc can be checked against the code mechanically — a file map, a
  command list — prefer a check in `check` to good intentions
  ([`ci.md`](ci.md) "Enforcing project rules").

## Style

- Short, skimmable docs with links over long prose.
- Fenced code blocks for commands and payloads.

## Naming

- **Root meta-files** keep the open-source convention of `ALL-CAPS.md`:
  `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`, `AGENTS.md`,
  `CLAUDE.md`, `SPEC.md`.
- **Everything under `docs/`:** `kebab-case.md`. Spec areas, once the spec is
  split, are `docs/spec/<area>.md`.
- **Stable IDs** that docs cite, like invariants: a short uppercase prefix
  plus a number (`INV-3`). Never reuse or renumber one; retire it.
- **Branches, commits, and labels:** [`workflow.md`](workflow.md).

### Code

- **TypeScript:** `camelCase` for variables, functions, and constants;
  `PascalCase` for types and classes. Source files are lower-case, one word
  where one will do (`src/runtime/match.ts`).
- **Authored data uses the same casing as the code:** YAML keys and names
  declared in a ruleset are `camelCase` (`blocksMove`, `swarmLimit`), so an
  expression reads a field by the name it was declared with. There is no
  split between code and data names.
- **Ids** of rulesets, scenarios, maps, and behavior sets are `kebab-case`,
  and match their file or directory name (`rulesets/dnd-5e-2024-slice/`,
  `maps/rocky-pass.yaml`).
- **Signals** are dotted: `subject.event` (`turn.start`, `hp.lose`).

## Doc audit

The docs are reconciled periodically, not continuously. An audit checks that:

- **the spec describes `main`** — no stale statements, no `Planned` marker
  whose plan issue is closed, no history (version annotations, amendment tables,
  past-tense narration);
- **only live documents exist** — nothing future-tense or finished lives as
  a file outside the frozen [`archive/`](../archive/), and resolved open
  questions are gone from the spec;
- **status matches GitHub** — anything the docs report about what's built or
  what's next matches the actual issues, PRs, and milestones;
- **links resolve**, and cross-references use identical spelling;
- **`check` is the gate** — AGENTS.md "Commands" and `ci.yml` run the same
  command;
- **one home per fact** — no second copy of a rule that has quietly diverged;
- **no template leftovers** — no unfilled placeholders or unresolved guidance
  comments from adoption.

Any session may open a docs-only PR to fix drift it spots while working. A
broader pass is filed as its own docs issue. Doc fixes never ride along in an
unrelated code PR.

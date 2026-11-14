# core — Specification

`status: draft`

<!-- TEMPLATE: status is one of
- draft    — being written; nothing is built from it yet.
- building — the initial build plan is open; the spec isn't yet true of main.
- current  — true of main, except sections marked `Planned (#N):`, where #N
             is the plan issue building them.

Right-size this spec: keep the parts the project needs and delete the rest. A
small tool's spec can fit on a page. How to write and use it:
docs/spec-driven-development.md.

This is a skeleton. Until it is written, docs/format.md and docs/host.md
describe main, and archive/ holds the prototype's brief, decisions, and
handoff note to write it from. -->

The source of truth for **what to build**. Written in the present tense: it
describes the system as it is on `main`, except where marked `Planned`. Its
history is in git (`git log -- SPEC.md`), not in this file.

## Purpose & non-goals

core is a ludematic core: a format that expresses a game's ruleset — a
tabletop RPG, a board game, a sandbox of self-assembling bots — as pure data,
and one generic runtime that plays any ruleset written in it. Closed games
are a special case of open ones: nothing is authored during play, and a
scenario declares an end. It is for engines that run matches (the studio,
headless simulation, agents) and for the authors of rulesets.

**Non-goals:**

- Geometry, rendering, and input. Core declares what is spatially possible;
  the engine answers spatial queries through the host contract.
- The content library and the translator from it. Both are separate
  projects; core only defines what the translator writes into.
- Code in a ruleset. When the format can't express a rule, the format grows.

## Invariants

These hold for every change. A change that breaks one is wrong even if CI is
green.

<!-- TEMPLATE: the test or lint rule that enforces each one names its ID. -->

- **`INV-1` — Rules are data.** The runtime has no game-specific code. Every
  ruleset is played by the same runtime, and no ruleset carries code of its
  own.
- **`INV-2` — Fail closed.** Invalid rules data — a document, a name, an
  expression, a change to anything a base ruleset keeps closed — is refused
  at compile time, with every reason listed. Nothing invalid is guessed at.
- **`INV-3` — Deterministic.** The same compiled rules, scenario, seed, and
  decisions give the same log.
- **`INV-4` — The log is the record.** Folding a match's log gives its final
  state, and replaying the log's decisions through the rules reproduces the
  log entry for entry.
- **`INV-5` — Host-agnostic.** Nothing reachable from `src/index.ts` imports
  Node or touches the file system; core runs unchanged in a browser or a Web
  Worker, and writes the same logs there as in Node.

## Concepts

<!-- TEMPLATE: the core nouns, each defined once. -->

| Term | Meaning |
|---|---|
| | |

## Architecture

<!-- TEMPLATE: the components, what each owns, and the boundaries between them.
A diagram or tree beats prose. -->

## Interfaces

<!-- TEMPLATE: every surface other code or people depend on — types, APIs,
file formats, CLI — precise enough to test against. Mark each surface that is
versioned (docs/workflow.md "Versioned surfaces"). -->

Until this section is written, the format is described in
[`docs/format.md`](docs/format.md) and the host contract in
[`docs/host.md`](docs/host.md).

## Behavior

<!-- TEMPLATE: rules, state transitions, and error cases, at the precision a
test can be written from. When a rule needs a `Why:` line, see
docs/spec-driven-development.md "Writing it". -->

## Quality bars

<!-- TEMPLATE: budgets as numbers — latency, size, supported platforms,
security posture. -->

## Open questions

Undecided, and **not contract** — don't build against these; resolve one by
editing the spec, then delete it here.

- None yet.

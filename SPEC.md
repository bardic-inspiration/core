# core — Specification

`status: current`

The source of truth for **what to build**. Written in the present tense: it
describes the system as it is on `main`, except where marked
`Planned (#N):`, where `#N` is the plan issue building it. Its history is in
git (`git log -- SPEC.md`), not in this file. How to write and use it:
[`docs/spec-driven-development.md`](docs/spec-driven-development.md).

`SPEC.md` is the index: purpose, invariants, concepts, and the rules that
cross every area. Each area has its own file.

| Read | For |
|---|---|
| [`docs/format.md`](docs/format.md) | The format: how a ruleset, extension, behavior set, map, and scenario are written, and the log's entries. |
| [`docs/host.md`](docs/host.md) | The space host contract, and the API an engine drives a match with. |
| [`docs/spec/decisions.md`](docs/spec/decisions.md) | How a seat's decision is asked for, chosen, and recorded, and how scripted seats choose. |
| [`docs/spec/srd-ruleset.md`](docs/spec/srd-ruleset.md) | The SRD 5.2 ruleset: the document hierarchy, content, characters, monsters, the coverage ledger, and how it is tested. |
| [`data/README.md`](data/README.md) | The recorded matches and what a record holds. |

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
- A game AI library as a dependency.
  Why: those surveyed take decision logic as code and keep their own agent
  state and randomness, against `INV-1`, `INV-3`, and `INV-5`.

## Invariants

These hold for every change. A change that breaks one is wrong even if CI is
green.

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

The nouns that span documents. What a ruleset declares — kinds, relations,
globals, enums, tables, intents, menus, signals, reactions, procedures, the
flow, the space — is defined in [`docs/format.md`](docs/format.md) "The
model".

| Term | Meaning |
|---|---|
| Ruleset | A document declaring what may exist and what may happen in a game. It carries its own `version`. |
| Extension | A document that changes what its base ruleset leaves `open`, and nothing else. |
| Kit, pattern | The kit holds named templates; a ruleset or extension uses a pattern with arguments, and it expands into ordinary declarations. |
| Registry | A compiled ruleset with its extensions: every declaration resolved, every expression type-checked, every address listed. |
| Entity | An instance of a kind, with an id. State is entities, links between them, globals, the ground, and the seats' streams. |
| Space | A ruleset's declaration of what a map can be and the two rules the host respects on it. |
| Map | One playing environment for a ruleset: a document of its own, never changed by play. |
| Ground | A map with what a match has written to its mutable layers laid over it. |
| Host | The engine's geometry: six pure functions of one map. |
| Scenario | Which entities are in play, where they stand, who is seated, on which map, and when the match ends. |
| Seat | A place at the match that makes decisions. A referee seat may also author changes and rule that an intent happens. |
| Driver | What fills a seat: it is given a decision and returns one of its options. |
| Behavior, behavior set | A behavior scores a seat's options; a behavior set is a document of behaviors compiled against a registry. |
| Prompt | The effect that asks a seat to choose among offered intents. |
| Decision, option | A decision is a seat and its options; an option is an offered intent with every param bound and every gate passed. |
| Match | A registry, a scenario, a seed, and the decisions made; it produces a log. |
| Log | The ordered entries of a match: every write, roll, decision, and signal, setup included. |
| Record | A summary of a match worked out from its log alone, with a hash of the log. |

## Architecture

```
documents (YAML, as plain data)
  kit, ruleset, extensions ──compile──────────▶ registry
  behavior sets ─────────────compileBehaviors─▶ behaviors   (against a registry)
  map ───────────────────────loadMap──────────▶ map         (against a registry)
  scenario ──────────────────loadScenario─────▶ scenario    (against a registry and maps)

registry + scenario + seed ──Match──▶ log ──fold──▶ state
                               ▲  │
                     drivers ──┘  └──▶ host   (geometry, built from the ground)
```

| Component | Owns | Never |
|---|---|---|
| Compiler (`src/compile/`) | Schema checks, pattern expansion, merging extensions under `open`, resolving names, type-checking expressions. Every refusal (`INV-2`). | Runs a rule. |
| Runtime (`src/runtime/`) | Running the flow, enumerating decisions, applying effects, the log, fold, replay, fork, snapshots, seat streams, the ground. | Knows a game (`INV-1`); keeps state outside the log and a snapshot. |
| Function library (`src/lib/`) | The functions an expression may call, and the types of the host contract. | |
| Reference host (`src/host/`) | The worked example of the host contract, used when an engine gives none. | Reads the ruleset or the match. |
| Loader (`src/load.ts`), `scripts/` | Reading files, the gate, play, simulation, browser timing. | Is reachable from `src/index.ts` (`INV-5`). |
| Data (`kit/`, `rulesets/`, `data/`) | The kit, the shipped rulesets with their behavior sets, maps, and scenarios, and the recorded matches. | Carries code (`INV-1`). |

The rules never read a behavior, a driver, or a host's internals. A behavior
set, a map, and a scenario are each checked against a registry and can be
swapped without recompiling it.

## Interfaces

Every surface outside code depends on, and where it is defined. Each is
versioned ([`docs/workflow.md`](docs/workflow.md) "Versioned surfaces").

| Surface | Defined in | Version |
|---|---|---|
| The format: ruleset, extension, behavior set, map, scenario | [`docs/format.md`](docs/format.md) | `format:` in each document |
| A ruleset's own declarations | The ruleset | `version:` in its `ruleset.yaml` |
| The space host contract | [`docs/host.md`](docs/host.md) "The space host" | `version` in `package.json` |
| The exported API (`src/index.ts`) | [`docs/host.md`](docs/host.md) "Driving a match" | `version` in `package.json` |
| The log | [`docs/format.md`](docs/format.md) "The log" | Every recorded match's `logHash` |
| The match record | [`data/README.md`](data/README.md) | With the log |
| The commands | [`AGENTS.md`](AGENTS.md) "Commands" | Unversioned |

## Behavior

The rules that hold across areas. An area's own rules are in its file.

### Compiling

- Every document is checked against a schema, then resolved against what it
  refers to. A document with an unknown key, an unknown name, an ill-typed
  expression, or a `format` core does not read is refused.
- A refusal is a `CompileError` listing every reason with its path, not only
  the first (`INV-2`).
- An extension may change only what its base lists under `open`. Two
  declarations that disagree are a conflict, not a merge.
- A behavior set, a map, and a scenario each name the ruleset and version
  they are written for, and are refused against any other.
- An expression is typed, cannot loop, and reads or writes nothing outside
  the registry's addresses.

### Playing

- A match starts from a scenario's setup, which is written to the log like
  any other event, then runs the ruleset's `flow`.
- The flow runs until a prompt needs a decision. A decision is asked,
  chosen, and recorded as [`docs/spec/decisions.md`](docs/spec/decisions.md)
  says.
- A match ends with the outcome of the first scenario end condition that
  holds, checked after every write a rule makes; as `complete` when the flow
  runs out; or as `limit` at the scenario's `limits.maxDecisions` (10,000
  when it gives none).
- A rule that cannot be carried out stops the match with a `RuleError`
  saying why: a write that fails a kind's or a cell's check, a read of a
  value hidden from the deciding seat, a `cellAt` off the map, a flow that
  runs a million steps without reaching a decision.
- Chance comes only from seeded streams: one for the rules' dice, and one
  per seat for its driver's draws. How a seat decides never moves the dice
  (`INV-3`).

### The log, replay, and forks

- Each write, roll, decision, and signal is one entry, numbered by `seq`,
  carrying the `seq` of the intent or signal it ran under as `cause`.
- `fold` of a log, or of any prefix of it, gives the state at that point,
  seat streams included (`INV-4`).
- `replay` puts a log's decisions, referee changes, and rulings back through
  the rules, and fails at the first entry that differs.
- `fork` returns the match as it stood before a given decision. Choosing the
  same again plays out the same match.
- A snapshot is a match at a decision as plain data; a match restored from
  one plays on as the original would have.

### Hidden information

- A field or global may declare who sees it. The rules see everything.
- A seat's options, and a behavior's scores for them, are worked out through
  that seat's view. Reading a hidden value there is an error, not a blank.
- The log is not filtered by seat.

### The ground

- A map document is never changed. A match holds its writes to mutable
  layers in its state; the ground is the map with those laid over it.
- Expressions and the host answer from the ground as it stands.
- A host is a pure function of one map. It is never told of a change.
- `scenario.mapAt(state)` returns the same object for the same
  `state.ground`.

### Work in proportion to change

`Planned (#TBD):`

- When one thing changes, core does work in proportion to that change, not
  to the size of what surrounds it. State that did not change, and anything
  derived from it, is not rebuilt, copied, or logged again.
- A write to one cell of the ground does work in proportion to the cells
  written, not to the size of the map, in core and in the reference host.
  A test holds it there by counting.
- The three rules under [The ground](#the-ground) still hold, and no log
  changes.
  Why: the studio scrubs to any point of a log with `fold` and compares
  maps by identity, so a host that is pushed changes and keeps its own state
  would break scrubbing and forks.
- [`docs/host.md`](docs/host.md) says what a host is given when the ground
  changes.

## Quality bars

- **Platforms.** Node 22.6 or later, and a Web Worker in current Chromium.
  Every shipped scenario writes the same log in both.
- **The gate.** `npm run check` compiles every shipped ruleset alone and
  with each extension, compiles every behavior set, loads every map and
  scenario, plays every scenario to an end it declares, and compares three
  seeds of each with the recorded matches.
- **Dependencies of core's entry.** Four: a CEL evaluator, a JSON Schema
  checker, Immer, and a YAML parser. None touches Node.
- **Cost of a ground write.** `Planned (#TBD):` in proportion to the cells
  written ([Work in proportion to change](#work-in-proportion-to-change)).
- **SRD coverage.** `Planned (#TBD):` the numbers are in
  [`docs/spec/srd-ruleset.md`](docs/spec/srd-ruleset.md) "Coverage".

## Open questions

Undecided, and **not contract** — don't build against these; resolve one by
editing the spec, then delete it here. An area's open questions are in its
file.

- **How is a ground write made proportional?** Hand the host the previous
  host and the cells that changed; give `SpaceMap` a shape that shares
  structure between grounds; batch the writes of one effect list; or some
  of these together.
- **Which other cases does the principle bind?** A keyed write to a
  map-typed global logs the whole map, which fixing would change every
  affected `logHash`. A derived value is worked out again after every write.
  Every end condition is evaluated after every write. Each is either made
  a rule here or measured and accepted.

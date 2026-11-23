# Architecture

What core is, the rules every change keeps, the nouns the other docs use,
the components and what each owns, and the surfaces outside code depends on.

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
flow, the space — is defined in [`format.md`](format.md) "The model".

| Term | Meaning |
|---|---|
| Ruleset | A document declaring what may exist and what may happen in a game. It carries its own `version`. |
| Extension | A document that changes what its base ruleset leaves `open`, and nothing else. |
| Kit, pattern | The kit holds named templates; a ruleset or extension uses a pattern with arguments, and it expands into ordinary declarations. |
| Registry | A compiled ruleset with its extensions: every declaration resolved, every expression type-checked, every address listed. |
| Entity | An instance of a kind, with an id. |
| State | Entities, the links between them, globals, the ground, the position of the rules' dice, and the seats' streams. |
| Space | A ruleset's declaration of what a map can be, and the two rules the host respects on it. |
| Map | One playing environment for a ruleset: a document of its own, never changed by play. |
| Ground | A map with what a match has written to its mutable layers laid over it. |
| Host | The engine's geometry: six pure functions of one map. |
| Scenario | Who is seated, which entities are in play and where they stand, on which map, and when the match ends. |
| Seat | A place at the match that makes decisions. A referee seat may also author changes and rule that an intent happens. |
| Driver | What fills a seat: it is given a decision and returns one of its options. |
| Behavior, behavior set | A behavior scores a seat's options; a behavior set is a document of behaviors compiled against a registry. |
| Prompt | The effect that asks a seat to choose among offered intents. |
| Decision, option | A decision is a seat and its options; an option is an offered intent with every param bound and every gate passed. |
| Match | A registry, a scenario, a seed, and the decisions made; it produces a log. |
| Log | The ordered entries of a match: every write, roll, decision, and signal, setup included. |
| Snapshot | A match at a pending decision, as plain data. |
| Record | A summary of a finished match worked out from its log alone, with a hash of the log. |

## Components

```
documents (YAML, parsed to plain data by the caller)
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
| Compiler (`src/compile/`) | Schema checks, pattern expansion, merging extensions under `open`, resolving names, type-checking expressions. | Runs a rule. |
| Runtime (`src/runtime/`) | Loading maps and scenarios, running the flow, enumerating decisions, applying effects, the log, fold, replay, forks, snapshots, seat streams, the ground. | Knows a game (`INV-1`); keeps state outside the log and a snapshot. |
| Function library (`src/lib/`) | The functions an expression may call, and the types of the host contract. | |
| Reference host (`src/host/`) | The worked example of the host contract, used when an engine gives none. | Reads the ruleset or the match. |
| Loader (`src/load.ts`), `scripts/` | Reading files, the gate, play, simulation, browser timing. | Is reachable from `src/index.ts` (`INV-5`). |
| Data (`kit/`, `rulesets/`, `data/`) | The kit, the shipped rulesets with their behavior sets, maps, and scenarios, and the recorded matches. | Carries code (`INV-1`). |

The rules never read a behavior, a driver, or a host's internals. A behavior
set, a map, and a scenario are each checked against a registry, and can be
changed or swapped without recompiling it.

## Interfaces

Every surface outside code or people depend on, and where it is described.
All but the commands are versioned
([`workflow.md`](workflow.md) "Versioned surfaces").

| Surface | Described in | Version |
|---|---|---|
| The format: ruleset, extension, kit, behavior set, map, scenario | [`format.md`](format.md) | `format:` in each document; core reads format 2 |
| A ruleset's own declarations | The ruleset | `version:` in its `ruleset.yaml` |
| The space host contract | [`host.md`](host.md) | `version` in `package.json` |
| The exported API: everything `src/index.ts` exports | [`api.md`](api.md) | `version` in `package.json` |
| The log | [`format.md`](format.md) "The log" | Every recorded match's `logHash` |
| The match record | [`data/README.md`](../data/README.md) "A record" | With the log |
| The commands | [`AGENTS.md`](../AGENTS.md) "Commands" | Unversioned |

Documents are passed to the API parsed, as plain data; core reads no file.

## Quality bars

- **Platforms.** Node 22.6 or later, and a Web Worker in current Chromium.
  A scenario writes the same log in both, held by the gate for the scenarios
  its browser test plays.
- **The gate.** `npm run check` typechecks; compiles every shipped ruleset
  alone and with each of its extensions; compiles every behavior set; loads
  every map and scenario; plays seeds 1 to 3 of every scenario to an end
  other than `limit`, and compares each with its recorded match; and runs
  the tests. It modifies no file.
- **Recorded matches.** Every shipped scenario has a record for each of
  seeds 1 to 40 in `data/matches.jsonl`.
- **Dependencies of core's entry.** Three: a CEL evaluator, a JSON Schema
  checker, and Immer. None touches Node. The YAML parser is the loader's.
- **Content security policy.** The schema checker builds its validators with
  `new Function`, so a page with a strict policy must allow `unsafe-eval`
  for the worker that runs core.
- **Bounds.** A match takes at most `limits.maxDecisions` decisions, and the
  flow at most a million steps between two decisions.

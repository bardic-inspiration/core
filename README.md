# core

A ludematic core: a format that expresses a game's ruleset as pure data, and
one generic runtime that plays any ruleset written in it.

Four rulesets prove the idea, sharing no code, each a YAML file:

- [`rulesets/checkers`](rulesets/checkers/ruleset.yaml): English draughts, a
  closed game.
- [`rulesets/dnd-5e-2024-slice`](rulesets/dnd-5e-2024-slice/ruleset.yaml): a
  D&D 5e (SRD 5.2) combat slice. Three scenarios: a worg against a scout, a
  pack ambush with ten creatures on seven seats, and a duel between two
  spellcasters.
- [`rulesets/holdem`](rulesets/holdem/ruleset.yaml): no-limit Texas Hold 'Em
  for four, with hidden cards.
- [`rulesets/junkyard`](rulesets/junkyard/ruleset.yaml): a sandbox of
  self-assembling bots, with no winner.

## Status

A working prototype. [`SPEC.md`](SPEC.md) is being written from it; the
open [plan issues](https://github.com/bardic-inspiration/core/issues?q=is%3Aopen+label%3Aplan)
and the [issue queue](https://github.com/bardic-inspiration/core/issues) say
what's next. The prototype's brief, decision log, and handoff note are kept
for background in [`archive/`](archive/).

## How this repo is built

This project is built largely by AI coding sessions — some interactive, some
running on a schedule — in small, verifiable steps:

- **The task is the prompt, the PR is the response, review is the evaluation,
  and the squash commit on `main` is the record.**
- [`SPEC.md`](SPEC.md) is the source of truth for what to build; work bigger
  than one PR is sequenced by a plan — a GitHub issue, with its tasks as
  sub-issues.
- Every change passes the same gate — one `check` command, run locally and in
  CI — and a human merges it.
- So `git log` on `main` reads one line per change, with its why in the body.

Agents and humans starting fresh should read [`AGENTS.md`](AGENTS.md) first.

## Run it

```bash
npm install
```

```bash
npm run check
```

`npm run check` is the gate every pull request passes, and CI runs it. It
type-checks, compiles every ruleset alone and with each of its extensions,
compiles every behavior set, loads every map, loads and plays every scenario,
compares the play against the recorded matches, and runs the tests. One test
plays matches in a Web Worker in headless Chromium; outside a cloud session,
install the browser once with `npx playwright install chromium`.

To watch a match, print its event log:

```bash
npm run play -- dnd-5e-2024-slice mage-duel 3
```

```bash
npm run play -- holdem four-handed 1 --quiet
```

The arguments are the ruleset, the scenario, and the seed. Node 22.6 or later
is needed; it runs the TypeScript directly, so there is no build step.

If a change is meant to alter how a match plays, regenerate the records and
commit them with it:

```bash
npm run sim
```

[`data/`](data/README.md) describes the records. The rest of the commands,
and how to contribute, are in [`AGENTS.md`](AGENTS.md) "Commands" and
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## How it fits together

```
kit/patterns.yaml        the pattern kit, as data
rulesets/<id>/           ruleset.yaml, scenarios/, maps/, extensions/, behaviors/
        │
        ▼  compile  (src/compile/)
   Registry              every name resolved, every expression type-checked
        │                behaviors are compiled against it, apart from it
        │
        ▼  Match    (src/runtime/)
   state + event log     seats choose among enumerated legal intents
```

- **Compile.** `compile({ kit, base, extensions })` expands patterns, merges
  layers under the base's `open` list, and resolves the result. Expressions
  are CEL, checked against types generated from the ruleset's own
  declarations. Anything invalid is refused, with every reason listed.
- **Play.** A `Match` runs the ruleset's `flow` on an explicit stack until a
  prompt needs a seat's decision. It enumerates every legal intent for that
  seat; the seat returns one. Every write is an event, and `fold(log)`
  rebuilds the state.
- **Host.** An engine implements six space functions, drives `advance` and
  `submit`, and reads the log. Core runs unchanged in a browser worker, can
  explain a decision, evaluate an expression on any state, and replay or
  fork a match from its log.

Read next:

- [`docs/format.md`](docs/format.md): the ruleset, behavior, map, and
  scenario format, and the log.
- [`docs/host.md`](docs/host.md): what an engine implements and calls: the
  space host's contract, and driving, explaining, replaying, and forking a
  match.

## Layout

| Path | What it holds |
|---|---|
| [`src/format.ts`](src/format.ts), [`src/schemas.ts`](src/schemas.ts) | The authored document shapes and their JSON Schemas. |
| [`src/compile/`](src/compile) | Layers and patterns (`layers.ts`), resolution and static checks (`resolve.ts`), behavior sets (`behaviors.ts`), the registry's types (`program.ts`). |
| [`src/lib/functions.ts`](src/lib/functions.ts) | The function library, and the host-function interface for space. |
| [`src/runtime/`](src/runtime) | State and events, the expression session, the match machine, maps, scenarios, seats, replay and forks, the seeded RNG. |
| [`src/expression.ts`](src/expression.ts), [`src/record.ts`](src/record.ts) | Free-standing expressions over any state, and a match's record from its log. |
| [`src/host/grid.ts`](src/host/grid.ts) | A reference space host for headless play. |
| [`src/runtime/map.ts`](src/runtime/map.ts) | Maps: checked against a ruleset's `space`, and patched with what play has changed. |
| [`src/load.ts`](src/load.ts) | Reads YAML from disk. Core itself never touches the file system. |
| [`kit/`](kit), [`rulesets/`](rulesets) | Pure data. |
| [`scripts/`](scripts) | `play` prints a match, `sim` records matches, `check.ts` is the data half of the gate, `browser` times core in a Web Worker against Node. |
| [`data/`](data) | One record per recorded match. |
| [`tests/`](tests) | The conformance tests, and a tick-driven fixture ruleset. |

## License

MIT; see [`LICENSE`](LICENSE). The 5e slice includes material from the System
Reference Document 5.2 by Wizards of the Coast LLC, licensed under CC-BY-4.0.

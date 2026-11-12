# core

A ludematic core: a format that expresses a game's ruleset as pure data, and
one generic runtime that plays any ruleset written in it. The brief is
[`RPG Core Design Document.md`](RPG%20Core%20Design%20Document.md).

This is the prototype. It proves the central idea with four rulesets that
share no code, each a YAML file:

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

## Run it

```bash
npm install
```

```bash
npm test
```

`npm test` type-checks and runs every test. It proves the brief's three
signs of success:

| Sign of success | Proved by |
|---|---|
| Invalid rules data is refused at compile time. | [`tests/compile.test.ts`](tests/compile.test.ts), [`tests/layers.test.ts`](tests/layers.test.ts) |
| Every ruleset runs to an end state with every seat filled by an AI. | [`tests/determinism.test.ts`](tests/determinism.test.ts) |
| The same seed gives the same log, and replay gives the same final state. | [`tests/determinism.test.ts`](tests/determinism.test.ts) |

To watch a match, print its event log:

```bash
npm run play -- dnd-5e-2024-slice mage-duel 3
```

```bash
npm run play -- holdem four-handed 1 --quiet
```

The arguments are the ruleset, the scenario, and the seed. Node 22.6 or later
is needed; it runs the TypeScript directly, so there is no build step.

## Check a change

```bash
npm run validate
```

This is the check a pull request must pass, and
[the workflow](.github/workflows/validate.yml) runs it. It type-checks,
compiles every ruleset alone and with each of its extensions, compiles every
behavior set, loads every map, loads and plays every scenario, compares the play against the
recorded matches, and runs the tests. One test plays matches in a Web Worker
in headless Chromium; install the browser once with
`npx playwright install chromium`.

If a change is meant to alter how a match plays, regenerate the records and
commit them with it:

```bash
npm run sim
```

[`data/`](data/README.md) describes the records.

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
- [`DECISIONS.md`](DECISIONS.md): the calls made during the build, including
  answers to the brief's open questions.
- [`HANDOFF.md`](HANDOFF.md): what works, what is stubbed, where the build
  departed from the brief, and what comes next.

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
| [`scripts/`](scripts) | `play` prints a match, `sim` records matches, `validate` is the pull-request check, `browser` times core in a Web Worker against Node. |
| [`data/`](data) | One record per recorded match. |
| [`tests/`](tests) | The conformance tests, and a tick-driven fixture ruleset. |

## License

MIT; see [`LICENSE`](LICENSE). The 5e slice includes material from the System
Reference Document 5.2 by Wizards of the Coast LLC, licensed under CC-BY-4.0.

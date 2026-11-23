# core

[![CI](https://github.com/bardic-inspiration/core/actions/workflows/ci.yml/badge.svg)](https://github.com/bardic-inspiration/core/actions/workflows/ci.yml)

A ludematic core: a data format that expresses a game's ruleset as pure data,
and one generic runtime that plays any ruleset written in it. Tabletop RPGs,
board games, card games, and open-ended simulations are all written in the
same format and played by the same runtime, with no game-specific code.

**Status:** internal pre-release, not published to a package registry. What
each release changed is in [`CHANGELOG.md`](CHANGELOG.md).

## Features

- **Rulesets as data.** Kinds, intents, effects, reactions, and the turn
  flow are declared in YAML, with typed [CEL](https://cel.dev) expressions.
  Extensions change only what a ruleset leaves open.
- **Fail closed.** Every document is schema-checked and type-checked when it
  compiles, and refused with every reason listed.
- **Deterministic and replayable.** The same rules, scenario, seed, and
  decisions give the same log. A log folds to the match's state, replays
  entry for entry, and forks at any decision.
- **Hidden information and referees.** Fields can be hidden per seat, and a
  referee seat can author changes and rulings during play.
- **Scripted seats.** Behavior sets score a seat's options, and every
  decision can be explained, gate by gate.
- **Engine-agnostic space.** Core holds the rules of space and asks the
  engine's host for geometry. A reference grid host is included.
- **Runs anywhere.** Core's entry imports nothing from Node, so it runs
  unchanged in a browser or a Web Worker, and writes the same logs there.

## Example rulesets

| Ruleset | Shows |
|---|---|
| [checkers](rulesets/checkers/ruleset.yaml) | A closed game with a forced move and chained moves. |
| [Texas Hold 'Em](rulesets/holdem/ruleset.yaml) | Hidden information, and a scheduler that is neither rounds nor ticks. |
| [D&D 5e combat slice](rulesets/dnd-5e-2024-slice/ruleset.yaml) | Dice, derived stats, reactions, spells, and conditions on a grid. |
| [junkyard](rulesets/junkyard/ruleset.yaml) | An open game: machines built from parts, with no winner. |

## Getting started

Requires Node 22.6 or later. TypeScript runs directly; there is no build
step.

```bash
git clone https://github.com/bardic-inspiration/core
```

```bash
cd core && npm install
```

Play a match and print its event log, by ruleset, scenario, and seed:

```bash
npm run play -- dnd-5e-2024-slice mage-duel 3
```

Run the full check: the typecheck, every ruleset compiled and played against
its recorded matches, and the tests.

```bash
npm run check
```

One test plays matches in headless Chromium. Install it once with
`npx playwright install chromium`.

## Usage

An engine passes parsed documents to core and drives the match:

```ts
import { compile, compileBehaviors, loadScenario, Match, bindSeats } from './core/src/index.ts';

const registry = compile({ kit, base: ruleset, extensions: [] });
const behaviors = compileBehaviors(registry, [behaviorSet]);
const scenario = loadScenario(registry, scenarioDoc, { maps });
const match = new Match(registry, scenario, 'seed-1');

const { outcome, log } = match.run(bindSeats(scenario, behaviors));
```

Core is consumed as TypeScript source, through a bundler or runtime that
compiles TypeScript. The full API is in [`docs/api.md`](docs/api.md).

| Command | Does |
|---|---|
| `npm run play -- <ruleset> <scenario> <seed>` | Plays one match and prints its log. |
| `npm run sim` | Regenerates the recorded matches in `data/`. |
| `npm run browser` | Times every scenario in a browser worker against Node. |
| `npm run check` | The gate CI runs. |

## Project layout

```
src/        core: the compiler, the runtime, the function library, the reference host
kit/        reusable patterns for rulesets
rulesets/   the example rulesets, with their behaviors, maps, and scenarios
data/       recorded matches, checked by the gate
scripts/    play, sim, browser timing, and the check
tests/      the test suites
docs/       what core does
```

## Documentation

- [`docs/`](docs/README.md): the format, the API, the space host, and how a
  match runs.
- [`SPEC.md`](SPEC.md): design not built yet.
- [`AGENTS.md`](AGENTS.md): how work is done in this repo, by people and AI
  agents.

## Contributing

Every change is a pull request with a green check, reviewed and merged by a
person. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) to get set up, and
[`AGENTS.md`](AGENTS.md) before starting.

## License

[MIT](LICENSE). The D&D 5e slice includes material from the System Reference
Document 5.2 by Wizards of the Coast LLC, licensed under
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/).

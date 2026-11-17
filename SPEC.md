# core — Specification

`status: current`

The source of truth for **what to build**. Written in the present tense: it
describes the system as it is on `main`, except where marked
`Planned (#N):`, where `#N` is the plan issue building it. Its history is in
git (`git log -- SPEC.md`), not in this file. How to write and use it:
[`docs/spec-driven-development.md`](docs/spec-driven-development.md).

`SPEC.md` holds the purpose, the invariants, the concepts, and the rules
that cross every area. Each area is specified in a file of its own, which
is part of the spec and is not copied here:

| Read | For |
|---|---|
| [`docs/format.md`](docs/format.md) | The format: how a ruleset, extension, behavior set, map, and scenario are written, and the log's entries. |
| [`docs/host.md`](docs/host.md) | The space host contract, and the API an engine drives a match with. |
| [`docs/spec/decisions.md`](docs/spec/decisions.md) | How a seat's decision is asked for, chosen, and recorded, and how scripted seats choose. |
| [`docs/spec/srd-ruleset.md`](docs/spec/srd-ruleset.md) | The SRD 5.2 ruleset: the document hierarchy, content, characters, monsters, the coverage ledger, and how it is tested. |
| [`data/README.md`](data/README.md) | The recorded matches, and what a record holds. |

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
| Entity | An instance of a kind, with an id. |
| Agent | `Planned (#19):` An entity that decides: a player, a bot, a creature, a unit. It holds knowledge, and exactly one seat owns it. |
| Prop | `Planned (#19):` An entity that never decides and holds no knowledge: a card, a chip, a boulder. |
| State | Entities, the links between them, globals, the ground, the position of the rules' dice, and the seats' streams. |
| Space | A ruleset's declaration of what a map can be, and the two rules the host respects on it. |
| Map | One playing environment for a ruleset: a document of its own, never changed by play. |
| Ground | A map with what a match has written to its mutable layers laid over it. |
| Host | The engine's geometry: six pure functions of one map. |
| Scenario | Who is seated, which entities are in play and where they stand, on which map, and when the match ends. |
| Seat | A place at the match that makes decisions. A referee seat may also author changes and rule that an intent happens. `Planned (#19):` A seat owns any number of agents. |
| Driver | What fills a seat: it is given a decision and returns one of its options. |
| Behavior, behavior set | A behavior scores a seat's options; a behavior set is a document of behaviors compiled against a registry. |
| Prompt | The effect that asks a seat to choose among offered intents. |
| Decision, option | A decision is a seat and its options; an option is an offered intent with every param bound and every gate passed. |
| Match | A registry, a scenario, a seed, and the decisions made; it produces a log. |
| Log | The ordered entries of a match: every write, roll, decision, and signal, setup included. |
| Snapshot | A match at a pending decision, as plain data. |
| Record | A summary of a finished match worked out from its log alone, with a hash of the log. |

## Architecture

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

Every surface outside code or people depend on, and where it is specified.
All but the commands are versioned
([`docs/workflow.md`](docs/workflow.md) "Versioned surfaces").

| Surface | Specified in | Version |
|---|---|---|
| The format: ruleset, extension, kit, behavior set, map, scenario | [`docs/format.md`](docs/format.md) | `format:` in each document; core reads format 2 |
| A ruleset's own declarations | The ruleset | `version:` in its `ruleset.yaml` |
| The space host contract | [`docs/host.md`](docs/host.md) "The space host" | `version` in `package.json` |
| The exported API: everything `src/index.ts` exports | [`docs/host.md`](docs/host.md) "Driving a match" | `version` in `package.json` |
| The log | [`docs/format.md`](docs/format.md) "The log" | Every recorded match's `logHash` |
| The match record | [`data/README.md`](data/README.md) "A record" | With the log |
| The commands | [`AGENTS.md`](AGENTS.md) "Commands" | Unversioned |

Documents are passed to the API parsed, as plain data; core reads no file.

### Point spaces

**Planned ([#21](https://github.com/bardic-inspiration/core/issues/21)):**
this whole section.

A space need not have coordinates. With `grid: points` a map is a counted set
of cells, and how far apart two cells are is the engine's to say. It is the
space for an environment whose geometry is not a grid: passages of text laid
out by meaning, the nodes of a network. Everything a square grid's space has
that does not come from the grid works the same: `layers`, `mutable`,
`blocksMove`, `checks`, `places`, a standard `map`, map documents, and a
scenario's `map` or inline `space`.

Why: an engine with such an environment otherwise presents it as a grid `n`
wide and 1 high and answers the grid's host contract with something else. A
separate concept beside maps would repeat layers, the ground, and the map
document for the sake of one difference, the address of a cell.

#### The format

```yaml
space:
  grid: points
  nearest: 8                    # how many cells `neighbors` gives
  size: { min: 5, max: 5000 }   # how many cells a map may have; either end optional
  layers:
    source: { type: int, default: 0 }
    dealt: { type: bool, default: false, mutable: true }
  blocksMove: "cell.dealt"
```

```yaml
format: 2
map: { id: shelf }
ruleset: { id: hand, version: 0.1.0 }
count: 3060
cells:
  - { at: 0, source: 2 }
places:
  start: { at: 12 }
```

- A cell is one index, from 0 to `count - 1`. In an expression it is
  `cell(i)`, and `c.index` is its index; two cells compare with `==`. In
  plain data (state, the log, a host call) it is `{ index }`. A scenario
  gives a `cell` field as an index or as the name of a place.
- `space.count` is the number of cells.
- A place is one cell, `{ at: index }`.
- A `ground` entry's `at`, and a referee's, is the index.
- Refused at compile time in a point space (`INV-2`): `adjacency`, `corners`,
  `unit`, `increment`, `width`, `height`, and `blocksSight` in `space`;
  `cell(x, y)`, `.x`, `.y`, `.offset`, `.mid`, `lineOfSight`, `space.width`,
  `space.height`, and `space.unit` in an expression; `neighbors` when the
  space declares no `nearest`. In a square grid, `cell(i)`, `.index`,
  `space.count`, and `nearest` are refused the same way.
- Refused by `loadMap`: `rows`, `legend`, `width`, `height`, a place with a
  `size`, a missing `count` or one outside `size`, and an index off the map
  or given twice.

#### The metric

The engine answers one question about a point space, where a grid's host
answers six:

```ts
type Metric = (a: number, b: number) => number;   // two indexes on the map
const scenario = loadScenario(registry, doc, { maps, metric: (map) => myMetric(map) });
```

- The answer is a whole number, 0 or more, in units of the engine's
  choosing. `metric(a, a)` is 0, and `metric(a, b)` equals `metric(b, a)`.
- It is pure: the same map and indexes give the same answer every time.
- It does not depend on the ground. The factory is called once, with the
  starting map, and never again when play writes a cell.
- Core asks only about indexes on the map. An answer that is not a whole
  number of 0 or more stops the match with an error.
- Giving `metric` for a space that is not `points`, or `host` for one that
  is, is refused.

Core answers every space function of an expression from the metric and the
ground as it stands:

| Function | Answers |
|---|---|
| `distance(a, b)` | The metric's answer. |
| `inBounds(c)` | `c` is on the map and does not block movement. |
| `cellAt(c)` | The cell's layer values. |
| `cellsWithin(c, range)` | Every cell for which `inBounds` holds and `distance(c, other) <= range`, `c` itself included when it is in bounds. |
| `neighbors(c)` | The `nearest` cells nearest to `c` for which `inBounds` holds, without `c` itself; fewer when fewer are in bounds. |

`cellsWithin` and `neighbors` answer nearest first, and cells equally near
in ascending index. `distance`, `cellAt`, `cellsWithin`, and `neighbors` of a
cell off the map are an error; `inBounds` is false there.

Why: a set of points has no row order, and the nearest-first order is the
one a ruleset would otherwise sort into. The order reaches the log through a
seat's options, so it is part of the contract (`INV-3`).

Why: the metric is all of the geometry. Blocking and layers are core's
already, so a host that answered the other four questions could only
disagree with core about them, and would have to be built again for every
write.

Without `metric`, core uses its reference metric, which lays the points on a
line in index order: `|a - b|`. A ruleset written for a point space plays
headless on it.

The map a point space loads as, from `loadMap`, `scenario.map`, and
`scenario.mapAt(state)`, is `{ id?, grid: 'points', nearest?, count,
defaults, cells: [{ index, values }], blocksMove: [{ index }], places:
{ name: { index } } }`, with `cells` and `blocksMove` in ascending index.

`checkMetric(metric, map)` asks the metric about every pair of cells and
returns each answer that breaks the rules above. An engine's metric should
come back with none.

## Behavior

The rules that hold across areas. A surface's own rules are in its file.

### Compiling

- Every document is checked against a schema, then resolved against what it
  refers to. A document with an unknown key, an unknown name, an ill-typed
  expression, or a `format` other than the one core reads is refused.
- A refusal is a `CompileError` listing every reason found, each with the
  path of what it refuses, not only the first (`INV-2`).
- An extension may change only what its base lists under `open`. Two
  declarations that disagree are a conflict, not a merge.
- An extension, a behavior set, a map, and a scenario each name the ruleset
  `id` and `version` they are written for. The ruleset satisfies a wanted
  version when its major number is the same and it is not older; below
  1.0.0, the minor number must be the same too. Anything else is refused.
- An expression is typed and cannot loop. It reads and writes nothing
  outside the registry's addresses.
- A map is refused when it fails any of its ruleset's criteria, whether it
  is a document or written inline in a scenario. A refused map is never
  handed to a host.
- A scenario's entities are instances of the ruleset's kinds, made as play
  makes them: every field is typed, and every kind check holds on the
  starting state.

### Playing

- A match starts from its seed and its scenario's setup, both written to the
  log, then runs the ruleset's `flow`.
- The flow runs until a prompt needs a decision
  ([Decisions](#decisions)), and goes on when the decision is taken.
- A match ends in one of three ways, each an `end` entry:
  - with the outcome of the first scenario end condition that holds. The
    conditions are checked in order, once after setup and then after every
    write a rule or a referee makes;
  - as `{ result: complete }` when the flow runs out;
  - as `{ result: limit }` when a decision is needed and the match has
    already taken the scenario's `limits.maxDecisions` (10,000 when it gives
    none).
- Nothing runs after a match has ended.
- A rule that cannot be carried out stops the match with a `RuleError`
  saying why. Among them: a `create` whose instance fails a kind check, a
  value of the wrong type, a write to a cell off the map or one that leaves
  the cell failing a check, a read of a value hidden from the deciding seat,
  a `roll` of fewer than zero dice or of a die with no sides, a `done`
  outside any prompt, and a flow that runs a million steps without reaching
  a decision.
- `Planned (#19):` An intent chosen at a prompt can return a value to the
  effects that prompted it, and a reaction to what emitted its signal.
  Why: without it, everything a reaction may change in flight is an entity
  made and destroyed for the purpose, at two log entries each.
- A kind's checks are enforced when an instance is created and after a
  referee's changes. A rule's `set` does not run them; `Match.violations()`
  reports every check that fails in the current state.
- Chance comes only from seeded streams: one for the rules' dice, keyed by
  the match seed, and one for each seat's driver, keyed by the seed and the
  seat. How a seat decides never moves the dice (`INV-3`).

### Decisions

Every decision in a match is asked, chosen, and recorded the same way,
whether the flow asks for a turn or an intent's effects ask for a reaction:
the runtime enumerates the deciding seat's options, a driver returns the
index of one, and the choice is one `intent` entry in the log. The contract,
and how scripted seats choose, is in
[`docs/spec/decisions.md`](docs/spec/decisions.md).

### Hidden information

- A field or a global may declare who sees it. The rules see everything.
- A seat's options, and a behavior's scores for them, are worked out through
  that seat's view. Reading a hidden value there is an error, not a blank.
- A derived value is hidden from a seat whenever anything it reads is.
- A referee seat sees everything.
- The log is not filtered by seat, and the seats' streams are in every
  seat's view.
- `Planned (#19):` What is visible is worked out for an agent, not for a
  seat, and it is that agent's awareness: the part of the current state it
  can perceive. A decision's options and scores are worked out through the
  deciding agent's view. A seat's own view is everything any of its agents
  is aware of ([`docs/spec/decisions.md`](docs/spec/decisions.md)
  "Awareness").

### Referees

- A scenario marks a seat as a referee. Only a referee may author changes
  or make rulings, and only while the match has not ended.
- An authored change is a create, a set, a destroy, a link, an unlink, or a
  write to a mutable cell layer. Each must be something the ruleset
  declares, typed as it declares it. The changes of one call are applied
  together or not at all.
- A ruling makes an intent happen for a seat, whatever is on offer. Its
  params are type-checked; its gates are not evaluated.
- A change or a ruling made while a decision is pending sets that decision
  aside; the prompt asks again afterwards.
- Every entry a referee authors carries `by`, the referee's seat.

### The log, replay, and forks

- Each write, roll, decision, and signal is one entry, numbered by `seq`
  from 0. An entry made under an intent or a signal carries that entry's
  `seq` as `cause`.
- A write that changes nothing in a cell layer makes no entry.
- `fold` of a log, or of any prefix of it, gives the state at that point,
  the seats' streams included (`INV-4`).
- `replay` puts a log's decisions, referee changes, and rulings back through
  the rules, each where the log has it. It fails at the first entry the
  rules would now write differently, and at a recorded decision that is no
  longer an option, naming the entry.
- `fork` returns the match as it stood when a given decision was about to be
  made. Choosing the same again plays out the same match. An entry that is
  not a decision cannot be forked at.
- A snapshot is taken while a decision is pending. A match restored from
  one plays on as the original would have. `replay` and `fork` may start
  from a snapshot of the same log.
- A record is worked out from a log alone, and only from the log of a match
  that has ended. It holds nothing that differs between two runs of the same
  seed.
- `Planned (#19):` The log's first entry names what wrote it: core's
  version, the ruleset's id and version, and a hash of the map. `replay`
  refuses a log that names anything other than what it is given, before it
  runs a rule.
  Why: a log from other rules otherwise fails at the first entry that
  differs, which says nothing of the cause.
- `Planned (#19):` A match may be run with a debug override that gives
  the results of its rolls in place of the seeded stream. A roll made under
  it is marked in its log entry, and `replay` takes a marked roll from the
  log, so such a log replays from itself alone (`INV-3`, `INV-4`).
  Why: an unmarked roll would look like a seeded one and fail replay.

### The ground

- A map document is never changed. A match holds its writes to mutable
  layers in its state; the ground is the map with those laid over it.
- Expressions and the host answer from the ground as it stands, so a write
  takes effect from the next expression on.
- A host is a pure function of one map. It is never told of a change: core
  builds a host from each ground a match passes through.
- `scenario.mapAt(state)` returns the same object for the same
  `state.ground`.
- Two matches on one map do not see each other's writes.

### Work in proportion to change

`Planned (#19):` When one thing changes, core aims to do work in proportion
to that change, not to the size of what surrounds it. State that did not
change, and anything derived from it, is not rebuilt, copied, or logged
again. This is the goal optimization is held to, not an invariant: it binds
the cases listed here, each of which a test can count.

- **The ground.** A grid's host answers for the geometry of the grid alone,
  and is built once for a map. Blocking and layers are core's, laid over the
  host's answers from the ground as it stands, so a write to one cell builds
  nothing again. The rules under [The ground](#the-ground) still hold,
  except that a host is no longer built from each ground.
  Why: a host that answers blocking can only disagree with core about it,
  and has to be built again for every write. A point space's metric already
  stands apart from the ground in this way ([Point spaces](#point-spaces)).
- **Globals.** A write to one key of a map-typed global logs that key, as a
  write to an entity's field does, not the whole map.
- **Derived values.** A derived value is worked out again only when
  something it reads has changed.
- **End conditions.** An end condition is evaluated again only when
  something it reads has changed.
- **Decisions.** An agent's awareness, memory, and predictions are worked
  out again only for what has changed
  ([`docs/spec/decisions.md`](docs/spec/decisions.md) "Scoring").
- Each of these is held by a test that counts the work done, and names this
  section.

### Limits

What core does not do today.

- Space is a two-dimensional square grid, or a plane with no grid, until
  [Point spaces](#point-spaces) are built. `space.vertical` is refused.
- A plane with no grid has a size and places. No rule can ask a spatial
  question of it, and no host is built for it.
- The two space rules read one cell's layers and nothing else.
- An intent chosen at a prompt returns no value to the effects that
  prompted it, and a signal returns none to what emitted it.
- A log does not hold its map; it holds what play changed on it.
- A write to one key of a map-typed global is logged as the whole map, and
  a write to one cell builds the ground and its host again, until
  [Work in proportion to change](#work-in-proportion-to-change) is built.

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
- **Cost of a change.** `Planned (#19):` in proportion to what changed, for
  the cases under [Work in proportion to change](#work-in-proportion-to-change),
  held by tests that count.
- **SRD coverage.** `Planned (#19):` every combat rule unit of the SRD 5.2
  has a status in the ledger
  ([`docs/spec/srd-ruleset.md`](docs/spec/srd-ruleset.md) "Coverage").

## Open questions

Undecided, and **not contract** — don't build against these; resolve one by
editing the spec, then delete it here. An area's open questions are in its
file.

- **Where may a match end?** End conditions are checked after every write,
  so one can hold for a moment in the middle of a rule, and a ruleset with
  such moments has to give its scenarios a marker to wait for. A checkpoint
  in the flow, or conditions tied to a signal, would say where instead. A
  checkpoint effect could also be where kind checks are enforced and
  awareness is worked out again, and give core a unit to count that a
  ruleset means something by: a scenario's limit on checkpoints is a limit
  on turns, where `limits.maxDecisions` only bounds the match.
- **Should a kind's checks hold after every write?** Today a rule's `set`
  can leave an entity failing a check without stopping the match.
- **Should the log be filtered by seat?** A seat's view hides state, but
  not the log, nor the seats' streams.
- **Which run-time failures belong at compile time?** A cycle among derived
  values, a `done` outside a prompt, and a procedure that recurses through a
  signal without bound are all found only when they run.
- **Which questions does a geometry-only grid host answer?** `distance`
  and the adjacency of two cells are geometry. `lineOfSight` needs the
  cells that block sight: the host could give the cells a line crosses and
  leave the blocking to core, or be handed the blocking to ask about.
- **Is ruleset-agnostic design an invariant of its own**, or a clause of
  `INV-1`? `INV-1` binds the runtime's code, not the concepts core is
  designed around, and the 5e ruleset is the largest thing shaping them. A
  testable form: a mechanism enters core only when two shipped rulesets of
  different genres use it, and no core concept is named for a genre.
- **What are the performance budgets, as numbers?** The target is an
  ordinary web game: a browser on mid-range hardware, with no backend.
  Candidates to measure and bound: the time a scripted decision takes, the
  time a ruleset takes to compile when a page loads, the size of core's
  bundle, and the memory a match holds. Most of the work is in reads
  (enumerating options, scoring them), not in writes.
- **How does an intent or a reaction return a value?** How the value is
  declared and typed, and what the returns of several reactions to one
  signal combine to.
- **May an engine answer `cellsWithin` and `neighbors` of a point space
  itself**, for a map too large to scan with the metric one pair at a time?

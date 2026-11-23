# core — Specification

Design that isn't built yet: what to build next. What is built is described
in [`docs/`](docs/README.md), and the two never overlap. A PR that builds part
of this file describes it in `docs/` and deletes it here, and a release
leaves here only what it did not build
([`AGENTS.md`](AGENTS.md) "Docs and the spec"). How to write and use it:
[`docs/spec-driven-development.md`](docs/spec-driven-development.md).

Every section names the plan issue that builds it. Plan #19 builds v2.0.0;
plan #21 is not yet tied to a version. The rules the design must keep are
[`docs/architecture.md`](docs/architecture.md) "Invariants", and the nouns it
uses are defined in its "Concepts".

| Read | For |
|---|---|
| [`spec/decisions.md`](spec/decisions.md) | The decision model: explaining a choice, scoring by agents, decisions with large ranges, selection, and path distance. |
| [`spec/srd-ruleset.md`](spec/srd-ruleset.md) | The SRD 5.2 ruleset: the document hierarchy, content, characters, monsters, the coverage ledger, and how it is tested. |

## Agents and props

Plan: [#19](https://github.com/bardic-inspiration/core/issues/19).

| Term | Meaning |
|---|---|
| Agent | An entity that decides: a player, a bot, a creature, a unit. It holds knowledge, and exactly one seat owns it. |
| Prop | An entity that never decides and holds no knowledge: a card, a chip, a boulder. |
| Seat | As today ([`docs/architecture.md`](docs/architecture.md) "Concepts"), and a seat owns any number of agents. |

- What is visible is worked out for an agent, not for a seat, and it is
  that agent's awareness: the part of the current state it can perceive. A
  decision's options and scores are worked out through the deciding agent's
  view. A seat's own view is everything any of its agents is aware of
  ([`spec/decisions.md`](spec/decisions.md) "Awareness").

## Returned values

Plan: [#19](https://github.com/bardic-inspiration/core/issues/19).

An intent chosen at a prompt can return a value to the effects that
prompted it, and a reaction to what emitted its signal.
Why: without it, everything a reaction may change in flight is an entity
made and destroyed for the purpose, at two log entries each.

## Log metadata

Plan: [#19](https://github.com/bardic-inspiration/core/issues/19).

The log's first entry names what wrote it: core's version, the ruleset's id
and version, and a hash of the map. `replay` refuses a log that names
anything other than what it is given, before it runs a rule.
Why: a log from other rules otherwise fails at the first entry that differs,
which says nothing of the cause.

## The roll override

Plan: [#19](https://github.com/bardic-inspiration/core/issues/19).

A match may be run with a debug override that gives the results of its rolls
in place of the seeded stream. A roll made under it is marked in its log
entry, and `replay` takes a marked roll from the log, so such a log replays
from itself alone (`INV-3`, `INV-4`).
Why: an unmarked roll would look like a seeded one and fail replay.

## Work in proportion to change

Plan: [#19](https://github.com/bardic-inspiration/core/issues/19).

When one thing changes, core aims to do work in proportion
to that change, not to the size of what surrounds it. State that did not
change, and anything derived from it, is not rebuilt, copied, or logged
again. This is the goal optimization is held to, not an invariant: it binds
the cases listed here, each of which a test can count.

- **The ground.** A grid's host answers for the geometry of the grid alone,
  and is built once for a map. Blocking and layers are core's, laid over the
  host's answers from the ground as it stands, so a write to one cell builds
  nothing again. The rules under [`docs/matches.md`](docs/matches.md) "The ground" still hold,
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
  ([`spec/decisions.md`](spec/decisions.md) "Scoring").
- Each of these is held by a test that counts the work done, and names this
  section.
- **Cost of a change** joins the quality bars: in proportion to what
  changed, for the cases above, held by tests that count.

## SRD coverage

Plan: [#19](https://github.com/bardic-inspiration/core/issues/19).

Every combat rule unit of the SRD 5.2 has a status in the ledger
([`spec/srd-ruleset.md`](spec/srd-ruleset.md) "Coverage"), and this joins the
quality bars.

## Point spaces

Plan: [#21](https://github.com/bardic-inspiration/core/issues/21).

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

### The format

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

### The metric

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

## Open questions

Undecided, and **not contract**: don't build against these. Resolve one by
editing the spec, then delete it here. An area's open questions are in its
file. Some ask about behavior that is built; their answer is written here as
design, and moves to `docs/` when it is built.

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

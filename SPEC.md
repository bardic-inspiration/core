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

### Point spaces

**Planned ([#16](https://github.com/bardic-inspiration/core/issues/16)):**
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

<!-- TEMPLATE: rules, state transitions, and error cases, at the precision a
test can be written from. When a rule needs a `Why:` line, see
docs/spec-driven-development.md "Writing it". -->

## Quality bars

<!-- TEMPLATE: budgets as numbers — latency, size, supported platforms,
security posture. -->

## Open questions

Undecided, and **not contract** — don't build against these; resolve one by
editing the spec, then delete it here.

- Whether an engine may also answer `cellsWithin` and `neighbors` of a point
  space itself, for a map too large to scan with the metric one pair at a
  time.

# Hosting core

What an engine must do to run core: implement the space host, and drive a
match. Everything named here is exported from [`src/index.ts`](../src/index.ts),
and nothing reachable from it touches Node, so it runs as it is in a browser
or a Web Worker ([Running in a browser](#running-in-a-browser)).

## The space host

Core holds the rules of space and asks the host for the geometry. The host is
six functions ([`SpaceHost`](../src/lib/functions.ts)). An expression calls
them by name; core converts the arguments and results.

A cell is `{ x, y }`, both integers, with `(0, 0)` at one corner of the map,
`x` running to `width - 1` and `y` to `height - 1`. A distance or a range is
an integer in **game units**: `unit` per cell, as the ruleset declares
(5 for 5e's feet, 1 when it declares none).

| Function | Arguments | Returns |
|---|---|---|
| `inBounds(cell)` | Any cell, on the map or off it. | `true` when the cell is on the map and does not block movement: a place something can be. |
| `distance(a, b)` | Any two cells. | The steps between them times `unit`. With adjacency 8 a diagonal step counts as one, so steps are `max(|dx|, |dy|)`; with adjacency 4 they are `|dx| + |dy|`. What lies between is ignored: this is not a path length. |
| `neighbors(cell)` | Any cell. | The cells adjacent to it for which `inBounds` holds, without the cell itself. When the map's `corners` is `closed`, a diagonal neighbour is left out if either of the two cells beside the step blocks movement. The edge of the map is not a corner. |
| `cellsWithin(cell, range)` | Any cell; a range in game units, 0 or more. | Every cell for which `inBounds` holds and `distance(cell, other) <= range`. The cell itself is included when it is in bounds. A range that is not a whole number of cells reaches as far as the whole cells within it. |
| `lineOfSight(a, b)` | Any two cells. | `false` when a cell that blocks sight lies strictly between them. The two end cells never break the line, and a cell is always in sight of itself and of a cell adjacent to it. |
| `cellAt(cell)` | A cell on the map. Core refuses a cell off the map before asking. | The cell's layer values: an object with every declared layer, each a number, boolean, or string. |

Three things hold for all of them:

- **Pure.** The same map and arguments give the same answer every time. A
  host keeps no state between calls and reads nothing but the map.
- **Ordered.** `neighbors` and `cellsWithin` return cells in row order:
  ascending `y`, then ascending `x`. The order is part of the contract,
  because it decides the order of a seat's options, and that reaches the log.
  A host that answers in another order plays different matches from the same
  seed.
- **Total.** No function throws for a cell off the map. `inBounds` is false
  there, `neighbors` and `cellsWithin` leave such cells out, and `distance`
  and `lineOfSight` answer as if the grid went on.

### The map

The host does not read the ruleset or evaluate a rule. When a map loads, by
itself (`loadMap`) or as part of a scenario, core works it out and hands it
over as plain data
([`SpaceMap`](../src/lib/functions.ts)):

| Field | Holds |
|---|---|
| `id` | The map document's id. Absent when the map was written inline in a scenario. |
| `grid`, `adjacency`, `unit` | The ruleset's grid: `square`, 4 or 8, and game units per cell. `grid` is `none` for a plane with no grid: such a map has a size and places, and no host is built for it. |
| `corners` | `open` or `closed`: whether a diagonal step may pass the corner of a cell that blocks movement. It changes `neighbors` and nothing else; `distance` and `cellsWithin` still count cells by the shortest route. |
| `width`, `height` | The map's size in cells. |
| `defaults` | The layer values of every cell not listed in `cells`. |
| `cells` | The cells the map gives values to: `{ x, y, values }`, every layer filled in. |
| `blocksMove`, `blocksSight` | The cells the ruleset's two space rules hold for, as `{ x, y }`, in row order. |
| `places` | Named places, by name: `{ x, y }`, with a `width` and `height` when it is an area. In cells on a grid, in game units without one. |

```ts
const scenario = loadScenario(registry, doc, { host: (map) => myGeometryHost(map) });
```

### When play changes the map

A ruleset may let play write a cell's layers (`mutable` in
[`format.md`](format.md#what-play-may-change)). The host stays pure all
the same: it is never told of a change. When a match writes a cell, core
lays the match's changes over the map, works the two blocking rules out
again for the cells that changed, and calls the host factory with that
map. A host is therefore a function of one map and nothing else, and the
factory is called once for each ground a match passes through, the
starting map included. A host that is costly to build should build from
the map it is given without assuming it is the first.

`scenario.mapAt(state)` is the map as it stands in any state: for the
current one, or for `fold(log.slice(0, n))` when scrubbing. It returns the
same object for the same `state.ground`, so it can be compared by identity
to tell whether the board needs drawing again.

`scenario.map` is the same data as the host was first given, for drawing. `loadMap(registry, mapDoc)`
gives it for a map document without a scenario: enough to draw a board, or to
build a host and ask it questions, before anything stands on it. The map is
all a view needs for the ground: the size, each cell's layer values, and
where movement and sight are blocked. What the values look like is the
view's own. Without `host`, core uses its
reference host ([`src/host/grid.ts`](../src/host/grid.ts)), which is also the
worked example of this contract. Its line of sight is a plain walk along the
line; a host with better geometry may answer `lineOfSight` differently, and
then plays different matches, on purpose.

`compareHosts(host, reference, map)` asks both hosts every question over a
map and a margin around it and returns each answer that differs. An engine's
host that is meant to agree with the reference should come back with none.

## Driving a match

```ts
const registry = compile({ kit, base, extensions });        // plain data in
const behaviors = compileBehaviors(registry, [defaults, variant]);
const scenario = loadScenario(registry, scenarioDoc, { maps });   // the map documents, by id
const match = new Match(registry, scenario, seed);

match.run(bindSeats(scenario, behaviors));                   // to the end, headless
```

Or one decision at a time: `advance()` runs to the next decision and returns
it (the seat and its legal options), and `submit(index)` takes it. A human
seat is driven the same way. `step(seats)` does both with a driver.

| Call | Gives |
|---|---|
| `match.log`, `match.state` | The log so far and the state it folds to. `fold(log.slice(0, n))` is the state at any earlier point. |
| `match.view(seat)` | The state as a seat may know it. |
| `match.explain()` | Why the pending decision offers what it does (below). |
| `match.scores(behavior, seat, options)` | A behavior's utility for each option. |
| `match.snapshot()`, `Match.restore(...)` | The match as plain data at a decision, and back. |
| `match.author(...)`, `match.adjudicate(...)` | A referee seat's changes and rulings. A change may be `{ ground: { at, layer, value } }`, a write to a mutable layer. |
| `scenario.mapAt(state)` | The map as it stands in a state, with what play has changed. |
| `summarize(registry, scenario, log, drivers)` | The match's record, from its log alone ([`data/README.md`](../data/README.md)). |

### Explaining a decision

`match.explain()` returns, for the pending decision, every candidate binding
of every offered intent, legal or not:

- `intents[].domains`: each evaluation of a param's `in` list, with the
  params bound before it (`given`), its size, and the host calls it made.
- `intents[].candidates`: each binding, whether it is `legal`, its index
  among the decision's options when it is, and every gate in order: its
  source, `pass`, `fail`, or `error`, and the host calls it made.

A host call is `{ fn, args, result }` in plain values, such as
`{ fn: 'lineOfSight', args: [{ x: 2, y: 6 }, { x: 9, y: 6 }], result: false }`.
A gate that reads a derived value is shown the calls behind that value. Every
gate is evaluated, also past the first that fails; one that cannot be
evaluated then (it relied on an earlier gate holding) is an `error` with its
message. The legal candidates are exactly the decision's options, in order.
Explaining changes nothing in the match.

### Expressions of your own

```ts
const bloodied = compileExpression(registry, 'all.creature.filter(c, c.hp * 2 <= c.hpMax).size()');
bloodied.evaluate(match.state, scenario);                            // on any state
bloodied.evaluate(fold(log.slice(0, seq)), scenario);                // at any point of a log
const big = compileExpression(registry, 'amount >= target.hpMax / 2', { vars: { target: 'creature', amount: 'int' }, expect: 'bool' });
big.evaluate(state, scenario, { vars: { target: 'worg', amount: 14 } });   // e.g. a signal's args
```

The expression gets the checks a ruleset's own get, and is refused with a
`CompileError`. `vars` declares extra variables by type; a signal's arguments
are the usual case, and `registry.signals` has their types. With
`{ viewer: seat }` it is evaluated through that seat's view, where reading
what the seat cannot see is an error.

### Replay and forks

`replay(registry, scenario, log)` puts a log back through the rules: every
decision is chosen again, and every referee change and ruling is made again
where the log has it. The rules must answer entry for entry as the log says;
the first entry that differs is an error naming it.

`fork(registry, scenario, log, seq)` returns the match as it stood when the
decision at `seq` was about to be made. Call `advance()` and choose
differently, bind another behavior, or author a change, and it is a new
branch. Choosing the same again plays out the same match, because the seats'
streams stand where they stood. Both take `{ from: snapshot }` to start from
a snapshot of the same log instead of the beginning.

## Running in a browser

Core's entry imports nothing from Node, and reading files is left to
[`src/load.ts`](../src/load.ts), which is not part of it. A page parses the
YAML itself and passes plain data to a worker;
[`scripts/browser/worker.ts`](../scripts/browser/worker.ts) is a complete
example. `npm run validate` bundles it for the browser and runs it in
headless Chromium, and `npm run browser` plays every scenario there and in
Node and prints the timings.

Two things to know when embedding:

- The schema checker (Ajv) builds its validators with `new Function`. A page
  with a strict content security policy must allow `unsafe-eval` for the
  worker, until the validators are precompiled.
- A match is not transferable while it runs, but `snapshot()` and the log are
  plain data and cross `postMessage` as they are.

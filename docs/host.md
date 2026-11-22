# The space host

What an engine implements for core: the geometry of a map. Everything named
here is exported from [`src/index.ts`](../src/index.ts); how an engine drives
a match is in [`api.md`](api.md).

## The contract

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

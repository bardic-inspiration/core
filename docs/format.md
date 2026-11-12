# The format

How a ruleset, an extension, a behavior set, a map, and a scenario are written. This
is format version 2 (`format: 2`); each ruleset carries its own `version`.
Format 2 moved behaviors out of rulesets and replaced a scenario's list of
blocked cells with cell layers.

Every document is YAML, checked against a JSON Schema
([`src/schemas.ts`](../src/schemas.ts)) and then resolved. Unknown keys,
unknown names, and ill-typed expressions are all refused. The shipped
rulesets are the worked examples:

| Ruleset | Shows |
|---|---|
| [checkers](../rulesets/checkers/ruleset.yaml) | A closed game: fixed seats, a forced move, a chained move. |
| [5e slice](../rulesets/dnd-5e-2024-slice/ruleset.yaml) | Dice, derived stats, relations, reactions during resolution, spells, lasting effects. |
| [hold 'em](../rulesets/holdem/ruleset.yaml) | Hidden information, and a scheduler that is neither rounds nor ticks. |
| [junkyard](../rulesets/junkyard/ruleset.yaml) | An open game: ticks, state that grows and shrinks, no winner. |

## The model

A ruleset declares what may exist and what may happen. State is instances of
what it declares.

| Concept | Declared under | Meaning |
|---|---|---|
| Kind | `kinds` | A type of entity: its stored `fields`, its `derived` values, and the `checks` every instance must pass. |
| Relation | `relations` | A link between two kinds. Composition is entities joined by links. |
| Global | `globals` | A fact about the match itself, read as `game.<name>`. |
| Enum, table | `enums`, `tables` | Closed vocabularies and constant lookup data. |
| Intent | `intents` | Something a seat may choose to do: params, gates, effects. |
| Menu | `menus` | A named list of intents a prompt can offer. |
| Signal, reaction | `signals`, `reactions` | A named moment, and effects that run when it is emitted. |
| Procedure | `procedures` | A reusable effect list with params and returns. |
| Flow | `flow` | The scheduler: the effect list the match runs from the start. |
| Space | `space` | What is spatially possible, and what each cell holds: the kind of map the ruleset is played on. |

A map, the playing environment itself, is not part of a ruleset either. The
ruleset's `space` says what a map is made of, and a map is a document that
fills one in ([Maps](#maps)).

Behaviors, the utility scores an AI seat chooses by, are not part of a
ruleset. They are a document of their own, compiled against it
([Behaviors](#behaviors)).

### Types

`int`, `number`, `bool`, `string`, `seat`, `cell`, any enum name, any kind
name (a reference to an entity), `list<T>`, and `map<K,V>` with a string,
seat, or enum key. A map keyed by an enum must hold every key.

### Addresses

Every fact has an address: `creature.hp`, `creature.ability.str`,
`creature.mod.dex`, `creature.wields`, `game.round`, `tables.hitDie`. The
compiled registry lists them all (`registry.addresses`); nothing outside that
list can be read or written.

## Expressions

Expressions are [CEL](https://github.com/google/cel-spec). They are typed and
cannot loop. Each is checked at compile time against the variables in scope.

Always in scope:

| Variable | Holds |
|---|---|
| `game` | The globals. |
| `all` | Every live entity by kind: `all.creature` is a list. |
| `tables` | The tables. |
| `seats` | The match's seat ids. |
| `space` | `width`, `height`, `unit`. |

An entity reads its fields, derived values, and relations as members:
`actor.hp`, `actor.mod['dex']`, `actor.wields` (a list), and `actor.id`.
Two entities of a kind compare with `==`.

Integers and decimals do not mix; convert with `double(x)`. `/` on integers
truncates toward zero, so a rule that rounds down says `floorDiv(a, b)`.

### Function library

| Group | Functions |
|---|---|
| Math | `floorDiv` `ceilDiv` `abs` `sign` `min` `max` `clamp` `floor` `ceil` `round` |
| Lists | `.sum()` `.min()` `.max()` `.first()` `.distinct()` `sortBy(list, keys)` `range(n)`, plus CEL's `.map` `.filter` `.exists` `.all` `.size()` and `cel.bind` |
| Cells | `cell(x, y)` `.offset(dx, dy)` `.mid(other)` `==` |
| Space (host) | `inBounds(cell)` `distance(a, b)` `neighbors(cell)` `cellsWithin(cell, range)` `lineOfSight(a, b)` `cellAt(cell)` |

The host functions are answered by the engine. `distance` and `range` are in
the ruleset's units (`space.unit` per cell). What each must answer, exactly,
is in [`host.md`](host.md).

## Kinds

```yaml
kinds:
  creature:
    fields:
      speed: int                          # required
      defeated: { type: bool, default: false }
      hp: { type: int, init: self.hpMax } # computed once, at creation
    derived:
      mod: { type: "map<ability,int>", each: a, value: "floorDiv(self.ability[a] - 10, 2)" }
    checks:
      - { that: "self.speed % 5 == 0", message: speed must be a multiple of 5 feet }
```

A derived value is never stored. With `each`, the expression is evaluated
once per key of the map's enum, with the key bound to that name. Checks run
when an instance is created (by a scenario, a `create` effect, or a referee),
and `Match.violations()` runs them over the whole state.

### Hidden information

A field or a global may say who sees it:

```yaml
kinds:
  player:
    fields:
      hole:
        type: list<int>
        default: []
        visible: "viewer == self.seat || (game.street == 'showdown' && !self.folded)"
globals:
  deck: { type: list<int>, default: [], visible: false }
```

`visible` is a bool expression over `viewer`, the seat looking, and `self` on
a kind's field. Without it, every seat sees the value. The rules themselves
always see everything.

A seat's legal intents and a behavior's scores are worked out through that
seat's view. Reading a value hidden from the seat is an error there, not a
blank: a gate or a score that depends on a secret stops the match with the
address it tried to read. A derived value is hidden whenever anything it
reads is. `Match.view(seat)` returns the state with the hidden values left
out; a referee seat sees all of it. The event log is not filtered.

## Relations

```yaml
relations:
  wields: { from: creature, to: weapon, inverse: wielders }
```

`creature.wields` lists the weapons; `weapon.wielders` lists the creatures.
A reference field is always required, so an optional association is a
relation.

## Intents

```yaml
intents:
  attack:
    params:
      actor: creature                                # given by the prompt
      weapon: { type: weapon, in: actor.wields }     # enumerated
      target: { type: creature, in: "all.creature.filter(c, c.side != actor.side)" }
    gate:
      - "distance(actor.pos, target.pos) <= weapon.maxRange"
    effects: [...]
```

A param with `in` is enumerated over that list; later params may depend on
earlier ones. A param without `in` is given by the prompt. `seat`, the
deciding seat, is always bound. The legal intents are every binding for which
all gates hold.

## Effects

The closed set. Each effect is one of these.

| Effect | Does |
|---|---|
| `set: { actor.hp: expr, game.round: expr }` | Writes fields, in order. A map entry is `actor.ability.str`, or `actor.slots[expr]` when the key is computed. |
| `at: cell`, `set: { layer: expr }` | Writes layers of one cell of the map. Each layer must be declared `mutable`. |
| `create: { kind, as, fields }` | Makes an instance and binds it. |
| `destroy: expr` | Removes an entity and its links. |
| `link` / `unlink: { rel, from, to }` | Joins or separates two entities. |
| `roll: { as, n, d }` | Rolls `n` dice of `d` sides from the seeded stream and binds the sum. |
| `let: { name: expr }` | Binds a variable, or assigns one already bound. |
| `if: expr`, `then`, `else` | Branches. |
| `each: name`, `in`, `do` | Runs once per item. An entity destroyed meanwhile is skipped. |
| `while: expr`, `do` | Loops. |
| `prompt: { seat, with, offer, repeat, ifNone }` | Asks a seat to choose among the offered intents. |
| `done: true` | Ends the nearest repeating prompt once the current intent finishes. |
| `emit: signal`, `with` | Emits a signal; its reactions run in declaration order. |
| `call: procedure`, `with`, `as` | Runs a procedure; `as` maps local names to its returns. |

The first six are the writes, and each becomes one event in the log, as does
a `roll`. The rest only steer.

### Prompts and the flow

A prompt is how any seat decides anything. The flow uses it for turns; an
intent's effects use it for a choice during resolution, such as a reaction.

```yaml
flow:
  - while: true
    do:
      - each: actor
        in: "sortBy(all.creature, all.creature.map(c, -c.initiative))"
        do:
          - emit: turn.start
            with: { actor: actor }
          - prompt: { seat: actor.seat, with: { actor: actor }, offer: [turn], repeat: true }
```

`offer` lists intents or menus. With `repeat`, the seat is asked again after
each intent resolves, until an intent runs `done` or nothing is legal.
`ifNone` runs when nothing was legal the first time.

The flow is the scheduler, and the shipped rulesets write three kinds. Rounds
of turns are the loop above. Ticks are the same shape with one prompt per
entity per pass ([junkyard](../rulesets/junkyard/ruleset.yaml)). A betting
round is a `while` over a condition, "someone still owes a decision", that
picks who is next each time round
([hold 'em](../rulesets/holdem/ruleset.yaml)).

### Things in flight

A signal returns nothing, and an intent chosen at a prompt cannot hand a
value back to the effects that asked. When a reaction must change something
that is still being resolved, that thing is made an entity for as long as it
is in flight:

```yaml
procedures:
  harm:
    params: { target: creature, amount: int, damageType: damageType }
    do:
      - create: { kind: wound, as: wound, fields: { target: target, amount: amount, damageType: damageType } }
      - emit: wound.incoming          # any reaction may change wound.amount
        with: { wound: wound }
      - let: { dealt: wound.amount }
      - destroy: wound
      - emit: hp.lose
        with: { target: target, amount: dealt }
```

The 5e slice does this for damage (`wound`, which Resistance halves) and for
spells (`casting`, which a Counterspell stops). Because the reaction hangs on
a signal, an extension can add one without touching the procedure. A prompt
passes facts the other way through `with`: the Shield reaction is given the
attack roll it would have to beat.

## Behaviors

A behavior set is its own document, kept apart from the rules it plays:

```yaml
format: 2
behaviorSet: { id: default }
ruleset: { id: dnd-5e-2024-slice, version: 0.4.0 }
behaviors:
  skirmisher:
    scores:
      attack: "weapon.ranged ? 100 : 80"   # sees the intent's params
      endTurn: 1
    goals:
      - { name: stand and fight, when: "actor.hp * 2 <= actor.hpMax", scale: { move: 0 } }
```

`compileBehaviors(registry, sets)` checks it against a compiled ruleset: a
score is an expression in the scope of the intent it weighs (its params, and
`seat`), typed like any other. Because the ruleset never reads a behavior, a
set can be changed, swapped, or varied without recompiling the rules.

A utility seat takes the highest-scoring legal intent and breaks ties with its
own seeded stream. An intent the behavior does not score counts as 0. A goal
multiplies the scores it names while its condition holds; its condition sees
the same params as the scores it scales, and a negative factor turns a score
around (`move: -1` makes "towards the prey" into "away from it").

Several sets given together merge in order. A later set adds behaviors, and
adds to or replaces the scores and goals of earlier ones (a goal is replaced
by its name). That is how a variant overlays the default without editing it,
and how an extension's intents get scored: a set lists the `extensions` it
needs ([example](../rulesets/dnd-5e-2024-slice/behaviors/second-wind.yaml)).

A seat gets its behavior by name. The scenario names a default
(`seats: { wild: { behavior: hunter } }`), and a run may bind any seat to
another: `bindSeats(scenario, behaviors, { wild: 'packHunter' })`. A seat
with neither plays at random.

Two behaviors can share a score with a YAML anchor (`cast: &spellValue ...`
and `cast: *spellValue`). YAML merge keys (`<<`) are not read.

## Space

```yaml
space:
  grid: square
  adjacency: 8
  corners: closed
  unit: 5
  increment: 5
  layers:
    terrain: { type: terrain, default: open }   # an enum
    cover: { type: int, default: 0 }
  blocksMove: "cell.terrain == 'rock'"
  blocksSight: "cell.terrain == 'rock' || cell.cover >= 3"
```

`space` says what a map of this ruleset can be, and the rules the host
respects on it. Core declares those rules; positions are ordinary `cell`
fields, and geometry is the host's. A ruleset may fix `width` and `height`;
otherwise the map gives them.

A space need not have a grid. With `grid: none` it is a plane: it has a
`unit`, and may have a `size`, `places`, and a standard `map`, and declares
nothing about cells. Its maps hold a size and places, and no rule can ask a
spatial question of it. Hold 'em's table is one. A ruleset with no `space`
at all has no map.

`adjacency` says whether a diagonal step is a step (8) or not (4). With
`corners: closed`, a diagonal step may not pass the corner of a cell that
blocks movement: it is not among `neighbors`. The default is `open`.

`layers` declares what every cell holds: a typed attribute (`int`, `number`,
`bool`, `string`, or an enum) with the value of a cell the map says
nothing about. A rule reads a cell with `cellAt(c)`: `cellAt(to).cover`. The
layers are its members, so a misspelt layer or a wrongly typed comparison
fails the build. `cellAt` of a cell off the map is an error.

`blocksMove` and `blocksSight` are the two rules the host respects. Each is a
bool expression over `cell`, one cell's layer values (and `tables`); it
cannot read the match. Core works them out for every cell when a map
loads and hands the host the answer, so the host itself evaluates nothing.
Nothing can be in a cell that blocks movement: it is not `inBounds`, and
`neighbors` and `cellsWithin` leave it out. A cell that blocks sight breaks a
`lineOfSight` that crosses it.

### What a map must be

```yaml
space:
  size: { min: [8, 8], max: [40, 40] }      # [width, height], either end optional
  checks:
    - { that: "cell.terrain != 'rock' || cell.cover == 0", message: rock gives no cover of its own }
  places: [gate]                             # every map has a place of this name
  map: { standard: board, only: true }
```

These are the ruleset's criteria for its maps, and `loadMap` refuses a map
that fails one. `size` bounds the width and height. `checks` are to a cell
what a kind's checks are to an instance: bool expressions over `cell`, one
cell's layer values. `places` lists the named places every map must have.

`map` names the ruleset's standard map, a map document shipped with it. A
scenario that names no map and writes none is played on it. With `only`,
every scenario is: naming another map, or writing one inline, is refused.
Checkers is played on its `board` this way.

### What play may change

```yaml
space:
  layers:
    terrain: { type: terrain, default: open, mutable: true }
    height: { type: int, default: 0 }       # fixed: the map's value stands
```

A layer is fixed unless it says `mutable`. A rule writes a mutable layer
with the `at` effect, and a referee with `author`:

```yaml
effects:
  - at: square
    set: { terrain: "'difficult'" }
```

A write to a fixed layer, an undeclared one, or of the wrong type fails the
build. When it runs, a write off the map, or one that leaves the cell
failing a check, is an error; a write that changes nothing is not an event.

The map document is never changed. A match holds what it has written, by
cell, in its state (`state.ground`), and the ground at any moment is the map
with that laid over it. `cellAt`, the two blocking rules, and every host
function answer from the ground as it stands, so a wall a rule raises
blocks movement and sight from the next expression on. Two matches on one
map do not see each other's changes.

## Maps

A map is one playing environment for a ruleset. In the model it is a bounded
plane, and a grid is one set of rules a ruleset may lay over it: the grid
divides the plane into cells, and a cell is an address for a patch of it.
The square grid is the only expression built so far, so a map today is a
size in cells and a value for every cell. Cells, layers, and the picture
below belong to the grid, not to the map as such.

A map is a document of its own, so several scenarios can be played on one
map, and a map can be drawn, changed, or swapped without touching who stands
on it.

```yaml
format: 2
map: { id: rocky-pass, title: Rocky pass }
ruleset: { id: dnd-5e-2024-slice, version: 0.4.0 }
legend:
  '.': {}                        # every layer at its default
  '#': { terrain: rock }
  '"': { terrain: difficult }
rows:
  - '......#...'
  - '..""..#...'
  - '..""......'
cells:
  - { at: [9, 2], terrain: rock }   # one cell; overrides the picture
```

`rows` is the map as a picture: one string per row, one symbol per cell. The
first row is `y = 0` and the first symbol of a row is `x = 0`, so the picture
reads as the grid is addressed. `legend` says what each symbol holds: any of
the ruleset's layers, the rest keeping their defaults. A symbol is one
character. `cells` lists single cells, as `{ at: [x, y], <layer>: <value> }`,
and wins over the picture. A map without a picture gives `width`, `height`,
and `cells`.

```yaml
places:
  gate: { at: [12, 0] }                 # a cell
  camp: { at: [2, 3], size: [4, 3] }    # an area, from that corner
```

`places` names points and areas on the map. A scenario may stand an entity
at one by name: a `cell` field given as `gate` is that place's cell. On a
grid a place is given in whole cells. For a ruleset with no grid, a map is
`width`, `height`, and `places` in game units, and has no cells.

`loadMap(registry, doc)` checks a map against a compiled ruleset and returns
it as the plain data a host is given ([`host.md`](host.md#the-map)). Refused:
rows of different widths, a symbol not in the legend, a size that disagrees
with the picture or with what the ruleset allows, a cell off the map or
given twice, an undeclared layer, a value of the wrong type, a cell that
fails a check, a place off the map, and a missing place the ruleset needs.

What a cell's values mean is the ruleset's. The 5e slice gives each square a
`terrain`; its `space` says rock blocks movement and sight, and its `move`
intent charges what the table `squareCost` says the square costs to enter.

## Patterns

The kit ([`kit/patterns.yaml`](../kit/patterns.yaml)) holds named templates:
`pool`, `budget`, `check`, `duration`, `slots`, `stacking`. A layer uses one
with arguments:

```yaml
uses:
  - { pattern: budget, with: { kind: creature, name: movement, amount: self.speed, signal: turn.start, who: actor } }
```

The compiler substitutes `${param}` in the pattern's `emits` and merges the
result into the layer. The output is ordinary declarations, checked like any
other. Two declarations that disagree are a conflict.

## Layers

A base ruleset lists what extensions may change:

```yaml
open:
  - kinds.*.fields.+   # add fields to any kind
  - intents.+          # add intents
  - enums.damageType   # anything at or under this
```

`x` opens everything at or under x. `x.+` allows only additions directly
under x: a new key, or a new item when x is a list. `*` is any one key.
Everything else is closed. An extension names the base and version it
extends, and holds the same sections as a ruleset
([example](../rulesets/dnd-5e-2024-slice/extensions/second-wind.yaml)).

## Scenarios

```yaml
format: 2
scenario: { id: worg-vs-scout }
ruleset: { id: dnd-5e-2024-slice, version: 0.4.0 }
seats:
  wild: { behavior: hunter }
  referee: { referee: true }
map: rocky-pass                           # a map document, by id
entities:
  - { id: worg, kind: creature, fields: { ..., pos: [2, 6] } }
links:
  - { rel: wields, from: worg, to: bite }
end:
  - when: "!all.creature.exists(c, !c.defeated && c.side == 'adventurers')"
    outcome: { result: "'win'", winner: "'monsters'" }
```

`map` names the map the scenario is played on; the caller gives the map
documents (`loadScenario(registry, doc, { maps })`, by id). A scenario may
write a map inline instead, as `space: { width, height, cells, places }`,
as in a map document, and is held to the same criteria. It gives one or the
other. A scenario that gives neither is played on the ruleset's standard
map, when it has one.

End conditions belong to the scenario. They are checked after every write a
rule makes; the first that holds ends the match with its outcome. A match
also ends as `complete` when the flow runs out, or `limit` at
`limits.maxDecisions`.

Because the check runs after every write, a condition can hold for a moment
in the middle of a rule: in poker, one player holds every chip not in the pot
whenever the others are all in. A ruleset with such moments gives the
scenario something to wait for; hold 'em sets `game.street` to `done` between
hands, and its scenarios test for that. An outcome need not name a winner:
the junkyard's is a census.

## The log

One entry per event, numbered by `seq`:

| Entry | Records |
|---|---|
| `seed`, `global`, `create`, `set`, `destroy`, `ground`, `link`, `unlink`, `roll`, `end` | A write. `fold` applies these. A `ground` entry is one layer of one cell: `at`, `layer`, `value`. |
| `intent` | A seat's decision: `seat`, `intent`, `params`, and `of`, how many legal intents it chose among. |
| `signal` | A signal emitted. |

Scenario setup is in the log too, so a log alone rebuilds its match; the
`seed` entry carries the seed as it was given. An entry with `by` was
authored by a referee seat.

**Causes.** An entry carries `cause`: the `seq` of the intent or signal it
ran under. A write made by an intent's effects points at that `intent`; a
write made by a reaction points at the `signal` it reacted to; a signal, or a
decision asked for during resolution, points at whatever emitted or prompted
it. So a log reads as a tree without running a rule: a Counterspell cast at a
Shield cast at an attack nests as the rules nest. Three things have no cause
and sit at the top: setup, the flow's own effects (a round counter, a
`turn.start`, a seat's turn), and a referee's own changes. An `end` has the
cause of the write that brought it about.

**Seat streams.** Each AI seat has its own random stream. When a seat draws
from it to choose, the `intent` entry carries `rng`, where the stream then
stood, and `fold` keeps it in `state.streams`. A snapshot, or the state
folded from a log up to any entry, therefore holds every seat's stream, and a
match resumed or forked from there plays on as the original would have.

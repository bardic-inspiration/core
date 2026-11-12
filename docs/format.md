# The format

How a ruleset, an extension, and a scenario are written. This is format
version 1 (`format: 1`); each ruleset carries its own `version`.

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
| Behavior | `behaviors` | Utility scores an AI seat uses to choose among legal intents. |
| Space | `space` | What is spatially possible. |

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
| Space (host) | `inBounds(cell)` `distance(a, b)` `neighbors(cell)` `cellsWithin(cell, range)` `lineOfSight(a, b)` |

The host functions are answered by the engine. `distance` and `range` are in
the ruleset's units (`space.unit` per cell).

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

The first five are the writes, and each becomes one event in the log, as does
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

```yaml
behaviors:
  skirmisher:
    scores:
      attack: "weapon.ranged ? 100 : 80"   # sees the intent's params
      endTurn: 1
    goals:
      - { name: stand and fight, when: "actor.hp * 2 <= actor.hpMax", scale: { move: 0 } }
```

A utility seat takes the highest-scoring legal intent and breaks ties with its
own seeded stream. An intent the behavior does not score counts as 0. A goal
multiplies the scores it names while its condition holds; its condition sees
the same params as the scores it scales, and a negative factor turns a score
around (`move: -1` makes "towards the prey" into "away from it").

Two behaviors can share a score with a YAML anchor (`cast: &spellValue ...`
and `cast: *spellValue`). YAML merge keys (`<<`) are not read.

## Space

```yaml
space: { grid: square, adjacency: 8, unit: 5, increment: 5 }
```

Core declares the rules of space; positions are ordinary `cell` fields, and
geometry is the host's. A ruleset may fix `width` and `height`; otherwise the
scenario gives them.

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
format: 1
scenario: { id: worg-vs-scout }
ruleset: { id: dnd-5e-2024-slice, version: 0.1.0 }
seats:
  wild: { behavior: hunter }
  referee: { referee: true }
space: { width: 24, height: 12 }
entities:
  - { id: worg, kind: creature, fields: { ..., pos: [2, 6] } }
links:
  - { rel: wields, from: worg, to: bite }
end:
  - when: "!all.creature.exists(c, !c.defeated && c.side == 'adventurers')"
    outcome: { result: "'win'", winner: "'monsters'" }
```

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
| `seed`, `global`, `create`, `set`, `destroy`, `link`, `unlink`, `roll`, `end` | A write. `fold` applies these and nothing else. |
| `intent` | A seat's decision. |
| `signal` | A signal emitted. |

Scenario setup is in the log too, so a log alone rebuilds its match. An entry
with `by` was authored by a referee seat.

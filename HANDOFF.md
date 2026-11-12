# Handoff

Where the core prototype stands after its third pass, which laid the
groundwork for the spatial test studio (issue #3). The reasons behind each
call are in [`DECISIONS.md`](DECISIONS.md) (cited as D-numbers); the format
is in [`docs/format.md`](docs/format.md), and what a host implements and
calls is in [`docs/host.md`](docs/host.md).

## What works

Everything below is exercised by `npm run validate` (453 tests, and every
shipped scenario played).

- **The format and compiler.** YAML rulesets are schema-checked, patterns are
  expanded, layers are merged under the base's `open` list, and every
  expression is type-checked against types generated from the ruleset.
  Invalid data is refused with every reason and its path.
- **The runtime.** One machine runs any ruleset's flow, enumerates each
  seat's legal intents, and applies effects. It has no game-specific code.
- **Four rulesets that share no code**, and six scenarios:

  | Ruleset | Scenario | What it stresses |
  |---|---|---|
  | checkers | standard | A closed game. |
  | 5e slice | worg-vs-scout | Dice, derived stats, a reaction. |
  | 5e slice | pack-ambush | Ten creatures on seven seats, five behaviors, conditions. |
  | 5e slice | mage-duel | Spells, slots, reactions that answer a spell or a hit in flight. |
  | hold 'em | four-handed | Hidden cards, betting rounds, side pots. |
  | junkyard | yard | Ticks, state that grows and shrinks, no winner. |

- **Hidden information.** A field or global declares who sees it. A seat's
  legal intents and behavior scores are worked out through its own view, and
  reading a secret there is an error (D30).
- **Determinism and replay.** Same seed, same log. `fold(log)` equals the
  final state. Replaying a log through the rules reproduces it entry for
  entry, a referee's changes and rulings included (D54). All three hold for
  all six scenarios.
- **Choices during resolution.** A reaction prompts another seat in the
  middle of an intent, nested where the rules nest (a Counterspell cast at a
  Shield cast at an attack), and a match can be saved at a decision and
  resumed. The save holds every AI seat's random stream (D53).
- **Layers.** Extensions add to the 5e slice and to the junkyard; changes to
  anything closed are refused.
- **The kit.** Six patterns as data: `pool`, `budget`, `check`, `duration`,
  `slots`, `stacking`. The 5e slice uses all six, the junkyard uses three,
  and hold 'em uses none.
- **A referee seat** that authors instances during play and rules that an
  intent happens out of turn.
- **Recorded matches.** `npm run sim` writes one record per match to
  [`data/matches.jsonl`](data/matches.jsonl) (D44). A record is now worked
  out from the log alone (D56).

### The studio groundwork

All ten tasks of issue #3, in one pass. `docs/host.md` is the reference.

- **Behaviors are their own layer** (D46). Each ruleset's behaviors moved to
  `rulesets/<id>/behaviors/default.yaml`, compiled against the registry by
  `compileBehaviors` and bound to seats by `bindSeats`: by the scenario's
  names, or by the run over them. Sets overlay each other in order.
- **Causes in the log** (D47). Every entry records the `seq` of the intent
  or signal it ran under, so a log is a tree.
- **A browser worker** (D48). Core's entry is free of Node. The check
  bundles it, runs it in a realm with no Node globals, and plays matches in
  a Web Worker in headless Chromium; the logs match Node's. Timings below.
- **Explained enumeration** (D49). `match.explain()` returns every candidate
  at a decision, each gate's result, and every host call made.
- **The host contract** (D50). Six functions, with units, ordering, and edge
  cases written down, and `compareHosts` to hold an engine's host to it.
- **Free-standing expressions** (D51). `compileExpression` checks one
  against a registry; it evaluates on any state, or through a seat's view.
- **Cell layers** (D52). A ruleset declares typed per-cell attributes and
  two rules, `blocksMove` and `blocksSight`; a scenario gives the values;
  `cellAt(c)` reads them, typed at compile time. The 5e slice and the
  junkyard use a layer where they had a list of blocked cells.
- **Seat streams in the state** (D53), **referee changes on replay** (D54),
  and **forks** (D55): `fork(registry, scenario, log, seq)` returns the
  match at that decision, and choosing the same again plays out the same
  match.

The format is now version 2, and each ruleset's version went up, because
behaviors left the ruleset and `space.blocked` left the scenario. The log
gained fields, so every `logHash` changed and the records were regenerated.
With the new fields left out, all 240 recorded matches play out exactly as
they did before: same logs, same records.

### Maps

A first pass at the playing environment (D58 to D63), after the studio
groundwork.

- **A map is its own document.** `rulesets/<id>/maps/<id>.yaml` holds a
  size and the cells' values, drawn as a picture with a legend. `loadMap`
  checks it against the ruleset's `space` and returns what a host is given;
  a scenario names it with `map: <id>`. The inline `space` still works.
- **The 5e square grid.** 5-foot squares, a diagonal at the cost of any
  other step, closed corners (`space.corners`, a new part of the host
  contract), and Difficult Terrain at 10 feet a square. The pack ambush is
  played on `maps/rocky-pass.yaml`.
- **What a map must be.** A ruleset's `space` gives bounds on a map's
  size, checks every cell must pass, and places every map must have
  (D70). `loadMap` enforces them, for inline maps too.
- **Standard maps.** A ruleset names one, a scenario that gives no map
  gets it, and a ruleset may allow no other (D71). Checkers is played on
  `maps/board.yaml` and nothing else.
- **A space without a grid.** A plane with a size and named places (D72,
  D73). Hold 'em has a table. A scenario can stand an entity at a place by
  name.
- **Mutable layers.** A layer the ruleset marks `mutable` can be written
  by a rule (`at` ... `set`) or a referee. Each write is a `ground` entry
  in the log; the state holds the changes as an overlay, and the map
  document is never touched (D74, D75). The rules and the host answer from
  the ground as it stands; `scenario.mapAt(state)` gives it for any state.
  Replay, forks, and snapshots hold. In the 5e slice, Grease turns the
  ground under an enemy into Difficult Terrain (D76).
- **Not yet:**
  - Play on a plane without a grid: free positions, straight-line
    distance, shapes that block.
  - Expressions cannot read a place.
  - Cells hidden from some seats, and a map that changes size.
  - A change to the ground that ends by itself: Grease lasts the match.
  - Checks over a whole map, such as "every area can be reached".
  - In the 5e slice: cover from what stands between two squares, obscured
    areas, and creatures larger than one square. The grid rules were
    written from the 2024 rules' "Playing on a Grid" and have not been
    checked against ttrpg-library.
  - A host is built again for every write to the ground. Fine at these
    sizes; a large map written often would want the host patched instead.

### Core in a Web Worker against Node

Seeds 1 to 10 of each scenario, on one machine (Node 22.23, Chromium 153):
`npm run browser`. The worker is a fresh one per scenario, so its compile
time is a cold start; Node's is warm.

| Scenario | Same logs | Compile, Node / worker (ms) | Per match, Node / worker (ms) |
|---|---|---|---|
| checkers/standard | yes | 5 / 28 | 44 / 34 |
| 5e/mage-duel | yes | 20 / 40 | 112 / 79 |
| 5e/pack-ambush | yes | 18 / 43 | 113 / 96 |
| 5e/worg-vs-scout | yes | 15 / 38 | 15 / 13 |
| holdem/four-handed | yes | 8 / 28 | 81 / 64 |
| junkyard/yard | yes | 7 / 29 | 324 / 228 |

A match is no slower in the worker than in Node. The bundle is about 560 kB
unminified.

## What the four new cases showed

The model held. Nothing game-specific went into the runtime, and the four
cases needed three additions to the format: visibility (D30), a write to a
computed map key (D34), and one list function (D35).

- **Reactions that change something in flight needed no new effect.** The
  thing in flight becomes an entity for as long as it lasts (D32). Shield,
  Counterspell, and Resistance are all written this way.
- **The scheduler claim (D2) survived a third shape.** A betting round is a
  `while` over a condition, written with the same effects as rounds and
  ticks (D40).
- **Poker hand ranking fits in expressions.** It is nine derived values and
  two small tables, with no loop and no game function.
- **Content and rules separate cleanly for spells.** Eleven spells are
  scenario data over eight forms (D36).
- **Affordances fall out of relations.** A junkyard bot may move because a
  leg is linked to it; the referee bolting on an arm adds `strike` to its
  legal intents with no rule involved.
- **Where it strained:**
  - End conditions run after every write, so a scenario can end a match in
    the middle of a rule. Hold 'em works around it with a marker (D41).
  - Behaviors are the weakest part. One-step scoring has no pathfinding, and
    each fix was a longer expression (D42). Score expressions are now the
    longest and most repeated text in a ruleset.
  - An intent still cannot return a value to the effects that prompted it;
    it goes round through state (D33).
  - Log volume: a weapon hit in the 5e slice is now about ten log entries.
  - Two rules were wrong in ways only play found: reactions were unavailable
    in round one (D38), and a keyed write to a global lost the rest of the
    map (D34).

### The recorded data, 40 seeds each

| Scenario | Outcomes | Decisions | Options per decision (mean, max) | Events | ms per match |
|---|---|---|---|---|---|
| checkers/standard | red 22, black 16, draw 2 | 73 | 5.1, 16 | 227 | 46 |
| 5e/worg-vs-scout | monsters 27, adventurers 13 | 37 | 9.5, 12 | 199 | 18 |
| 5e/pack-ambush | monsters 25, adventurers 15 | 169 | 9.6, 20 | 980 | 114 |
| 5e/mage-duel | red 26, blue 14 | 87 | 62.6, 334 | 618 | 110 |
| holdem/four-handed | shark 19, random 8, station 7, maniac 6 | 109 | 4.6, 6 | 1,474 | 68 |
| junkyard/yard | census (11 bots on average) | 584 | 8.1, 41 | 2,642 | 346 |

Things in it worth a look later:

- The mage duel has the widest choice by far, from burst and teleport
  targets. Counterspell was cast 31 times and stopped the spell 21 times;
  Shield was cast 185 times, and Grease 12.
- In the junkyard, 38% of decisions had one legal intent, and more than half
  of all choices were `idle`. Bots built from a part that is not a leg cannot
  move, and bots run out of charge. The raider swarm ends largest.
- A poker match lasts about 15 hands, because the random seat and the maniac
  put stacks in quickly.

## What is stubbed or missing

- **Hidden information in the log.** State views are filtered; the event log
  is not, and neither are a seat's own past decisions (D30).
- **Space.** A two-dimensional square grid only. No hexes, no vertical
  movement, no creature footprints larger than one cell, no path distance,
  and the reference host's line of sight is a simple line walk (D22–D24).
- **Derived cycles** are caught when evaluated, not when compiled (D13).
- **Kind checks** are not enforced after every write (D12).
- **Rollback.** There is no undo; the log supports it but nothing winds back.
- **Behavior** is one-step utility scoring (D20, D42).
- **Space rules read one cell.** `blocksMove` and `blocksSight` read a
  cell's layers and nothing else (D52). A door blocks when it is a value
  of a mutable layer, not when it is an entity standing in the cell.
- **A log does not hold its map.** It holds what play changed on it
  (D75); the map itself is the scenario's.
- **`inBounds` means two things**: on the map, and open to movement (D50).
- **Seat streams are not hidden.** `state.streams` is in every seat's view.
- **A strict content security policy** needs `unsafe-eval` for the schema
  checker until its validators are precompiled (D48).
- **The 5e slice** is still a slice (D28, D39). Its new stat blocks and
  spells have not been checked against ttrpg-library.
- **Recursion.** Procedures may now recurse through a signal (a Counterspell
  is itself a spell being cast). It is bounded by reactions in practice and
  by nothing in the compiler.
- **Not measured:** matches larger than these, and a pool of workers at
  once.

## Where the build departed from the brief

- The scheduler is not a set of built-in types; it is the ruleset's `flow`,
  written in the same effects as everything else (D2, D40).
- The seeded RNG is ported from dnd-hirelings rather than taken from a
  library (D16).
- Immer applies events immutably; its patches are not the log (D17).
- Layers gained **menus** (D7), and openness became address patterns with an
  add-only form (D25).
- A tick fixture is kept for tests beside the four rulesets (D27, D43).

## What comes next

Suggested order.

1. **Bring in the spec-driven process** from ttrpg-library, seeded from
   `DECISIONS.md` and this note. `npm run validate` is the check to build on.
2. **Say where a match may end.** A checkpoint in the flow, or end
   conditions tied to a signal, in place of a check after every write (D41).
3. **Behavior.** Lookahead by running an intent on a copy of the match, a
   path-distance host function, and somewhere to put shared score terms that
   is not YAML anchors (D42).
4. **Filter the log by seat**, so a player or an agent can be shown its own
   history (D30).
5. **Check the 5e content against ttrpg-library**, then start the
   translator: the slice's field names follow the library's on purpose, and
   `spell` now has a shape to translate into.
6. **Move the remaining run-time failures to compile time**: derived cycles,
   `done` outside a prompt, and a bound on recursion.
7. **More 5e**: Large creatures (footprints), cover, lines and cones, and
   the conditions not yet written.
8. **Analyse the data.** Vary one behavior or one stat at a time with
   `npm run sim -- --only` and compare outcomes; the records are built for
   that.
9. **Maps**: what is listed as not yet under [Maps](#maps) above.
10. **The studio** (the engine's first form): implement `SpaceHost` to
   `docs/host.md`, run matches in workers, and render from the event log's
   tree. Its design is in the `space` repository.

# Handoff

Where the core prototype stands after its second pass. The reasons behind
each call are in [`DECISIONS.md`](DECISIONS.md) (cited as D-numbers); the
format is in [`docs/format.md`](docs/format.md).

## What works

Everything below is exercised by `npm run validate` (313 tests, and every
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
  final state. Replaying logged decisions through the rules reproduces the
  log. All three hold for all six scenarios.
- **Choices during resolution.** A reaction prompts another seat in the
  middle of an intent, nested where the rules nest (a Counterspell cast at a
  Shield cast at an attack), and a match can be saved at a decision and
  resumed.
- **Layers.** Extensions add to the 5e slice and to the junkyard; changes to
  anything closed are refused.
- **The kit.** Six patterns as data: `pool`, `budget`, `check`, `duration`,
  `slots`, `stacking`. The 5e slice uses all six, the junkyard uses three,
  and hold 'em uses none.
- **A referee seat** that authors instances during play and rules that an
  intent happens out of turn.
- **Recorded matches.** `npm run sim` writes one record per match to
  [`data/matches.jsonl`](data/matches.jsonl) (D44).

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
| 5e/pack-ambush | monsters 22, adventurers 18 | 164 | 9.9, 20 | 962 | 115 |
| 5e/mage-duel | red 25, blue 15 | 88 | 62.3, 334 | 615 | 107 |
| holdem/four-handed | shark 19, random 8, station 7, maniac 6 | 109 | 4.6, 6 | 1,474 | 68 |
| junkyard/yard | census (11 bots on average) | 584 | 8.1, 41 | 2,642 | 346 |

Things in it worth a look later:

- The mage duel has the widest choice by far, from burst and teleport
  targets. Counterspell was cast 31 times and stopped the spell 21 times;
  Shield was cast 186 times.
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
- **AI seat state in a save.** A snapshot holds the match, not the seats'
  random-stream positions.
- **Behavior** is one-step utility scoring (D20, D42).
- **Replay of referee changes.** `fold` replays them. Replaying decisions
  through the rules (`ReplaySeat`) does not re-apply authored changes.
- **The 5e slice** is still a slice (D28, D39). Its new stat blocks and
  spells have not been checked against ttrpg-library.
- **Recursion.** Procedures may now recurse through a signal (a Counterspell
  is itself a spell being cast). It is bounded by reactions in practice and
  by nothing in the compiler.
- **Not measured:** matches larger than these, and running in a browser.

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
9. **The engine**: implement `SpaceHost` with real geometry, drive `advance`
   and `submit` from a UI, and render from the event log.

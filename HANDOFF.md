# Handoff

Where the one-shot build of the core prototype stands. The reasons behind
each call are in [`DECISIONS.md`](DECISIONS.md) (cited as D-numbers); the
format is in [`docs/format.md`](docs/format.md).

## What works

Everything below is exercised by `npm test` (168 tests).

- **The format and compiler.** YAML rulesets are schema-checked, patterns are
  expanded, layers are merged under the base's `open` list, and every
  expression is type-checked against types generated from the ruleset.
  Invalid data is refused with every reason and its path.
- **The runtime.** One machine runs any ruleset's flow, enumerates each
  seat's legal intents, and applies effects. It has no game-specific code.
- **Two rulesets that share no code.** Checkers, and a 5e combat slice
  (initiative, turn budgets, grid movement, weapon attacks with advantage and
  critical hits, Multiattack, Opportunity Attacks, the worg's bite rider, hit
  points). Both run to an end state with AI seats.
- **Determinism and replay.** Same seed, same log. `fold(log)` equals the
  final state. Replaying logged decisions through the rules reproduces the
  log.
- **Choices during resolution.** A reaction prompts another seat in the
  middle of an intent, and a match can be saved and resumed at any decision.
- **Layers.** A homebrew extension adds a field, an intent, a menu entry, and
  behavior scores to the 5e slice; changes to anything closed are refused.
- **The kit.** Six patterns as data: `pool`, `budget`, `check`, `duration`,
  `slots`, `stacking`. The 5e slice uses five; the tick fixture uses `slots`
  and `stacking`.
- **A referee seat** that authors instances during play and rules that an
  intent happens out of turn.
- **A tick-driven fixture** where state grows during play.

## What is stubbed or missing

- **Hidden information.** Every seat sees everything; `Match.view` is the
  seam (D18).
- **Space.** A two-dimensional square grid only. No hexes, no vertical
  movement, no creature footprints larger than one cell, and the reference
  host's line of sight is a simple line walk (D22–D24, D28).
- **Derived cycles** are caught when evaluated, not when compiled (D13).
- **Kind checks** are not enforced after every write (D12).
- **Rollback.** There is no undo; the log supports it but nothing winds back.
- **AI seat state in a save.** A snapshot holds the match, not the seats'
  random-stream positions. The tests keep the seat objects across the
  restore; a real save has to store `seat.position` too.
- **Behavior** is one-step utility scoring. There is no lookahead and no
  planner, and goals only scale scores (D20).
- **Replay of referee changes.** `fold` replays them. Replaying decisions
  through the rules (`ReplaySeat`) does not re-apply authored changes; the
  caller has to.
- **The 5e slice** is a slice: see D28 for what it leaves out.
- **Not measured:** performance beyond these small matches, and running in a
  browser. Core avoids Node APIs outside `src/load.ts`, but nothing bundles
  it yet.

## Where the build departed from the brief

- The scheduler is not a set of built-in types; it is the ruleset's `flow`,
  written in the same effects as everything else (D2).
- The seeded RNG is ported from dnd-hirelings rather than taken from a
  library (D16).
- Immer applies events immutably; its patches are not the log (D17).
- Layers gained **menus** (D7), and openness became address patterns with an
  add-only form (D25).
- A third ruleset exists, as a test fixture only (D27).

## What comes next

Suggested order, smallest dependency first.

1. **Bring in the spec-driven process** from ttrpg-library, seeded from
   `DECISIONS.md` and this note. `docs/format.md` is the start of the spec.
2. **Push the format with harder 5e rules**, since each will show what it
   cannot say yet: saving throws and conditions (durations with their own
   expiry rules), damage types with resistance (a reaction that changes an
   amount in flight, which signals cannot do today because they return
   nothing), spells with areas (a param whose domain is a set of cells), and
   Large creatures (footprints).
3. **Hidden information**: a visibility declaration on fields, the filter in
   `Match.view`, and enumeration that respects it.
4. **Move the remaining run-time failures to compile time**: derived cycles,
   `done` outside a prompt, and a recursion check on procedures.
5. **The translator** (its own project): read ttrpg-library creatures and
   write core scenario entities. The slice's field names follow the
   library's on purpose.
6. **The engine**: implement `SpaceHost` with real geometry, drive `advance`
   and `submit` from a UI, and render from the event log.
7. **Behavior**: lookahead by running an intent on a copy of the match (the
   state is immutable and the stack is data, so a copy is cheap), then the
   task-engine ideas from dnd-hirelings for longer goals.

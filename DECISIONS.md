# Decisions

The calls made during the build, where the brief was silent, open, or wrong.
Append-only: a later decision that changes an earlier one gets a new entry
that names it, and the old entry stays.

Each entry says what was decided and why. Entries marked **(open question)**
answer one from the brief; entries marked **(departure)** differ from its
sketch.

## 2026-11-12: the one-shot prototype build

### The model

**D1. The primitives.** A ruleset is kinds (fields, derived values, checks),
relations, globals, enums, tables, intents, menus, signals and reactions,
procedures, a flow, behaviors, and a space declaration. Effects are a closed
set of fourteen: five writes (`set`, `create`, `destroy`, `link`, `unlink`),
`roll`, and eight that only steer (`let`, `if`, `each`, `while`, `prompt`,
`done`, `emit`, `call`). Why: this is the smallest set that expressed both
test rulesets and the tick fixture without a single game-specific function in
the runtime.

**D2. The scheduler is a flow, not a set of scheduler types. (departure)**
The brief sketches a scheduler "declared by the ruleset: rounds and
initiative for 5.5e, ticks for a real-time sandbox". The ruleset does declare
it, but as an ordinary effect list (`flow`) built from `while`, `each`, and
`prompt`, not by choosing a built-in type. Why: rounds, initiative, and ticks
all fell out of the same three effects, so a scheduler type would have been
game-specific machinery with nothing left to do.

**D3. One prompt mechanism for turns and for choices during resolution.
(open question)** An effect asks a seat to decide with `prompt`. The flow
uses it for a turn; an intent's effects use it mid-resolution, as the 5e
`move` intent does for an Opportunity Attack. The runtime keeps its
continuation as an explicit stack of plain-data frames rather than on the
JavaScript call stack, so it can stop at any prompt, hand the legal intents
to the seat, and continue. A match can be saved at any decision, including a
reaction, and resumed.

**D4. Signals and procedures are both kept.** A signal is a broadcast with no
return, open to reactions from any layer (`turn.start`, `hp.lose`). A
procedure is a call with returns, owned by its caller (`strike`, `d20Test`).
Why: they answer different needs, and folding one into the other made either
hooks or return values awkward.

**D5. A reference field is required; an optional association is a relation.**
Why: it keeps null out of expressions, and it is what "composition through
relations" asks for anyway. Globals cannot be linked, so checkers'
`game.chain` holds a piece id as a string, with `""` for none. That is a
wart.

**D6. Addresses are `kind.field` and `kind.field.key`.** A keyed group such
as the six abilities is one field of type `map<ability,int>`, not a nested
struct. Why: an enum-keyed map can be indexed by a value
(`attacker.mod[weapon.ability]`), which a struct cannot, and a derived map is
one formula with `each` instead of six.

**D7. Menus.** A prompt can offer a named list of intents. Why: without one,
an extension could add an intent but never get it offered, because the
prompt that offers it sits inside the closed flow.

### Expressions and checking

**D8. CEL, statically typed against generated types.** The compiler builds a
CEL type for every kind from its declarations and type-checks every
expression against the variables in scope. An expression the checker can only
type as `dyn` is refused. Why: this is what makes "invalid rules data is
refused at compile time" reach inside expressions; a misspelt address fails
the build, not the match.

**D9. Rounding. (open question)** CEL integer division truncates toward
zero, which is not what 5e does for negatives: `(9 - 10) / 2` is `0`. The
function library has `floorDiv` and `ceilDiv`, and a ruleset says which it
means. The 5e slice uses `floorDiv` for ability modifiers and hit points;
`tests/dnd.test.ts` pins that a 9 gives −1.

**D10. No `sortBy` macro.** Sorting is `sortBy(list, keys)` over a parallel
list of integer keys. Why: a macro form (`list.sortBy(x, key)`) needs the CEL
library's internal AST API, which would tie core to its internals.

**D11. Tables are typed by inference and must be homogeneous.** A table of
mixed entry types is refused. Why: it kept tables typed without a schema
language for them. A table of rows with different-typed columns has to be
split into parallel tables for now.

**D12. Kind checks run at creation, not after every write.** They run when a
scenario, a `create` effect, or a referee makes an instance, and on demand
through `Match.violations()`. Why: mid-resolution states can break an
invariant briefly and legitimately. The tests assert no violations at the end
of every match.

**D13. Derived cycles are caught at run time.** A derived value that depends
on itself raises a rule error when evaluated, not a compile error. Why:
finding the cycle statically across entity boundaries was more than the
prototype needed. It should move to compile time.

### State, log, replay

**D14. The log is the writes, plus two markers.** Writes (`seed`, `global`,
`create`, `set`, `destroy`, `link`, `unlink`, `roll`, `end`) change state;
`intent` and `signal` only record. `fold(log)` rebuilds state without running
any rule. Scenario setup is logged the same way, so a log is self-contained.
A `set` that changes nothing is not logged.

**D15. Three kinds of replay, all tested.** The same seed with the same
seats gives the same log. Folding the log gives the same final state.
Replaying the logged decisions through the rules gives the same log, and a
decision that is no longer legal is an error.

**D16. The seeded RNG is ported from dnd-hirelings. (departure)** The brief
says to adopt a seeded RNG library. Core ports the dozen lines of
dnd-hirelings' FNV-1a + mulberry32 instead. Why: its whole position is one
32-bit integer, so it sits in game state and each `roll` event carries it,
which is what makes the fold exact. Each AI seat has its own stream, keyed by
seed and seat, so how a seat decides never disturbs the game's dice.

**D17. Immer is used for immutable updates, not as the log. (departure)**
The brief lists Immer for change diffs. Events are semantic writes applied
with Immer's `produce`; Immer's patches are not the log. Why: `set worg.hp
18` reads better than a JSON patch and is what a translator or UI wants.
Rollback from inverse patches is not built.

### Seats

**D18. Hidden information. (open question)** Every seat sees all state for
now. `Match.view(seat)` is the one place a seat's view is produced, and it
returns the whole state. Filtered views and secret rolls will need a
visibility declaration on fields and a filter there.

**D19. Seats are synchronous, and a match can be stepped.** A seat's
`choose` returns an index at once. `advance()` returns the pending decision
and `submit(index)` takes it, so a slow seat (a person, an agent) is driven
from outside without core being asynchronous.

**D20. Behaviors are scores and goals.** A behavior gives each intent a score
expression over that intent's params; a goal multiplies scores while its
condition holds. A utility seat takes the best. There is no lookahead.

**D21. The referee seat has two powers.** `author` writes state directly,
and is refused unless every change is an instance of what the ruleset
declares, checks included. `adjudicate` makes a declared intent happen now,
whatever is on offer; its params are type-checked and its gates are the
referee's to waive. Why: the first is "authoring during play", the second is
"mapping an unplanned action onto the ruleset".

### Space

**D22. Spatial host functions. (open question)** Five: `inBounds(cell):
bool`, `distance(a, b): int` in the ruleset's units, `neighbors(cell):
list<cell>`, `cellsWithin(cell, range): list<cell>`, and `lineOfSight(a, b):
bool`. Positions are ordinary `cell` fields, so occupancy is an expression
(`all.piece.exists(p, p.pos == t)`), not a host function. Cell arithmetic
(`offset`, `mid`) is core's.

**D23. Core ships a reference grid host.** `src/host/grid.ts` implements the
five functions on a bounded square grid. Why: the engine is out of scope, and
a headless match needs something to answer.

**D24. Cells are two-dimensional.** `space.vertical: true` is refused rather
than accepted and ignored.

### Layers and the kit

**D25. Openness is a list of address patterns.** `x` opens everything at or
under x; `x.+` allows only additions directly under x; `*` is any one key.
An extension cannot change the base's `open` list. Why: "may add an intent"
and "may rewrite an intent" need to be told apart, and a first, looser rule
(`x.+` meaning anywhere under x) let an extension append effects to an
existing intent.

**D26. Patterns are data templates.** A pattern is a fragment of a ruleset
with `${param}` placeholders, expanded before the layer is checked. The
function library is the only part of the kit written in TypeScript. Why: it
keeps "rules are data" true one level up, and a pattern cannot do anything a
ruleset could not write by hand.

### The prototype's rulesets

**D27. Test rulesets. (open question)** Checkers and the worg against the
scout are the right pair: a closed game with a mandatory-move rule and
chained moves, and an open one with dice, derived stats, relations, a
reaction, and a timed marker. They leave a tick scheduler and state growth
unproved, so a third, tiny tick-driven ruleset is kept as a test fixture
(`tests/fixtures/junkyard.yaml`).

**D28. Simplifications in the 5e slice.** The worg occupies one square, not
the four a Large creature does. Initiative ties go to the higher Dexterity,
then to scenario order. A creature at 0 hit points is defeated; there are no
death saves. Diagonals cost 5 feet. There is no cover, difficult terrain, or
condition other than the worg's bite rider. Stat-block inputs are copied
from ttrpg-library by hand; the translator is out of scope.

### Tooling

**D29. No build step.** The source is TypeScript that Node can run by
stripping types (`erasableSyntaxOnly`), and Vitest for tests. `npm test` is
the one command.

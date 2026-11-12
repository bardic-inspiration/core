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

## 2026-11-12: four more games

The prototype was pushed with four harder cases: a 5e fight with ten
creatures on seven seats, a duel between two spellcasters, four-handed Texas
Hold 'Em, and the junkyard as a full sandbox. Each entry says what the case
forced and why the call went the way it did.

### What the format gained

**D30. Hidden information is declared on the field. (open question; replaces
D18)** A field or global may carry `visible`, a bool expression over `viewer`
(a seat) and, on a kind's field, `self`. `Match.view(seat)` leaves hidden
values out. A seat's legal intents and its behavior's scores are evaluated
through that seat's view, and reading a hidden value there is an error, not a
blank. Why an error: a blank would need a made-up value of the right type,
and a rule or score that silently read it would be a leak nobody saw. A
derived value needs no declaration; it is hidden whenever what it reads is.
The event log is not filtered: it is the referee's record.

**D31. A deck has no order.** Hold 'em keeps the undealt cards as a list no
seat can see, and draws one at random when a card is dealt. Why: a shuffled
order would be state that exists only to be hidden, and the draw is already a
logged `roll`.

**D32. A thing in flight is an entity.** HANDOFF said a reaction that
changes an amount in flight was not expressible, because signals return
nothing. No new effect was needed. The procedure creates an entity for the
thing (`wound` for damage, `casting` for a spell), emits a signal that
carries it, reads it back, and destroys it. Why not give signals return
values: an entity is already something any reaction can write, an extension
can add a reaction without touching the closed procedure, and the change
shows in the log as an ordinary `set`.

**D33. A prompt passes facts in through `with`; the answer comes back
through state.** The Shield reaction is given the attack roll `total` as a
param, so the seat can tell whether +5 would turn the hit. The intent it
chooses writes state (a lasting effect), and the procedure that asked reads
Armor Class again. Why: it kept `prompt` as it was. An intent still cannot
hand a value straight back to the effects that prompted it.

**D34. A map entry can be written at a computed key.** `set` takes
`owner.field[expr]` as well as `owner.field.key`. Spell slots needed it: the
slot level is a param, and D6 allowed only a literal key. The key is checked
against the map's key type when the write runs. This also fixed a fault: a
keyed write to a global replaced the whole map with the one entry.

**D35. One function was added to the library: `distinct()`.** Poker hand
ranking is written entirely as derived values, with `sortBy`, `range`,
`filter`, and a table of place values. Why this matters: a `handRank()`
function would have been game code in the runtime.

### The 5e slice, version 0.2.0

**D36. A spell is an entity with a form.** `spell` is a kind; a scenario
gives a caster its spells with a `knows` relation, as it gives weapons with
`wields`. A spell's `form` (attack, save, darts, heal, burst, ward, counter,
step) picks how it resolves, and its other fields fill the form in. Why:
Fire Bolt, Scorching Ray, and Ray of Frost are one rule with different
numbers, so they should be content. Shield, Counterspell, and Misty Step are
each a form of one, which is honest about them being rules.

**D37. Lasting effects are one kind.** An `effect` carries a condition, a
source, an expiry rule, bonuses to Armor Class and Speed, and whether it
needs concentration. Armor Class and Speed are `stacking` patterns over a
creature's effects. The kit's `duration` pattern has one expiry rule, so
`effect` is written out by hand; the pattern still serves the worg's bite.

**D38. Reactions are ready from the start of combat.** Before, a creature's
reaction was refilled only at the start of its own turn, so nobody could
react in the first round before acting. This is a rule fix, and it changed
how worg against scout plays (the worg now gets its Opportunity Attack when
the scout backs off in round one).

**D39. Simplifications added to D28.** One spell slot per turn, counted for
every turn and not only the caster's own. Counterspell is the 2024 version:
a Constitution save, and a countered spell keeps its slot. A warding spell
and a counterspell take the lowest slot that will do. Magic Missile sends
every dart at one creature. A prone creature cannot crawl; it stands or
stays. Hide is not modelled, so Nimble Escape is Disengage only. A creature
is still defeated at 0 hit points. The acolyte's uses per day are given as
slots. Stat blocks and spell numbers are written from the published SRD 5.2
text and have not been checked against ttrpg-library.

### Schedulers, ends, and behaviors

**D40. A betting round is a third kind of flow.** Hold 'em's is a `while`
over "someone still owes a decision", choosing who is next each time round.
It needed nothing new, which supports D2. Raise sizes are a param whose
domain is four amounts (minimum, half the pot, the pot, all in), because the
real choice is too wide to enumerate. No cards are burned.

**D41. An end condition may need a marker to wait for.** End conditions are
checked after every write, so "one player has all the chips" was true in the
middle of any hand where the others were all in. Hold 'em sets `game.street`
to `done` between hands and its scenarios test for it. A test caught a
second case of the same thing. This is a wart: a ruleset should be able to
say where a match may end.

**D42. Behaviors stay one-step, and it shows.** Three things were needed to
get sensible play from one-step scoring. A ranged behavior with no shot
steps to a square that has one, after a scenario with boulders stalled for
1,400 rounds. The pack circles when its way is blocked by its own side. A
goal may scale by a negative number, which turns "towards the prey" into
"away". There is still no pathfinding and no lookahead (D20). Hold 'em's
`strength` is a derived value in the ruleset that exists for behaviors to
read; it is the first rule data that is there for the AI and not the game.

### Rulesets and tooling

**D43. The junkyard is the fourth ruleset.** The brief names it as the other
pole from a TTRPG. It is the open case: ticks, state that grows and shrinks,
what a bot may do derived from the parts linked to it, a referee authoring
scrap during play, and an outcome that is a census. The tick fixture is kept
and renamed `ticker`.

**D44. Matches are recorded as data.** `npm run sim` writes one record per
match to `data/matches.jsonl`. A record has nothing that varies between runs
of one seed, so the file doubles as a regression check through each match's
`logHash`. Why committed: it is small, and a change in how the rules play
then shows in review as a change in the data.

**D45. A validate check stands in for CI.** `npm run validate` type-checks,
compiles every ruleset alone and with each extension, loads and plays every
scenario, compares three seeds of each against the recorded data, and runs
the tests. A GitHub workflow runs it on pull requests. The spec-driven
process from ttrpg-library is still to come.

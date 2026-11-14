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

## 2026-11-12: groundwork for the spatial test studio

The studio is a browser workbench that runs core unchanged: it watches a
match, rewinds or forks it, and runs batches. Issue #3 lists what it needs
from core in ten tasks over four phases. They were built together, because
several touch the same places (the log, the seat interface) and one change
to the recorded data was better than four.

### Behaviors

**D46. Behaviors are a document apart from the ruleset. (replaces the
`behaviors` section of D1; D20 and D42 still describe what a behavior is)**
A behavior set is its own file with its own header, compiled against a
registry by `compileBehaviors`. A ruleset with a `behaviors` key is refused.
Sets merge in the order given, and a later one may replace what an earlier
one scored; the `open` list does not apply, since behaviors are not rules
and varying them is the point. A set that scores an extension's intent names
the extension, and is refused without it. A scenario still names each seat's
behavior, as a default; `bindSeats` lets a run bind a seat to another. Why:
the studio varies behaviors far more often than rules, and a variant should
not recompile or re-version the rules. `Match.scores` takes the compiled
behavior, not a name, since the registry no longer knows any.

### The log

**D47. Every entry records its cause.** `cause` is the `seq` of the intent
or signal the entry ran under. Setup has none, as the issue asks. Neither
do the flow's own effects or a referee's own changes: nothing in the log
stands above them. The issue also names "the prompt" as a possible cause,
but a prompt is not a log entry; a decision made at one records the intent
or signal that asked for it, which is what nests a reaction under its
trigger. An `end` takes the cause of the write that tripped it. Sections
such as rounds and turns stay the host's to draw, from signals it picks:
core has only `flow`.

**D53. A seat's random stream is in the state. (replaces the last sentence
of D16)** The match holds each seat's stream and a driver draws through the
request it is given (`request.pick`), so drivers keep no state. When a seat
draws to decide, its `intent` entry carries `rng`, where the stream then
stood, and `fold` keeps it in `state.streams`. So the positions are in
every snapshot, as the issue asks, and also in the state folded from a log
at any point, which is what a fork starts from. The streams start and step
as before, so every match plays as it did. An `intent` entry was a pure
marker (D14); it now writes this one thing.

**D56. A record is a function of the log.** The `seed` entry carries the
seed as given, and an `intent` carries `of`, how many options the seat had.
With those, `summarize` works a match record out from the log alone, and it
moved from the scripts into core, since the studio's workers need it. A
record's `seed` is now a string, as the log holds it.

### Replay and forks

**D54. Replay is a function, and it re-applies a referee's changes.
(replaces `ReplaySeat` in D15)** `replay(registry, scenario, log)` drives a
match from the log: where the log has a seat's decision it chooses it,
where it has a referee's changes it authors them again, and where it has a
ruling it adjudicates again. After each step the match's log must equal the
log given, entry for entry. `ReplaySeat` is gone: a seat driver is only
asked to choose, so it could not author, and a second way to replay that
skipped edits would be a trap. A run of consecutive entries by one referee
is authored as one batch; the original batches cannot be told apart in the
log, and one batch is checked no more strictly than several.

**D55. A fork is a replay that stops.** `fork(registry, scenario, log, seq)`
replays up to the decision at `seq` and returns the match there, taking a
snapshot of the same log to start from when one is given. It is exact
because of D53 and D54: choosing the same option again reproduces the rest
of the log. A fork is offered only at an `intent` entry, a seat's or a
referee's, since that is where a match can go another way.

### The host

**D49. Explaining a decision re-runs enumeration with everything kept.**
`match.explain()` walks the same code path as `advance`, so its legal
candidates are the decision's options by construction. It evaluates every
gate, where play stops at the first that fails, and notes each call an
expression makes to the space host. It runs in a session of its own so that
a cached derived value still shows the host calls behind it. Why a method
and not a flag on `advance`: it costs several times a plain enumeration, and
a batch never wants it.

**D50. The host contract is written down, order included. (extends D22)**
`docs/host.md` gives each function's arguments, units, result, and edge
cases. Two things were true but unwritten. The order of `neighbors` and
`cellsWithin` is part of the contract, because it decides the order of a
seat's options and so the log. And `inBounds` means "on the map and open to
movement", not only "on the map": a wall inside the map is out of bounds.
That second meaning is a wart, kept because the shipped rules rely on it
and renaming it would have changed how they read for no gain in play.
`compareHosts` checks a host against the reference over a whole map.

**D52. Cell layers are declared by the ruleset, valued by the scenario, and
held by the host. (replaces `space.blocked`)** `space.layers` declares typed
attributes with defaults; a scenario's `space.cells` gives values per cell;
`cellAt(c)` is a sixth host function whose result is typed from the
declarations, so a misspelt layer fails the build. `blocksMove` and
`blocksSight` are expressions over one cell's layers. Core evaluates them
for every cell at load and gives the host plain lists, so a host never runs
CEL and what a batch measures cannot differ from what a view shows. They
cannot read the match: a rule that depended on state would make the host's
answers change under it. A scenario's `blocked` list is gone, since a
second way to block a cell would be one the studio's layer panel could not
show. The values are not in the log; they belong to the map, not the match.

**D51. One way in for expressions that are not in the ruleset.**
`registry.compileExpr` compiles an expression against the registry with
given variables. Scenario end conditions, behaviors, and
`compileExpression` all use it. `compileExpression` adds typed variables
and evaluation on any state or through a seat's view (D30 applies: a secret
is an error).

**D48. The browser check is part of validate.** Core's entry never imported
Node, but nothing held it to that. A test now bundles the worker for the
browser, runs it in a realm with no Node globals, and plays matches in a Web
Worker in headless Chromium, comparing log hashes with Node's. Playwright is
a dev dependency and the workflow installs Chromium. Ajv compiles schemas
with `new Function`, which a strict content security policy forbids; that is
left for the studio to meet.

### Versions

**D57. Format 2, and every ruleset's version went up.** Moving behaviors
out and replacing `blocked` are both breaking for a document, so `format`
is 2 and a format 1 file is refused by name, not by an unknown key. The
recorded matches were regenerated because the log gained `cause`, `of`,
`rng`, and the seed. Before regenerating, all 240 were played and compared
with those fields left out: the logs and records were identical.

## 2026-11-12: maps

A first pass at the playing environment as a thing of its own, starting with
the 5e slice's square grid.

**D58. A map is a document, and `space` is its kind.** The ruleset's `space`
already said what a map is made of: the grid, the layers each cell holds,
and what blocks. What was missing was the map itself, which lived inside
each scenario. It is now a document of its own (`map:`, under
`rulesets/<id>/maps/`), checked against the ruleset by `loadMap` and named
by a scenario with `map: <id>`. Why a document and not an entity kind: a
map is not in the state or the log (D52), nothing in a rule writes it yet,
and the studio needs to draw and paint one before any match exists.
`space` kept its name; renaming it to `map` would have broken every ruleset
for no change in what it says. The format stays 2, since nothing written
before is refused.

**D59. A map is drawn as a picture.** `rows` is one string per row and
`legend` says what each symbol holds; `cells` lists single cells and wins
over the picture. Why: a square grid is read and reviewed far more easily
as a picture than as a list of coordinates, and a diff of one shows what
moved. The first row is `y = 0`, so the picture is addressed as the grid is.
The legend belongs to the map and not to the ruleset, so a ruleset stays
free of presentation.

**D60. A scenario names a map or writes one inline, not both.** The inline
`space` stays: a test, or a board with nothing on it, should not need a
second file. `loadScenario` is given the map documents by id, as plain
data, so core still reads no files.

**D61. Corners are the host's, declared by the ruleset.** `space.corners:
closed` says a diagonal step may not pass the corner of a cell that blocks
movement, as 5e rules for a feature that fills its square. It is in the
host contract because `neighbors` is the host's answer, and a host that cut
corners would play different matches. Only `neighbors` changes. `distance`
and `cellsWithin` are not path lengths (D22) and still count by the
shortest route, which is also how 5e counts range on a grid. The default is
`open`, so the other rulesets play as before.

**D62. Terrain is an enum with tables, not a kind of entity.** The 5e
slice's `terrain` is `open`, `difficult`, or `rock`, and a table,
`squareCost`, gives the feet of movement each costs to enter. `move` reads
it through `cellAt`. Why not a `terrain` kind with instances: a cell layer
holds a plain value (D52), and a table keyed by the enum says the same with
what the format already has. An extension may add tables but not terrains;
opening `enums.terrain` waits until an extension needs it.

**D63. The 5e slice is 0.4.0, and the pack ambush is played on a map.** Its
five boulders moved to `maps/rocky-pass.yaml` with patches of Difficult
Terrain added, so the 40 recorded pack-ambush matches changed and were
regenerated. The other 5e records changed only in `version`: their logs are
the same.

### Where maps go next

Agreed after the first pass, and since built: D70 to D76 say how.

**D64. A map is a bounded plane, and a grid is one expression of rules over
it. (reframes D58)** The plane has an extent and a unit of measure, and
needs nothing else. A grid is a ruleset's rule: it divides the plane into
cells, snaps positions to them, and defines adjacency and step distance.
Everything cell-shaped (layers, the picture and its legend, the blocking
rules, corners) belongs to the grid. "No grid" must stop meaning "no
space": a ruleset can have a map without one, as a poker table is.

**D65. A ruleset says what its maps can be.** Two sets of criteria, both
checked by `loadMap`: on the plane (bounds on the extent, places a map must
have) and on the grid (checks over one cell's values). Criteria over the
whole map that need a path, such as "every area can be reached", are left
out until something needs them.

**D66. A scenario imports a map, writes one inline, or takes the ruleset's
standard map. (extends D60)** Importing is the option that keeps a map
apart from the scenarios played on it; inline stays for the cases where
that does not matter. A ruleset may ship a standard map, used by a scenario
that says nothing, and may declare it the only one allowed. Checkers would
do that in place of the fixed `width` and `height` in its `space`, and
hold 'em would get a table.

**D67. Whether play can change the map is declared by layer, not by one
mode.** A layer is fixed unless the ruleset says `mutable`, and a rule that
writes a fixed layer is refused at compile time. Why by layer: "to what
extent" is then the same declaration as "whether", and a ruleset with no
mutable layer is the classic fixed map with objects on it, at no cost. A
mutable layer also closes a gap: the blocking rules read one cell's values
and never the match (D52), so a door that is an entity cannot block sight,
and a door that is a layer value can.

**D68. A map document is never state. A match holds an overlay.** A write
to a mutable layer is a log event, and state holds only the places the
match has changed; the ground at any moment is the map with the overlay
laid on it. Why: two scenarios on one map must not reach each other, and
`fold`, replay, and forks must keep working from the log alone. The
overlay is addressed by place, not by cell, so a ruleset without a grid
needs no second mechanism. The host stays a pure function of a map: core
works out the blocking for changed cells and hands the host the patched
map, and never pushes changes into a host that keeps state.

**D69. Named places are content every map can have.** A point or an area
with a name, on the plane, with or without a grid. A scenario can then say
where something stands by name, and a map with no grid has something to
hold. Not in this pass: play on a plane without a grid (free positions,
straight-line distance, shapes that block), which is a second set of
questions for the host; cells hidden from some seats; and a map that
changes size during play.

### Building the map plan

**D70. Criteria live in `space`: `size`, `checks`, `places`. (builds D65)**
`size` is a smallest and a largest `[width, height]`. `checks` are bool
expressions over `cell`, compiled where the blocking rules are, so they see
one cell's values and the tables and nothing of a match. The default cell
is checked when the ruleset compiles, a map's cells when it loads, and a
written cell when it is written. `places` lists names every map must have.

**D71. `space.map` names the standard map. (builds D66)** `{ standard: id,
only }`. The ruleset names a map document and does not contain it, so the
map stays a document like any other and core still reads no files; the
check that the document exists is `npm run validate`'s. Checkers dropped
its fixed `width` and `height` for a size of exactly 8 by 8 and its board
as the only map. Hold 'em's table is standard but not the only one, since
the table in the file is laid for four.

**D72. A space with `grid: none` is a plane. (builds D64)** It may declare
a unit, a size, places, and a standard map, and nothing about cells. Its
maps are a size and places in game units. No host is built for one and the
spatial functions refuse, so nothing about play changed for hold 'em; the
table exists for whoever draws it. A ruleset with no `space` section still
has no map at all.

**D73. A place is a point or a rectangle, and scenarios use it by name.
(builds D69)** `{ at, size }`. A scenario's `cell` field may be a place's
name, resolved when the scenario loads, so the log and the state hold
cells as before. Expressions cannot read places yet: a rule that needs one
would want its name checked at compile time, which only the ruleset's
required `places` could give, and nothing shipped asks for it.

**D74. The `at` effect writes the ground. (builds D67)** `at: <cell>` with
`set: { layer: expr }`. Why a new effect and not an address in `set`: a
`set` key is an address of state, and a cell is not one. The compiler
refuses a layer that is not `mutable`. A referee's `author` takes the same
change and is held to the same rule: mutable is what the ruleset allows,
not who is asking.

**D75. The overlay is `state.ground`, and the host is rebuilt per ground.
(builds D68)** One `ground` log entry per layer written; state holds only
the written layers, by `"x,y"`. `Scenario.mapAt(state)` and the host come
from the map patched with the overlay, kept by the overlay's identity, so
`fold`, replay, forks, and snapshots needed no change of their own. The
cost is one host built per write to the ground; a ruleset that never
writes builds one host, as before. Blocking is worked out again only for
written cells. The overlay is keyed by cell for now: "by place" in D68
meant that the event and the state are not shaped around a grid, and a
key is all that would change.

**D76. The 5e proof is a spell form, `ground`.** `castGround` turns the
open squares within a spell's radius into the terrain it `leaves`; Grease
in the mage duel leaves Difficult Terrain under an enemy. Its saving
throw and its duration are not written: the ground stays changed for the
match. Rime casts it as an opening move, in 12 of the 40 recorded duels,
which were regenerated. Checkers and hold 'em went to 0.2.1 and their logs
are unchanged.

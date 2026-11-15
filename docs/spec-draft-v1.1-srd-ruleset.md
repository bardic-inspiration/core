# v1.1 specification draft: the SRD 5.2 ruleset

A working draft of one v1.1 goal: the full rules of D&D 5e (SRD 5.2) as a
ruleset, and the testing that shows the model covers them. It is **not
contract**: nothing is built against it. It is folded into
[`SPEC.md`](../SPEC.md) with the other v1.1 drafts, and this file is deleted.

## Goal

A ruleset that models the rules of the SRD 5.2, with enough content to
exercise each rule, and a measure of how much of the SRD it covers.

- **The rules are the success condition; the content is not.** Every rule
  is modelled or accounted for. Authoring every SRD spell, monster, and item
  goes on after v1.1.
- **All twelve classes are in**, levels 1 to 20, each with the subclass the
  SRD gives it, along with feats and species traits.
  Why: a class feature changes how something resolves, so it is a rule, and
  the classes are the largest part of the SRD's rules.
- **The ruleset is the format's proof.** A rule the format cannot express
  is a gap in the format, never code in the ruleset (`INV-1`).

## What exists

The [5e slice](../rulesets/dnd-5e-2024-slice/ruleset.yaml) is a combat slice:
initiative, turns, grid movement, weapon attacks, opportunity attacks,
saving throws, damage types, and spellcasting with slots, reactions, and
concentration. Against the SRD it leaves:

- **Combat, partly.** Four conditions of fifteen. No death saves, cover,
  creatures larger than one square, grappling, lines or cones, or hiding.
- **Everything outside combat.** Ability checks and skills, resting,
  building and levelling a character, equipment, magic items, exploration,
  and social interaction.
- **No home for content.** Stat blocks and spells are written inline in
  each scenario, so nothing is shared between scenarios.
- **Tests that hunt for dice.** A rule test that needs a particular roll
  searches seeds until one gives it (`findSeed` in
  [`tests/helpers.ts`](../tests/helpers.ts)).

## Direction

Each of these is decided in outline and still needs its precise rules.

### The hierarchy of documents

Six levels, in order of dependency. A document refers only to levels above
its own, and is checked against them.

| Level | Holds |
|---|---|
| System | Core itself: the format, the runtime, the function library, the kit. |
| Ruleset | Declarations: kinds, relations, intents, procedures, the flow, the space. |
| Extension | Changes to what its base ruleset leaves open. |
| Content | Instances of declared kinds: maps, stat blocks, spells, items, lasting effects. |
| Scenario | Which content is in play, where it stands, who is seated, and when it ends. |
| Match | A scenario, a seed, seat bindings, and decisions; its log. |

- **Content is a level of its own.** A scenario names content; it does not
  write a stat block or a spell inline. A content document names the
  ruleset and the extensions it needs, as a behavior set does.
- **Content never declares.** Something is content when it can be written
  as an instance of a declared kind with no new rule. Fire Bolt is content:
  a spell of the `attack` form. Counterspell is a rule: a form of its own.
  Why: the test pushes the ruleset to generalise until most of the SRD is
  data, which is what lets the remaining content be filled in afterwards.
- **A behavior set sits beside content**: compiled against a ruleset and
  its extensions, and named by a scenario.
- **A scenario places content by reference.** One stat block stands for
  many creatures, each with its own position, seat, and state.

### Characters

- **Building a character is play.** Creating one and levelling it up are
  intents chosen in a match, gated like any other, so a legal character is
  one the rules allowed to be built.
- **A character outlives its match.** It can be exported from one match and
  brought into another, so a match does not always begin from blank
  characters. An export is a content document: the character and what it
  owns, with their state as it stood.
- **A match is given its characters.** A scenario may leave places for
  characters that the run fills, as it binds seats. They enter through
  setup, so the log still rebuilds the match by itself (`INV-4`).
- **An imported character is held to the kind's checks, not to its
  history.** The checks on a character are therefore strong enough to
  refuse one the intents could not have built (`INV-2`).
  Why: the log that proved each choice legal does not travel with the
  character, and requiring it would tie every character to every match it
  has been through.
- **What the checks refuse and what the intents allow are tested against
  each other**: every character built by play passes the checks.

### Two modes of play

The SRD's rules fall into combat and everything else, and the two are held
to different tests.

- **Combat is played.** It has a scheduler, seats with real choices, and an
  end, so it is tested by simulated matches as well as by rule tests.
- **Noncombat rules are correct and callable, not self-playing.** Each is
  an intent or a procedure, exercised by scripted decisions and the referee
  seat. Nothing schedules a noncombat session.
  Why: noncombat play leans on a Dungeon Master, and seats for people and
  agents are outside v1.1.
- **Building a character is the exception.** It needs no Dungeon Master, so
  it is played: seats choosing at random build characters in simulated
  matches, and every one must pass the checks.
- **The seams are rules too**: entering combat (initiative, surprise),
  leaving it, and resting between fights.

### The coverage ledger

- The SRD 5.2 is broken into **rule units**, by chapter. Each unit is
  **modelled**, **left to the referee** (the rule calls for a ruling no
  data can make), or **out of scope**, with a reason.
- Each modelled unit names the tests that hold it. `check` fails when a
  named test does not exist, or a unit has no status.
- Coverage is the share of units modelled, reported per chapter and per
  mode.

### Hard problems first

The ruleset is built in the order that exposes the format soonest, not in
the SRD's chapter order. A hard problem is one likely to need the format to
grow. Each is opened by a spike that tries to write it and records what
could not be expressed; the format change is specified and built before the
rules that need it.
Why: once the hard cases have fixed the shape of the kinds and forms, the
rest is content of a known shape.

Candidates, to be ordered:

- The content level, and placing content by reference.
- A character built from class levels: features gained by level, and the
  choices made along the way.
- Spellcasting in full: preparation, slot tables, pact magic, rituals,
  upcasting, areas of effect, durations measured in time.
- Time outside combat, and effects that last across both modes.
- Sight: light, obscurement, hiding, invisibility, and attacks by or
  against an unseen creature.
- Position: creatures larger than one square, cover, grappling, mounts.
- Rolls in flight: advantage from many sources, rerolls, bonuses added
  after the roll.
- Changing form: a creature that takes another stat block, and summoned
  creatures.
- Equipment: armor, weapon properties and mastery, attunement, carrying.
- The fifteen conditions and how they combine, exhaustion, death saves,
  temporary hit points, resistance, vulnerability, and immunity.

### Testing

Five layers, each catching what the others cannot.

| Layer | Holds |
|---|---|
| Rule tests | One or more per modelled unit: scripted decisions and known rolls, asserting on the log and the state. |
| Content conformance | Every stat block's derived numbers equal the published ones. |
| State properties | Every kind check holds after every simulated match, character-building matches included. |
| Rule coverage | Core reports which intents, procedures, reactions, and branches of a compiled ruleset a set of matches ran. A rule nothing ran is reported. |
| Recorded matches | Regression, over scenarios chosen to span the ledger's combat units. |

- **Rule coverage is a core feature**, not a 5e one: any ruleset's matches
  can be measured the same way.
- **A rule test gives its rolls.** It does not search for a seed.

## Open questions

- **What does a character own?** An export takes the character and what
  belongs to it (its equipment) and leaves what does not (a spell another
  creature is concentrating on). Whether a relation says which it is.
- **What of a character is the match's and not its own?** Position,
  initiative, and a turn's budgets do not travel.
- **Can a character cross ruleset versions**, or sets of extensions?
- **How is a choice among many made at a prompt?** Enumeration lists every
  binding, so preparing six spells of thirty cannot be one intent.
- **How does a test fix a roll** without breaking `INV-3` and `INV-4`: a
  scripted stream in place of the seeded one, or a referee's ruling?
- **How is a template distinguished from an instance**, and which content
  is copied into a match (a creature) and which is shared (a spell)?
- **How much of a monster is a rule?** Whether every trait and action in
  the SRD's stat blocks is a ledger unit, or only the mechanisms they are
  built from.
- **What is a rule unit's size**, and where does the ledger live: a data
  file `check` reads, or annotations in the ruleset?
- **What coverage is enough?** The numbers for the quality bars: share of
  units modelled, share left to the referee, and rule coverage.
- **How is time kept outside combat**, so that a duration of an hour and a
  rest mean something without a scheduler?
- **Does the slice become the full ruleset, or stand beside it?**
- **Is content conformance checked against ttrpg-library**, or only against
  numbers written into the content itself?

## Out of scope for v1.1

- **Every SRD entity.** The full lists of spells, monsters, and magic items
  are authored after v1.1.
- **The translator** from ttrpg-library, which stays its own project.
- **Self-playing noncombat sessions**, and a Dungeon Master seat driven by
  a person or an agent.
- **Rules outside the SRD 5.2.**

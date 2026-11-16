# Spec: the SRD 5.2 ruleset

The rules of D&D 5e (SRD 5.2) as a ruleset, the document levels it needs,
and the testing that shows the model covers them. An area of
[`SPEC.md`](../../SPEC.md).

`Planned (#TBD):` everything in this file. What `main` has is the
[5e slice](../../rulesets/dnd-5e-2024-slice/ruleset.yaml): initiative,
turns, grid movement, weapon attacks, opportunity attacks, saving throws,
damage types, four conditions, and spellcasting with slots, reactions, and
concentration, with stat blocks and spells written inline in each scenario.

## Goal

A ruleset that models the rules of the SRD 5.2, with enough content to
exercise each rule, and a measure of how much of the SRD it covers.

- **Combat is modelled in full.** Every combat rule is modelled or
  accounted for in the ledger ([Coverage](#coverage)).
- **Noncombat rules are modelled by example.** Enough cases, ability checks
  among them, are modelled to give a basis for designing encounters. The
  SRD's open-ended rules for interacting with the world are not covered in
  full.
- **The rules are the success condition; the content is not.** The ruleset
  does not hold every SRD spell, monster, and item.
- **All twelve classes are in**, levels 1 to 20, each with the subclass the
  SRD gives it, along with feats and species traits, and a character is
  built by play ([Characters](#characters)).
  Why: a class feature changes how something resolves, so it is a rule, and
  the classes are the largest part of the SRD's rules.
- **The classes are modelled for combat first.** A noncombat feature that
  the tests cannot exercise is stubbed: present in the ruleset with no
  effect, and listed as stubbed in the ledger.
- **The ruleset is the format's proof.** A rule the format cannot express is
  a gap in the format, never code in the ruleset (`INV-1`).
- **Only the SRD 5.2.** A rule from outside it is not in the ruleset.
- **The 5e slice grows into this ruleset.** There is one 5e ruleset, not a
  slice and a full one side by side.

## The hierarchy of documents

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
  write a stat block or a spell inline. A content document names the ruleset
  and the extensions it needs, as a behavior set does.
- **Content never declares.** Something is content when it can be written as
  an instance of a declared kind with no new rule. Fire Bolt is content: a
  spell of the `attack` form. Counterspell is a rule: a form of its own.
  Why: the test pushes the ruleset to generalise until most of the SRD is
  data, which is what lets the remaining content be filled in afterwards.
- **A behavior set sits beside content**: compiled against a ruleset and its
  extensions, and named by a scenario.
- **A scenario places content by reference.** One stat block stands for many
  creatures, each with its own position, seat, and state.

## Characters

- **Building a character is play.** Creating one and levelling it up are
  intents chosen in a match, gated like any other, so a legal character is
  one the rules allowed to be built.
- **A character outlives its match.** It can be exported from one match and
  brought into another. An export is a content document: the character and
  what it owns, with their state as it stood.
- **Whoever calls the export chooses what it takes**, and an export takes
  everything of what is chosen. Nothing in the ruleset marks what travels.
- **A match is given its characters.** A scenario may leave places for
  characters that the run fills, as it binds seats. They enter through
  setup, so the log still rebuilds the match by itself (`INV-4`).
- **The scenario's place for a character overrides what the export
  carried.** A position, or anything else the place gives, replaces the
  exported value.
- **A link to an entity that is not in the match is not made.** The import
  reports it as a warning and setup goes on.
  Why: an export takes everything, so it carries links that meant something
  only in the match it left; refusing the character for them would make
  every export unusable until exports are narrowed.
- **An imported character is held to the kind's checks, not to its
  history.** The checks on a character are strong enough to refuse one the
  intents could not have built (`INV-2`).
  Why: the log that proved each choice legal does not travel with the
  character, and requiring it would tie every character to every match it
  has been through.
- **Every character built by play passes the checks.**
- **A choice of several is made one at a time**
  ([`decisions.md`](decisions.md) "Decisions with large ranges"). The
  ruleset may also offer presets, for configuring a class and for preparing
  spells, that make many such choices at once.

## Monsters

- **A monster is content built from parts.** The ruleset declares each
  recurring type of trait and action once, as a **part** with its numbers
  left open, and a stat block fills parts in.
- A part is a declaration in the ruleset. It is not a pattern of the kit
  ([`format.md`](../format.md) "Patterns"), though a part may be written
  with one.
- **A part is a rule unit**: it has its own tests and at least one stat
  block that uses it.
- **A unique trait or action is excluded until it is examined.** So is a
  rule closer to flavor than mechanism: the open-ended use of Wish is not
  modelled.
  Why: a part written for one stat block is a rule nothing else tests, and
  the unique cases are where a wrong generalisation is most likely.

## Two modes of play

- **Combat is played.** It has a scheduler, seats with real choices, and an
  end, so it is tested by simulated matches as well as by rule tests.
- **Noncombat rules are correct and callable, not self-playing.** Each is an
  intent or a procedure, exercised by scripted decisions and the referee
  seat. Nothing schedules a noncombat session.
  Why: noncombat play leans on a Dungeon Master, and no seat is driven by a
  person or an agent.
- **Building a character is played**: seats choosing at random build
  characters in simulated matches, and every one passes the checks.
- **The seams are rules**: entering combat (initiative, surprise), leaving
  it, and resting between fights.

## Coverage

- The SRD 5.2 is broken into **rule units**, by chapter. Each unit is
  **modelled**, **stubbed** (present with no effect), **left to the
  referee** (the rule calls for a ruling no data can make), or
  **excluded**, with a reason.
- Each modelled unit names the tests that hold it. `check` fails when a
  named test does not exist, or a unit has no status.
- Coverage is the share of units modelled, reported per chapter and per
  mode.

## Testing

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
- **A rule test gives its rolls.** It does not search for a seed. Giving
  rolls is a debug override for tests, not a part of play
  ([`SPEC.md`](../../SPEC.md) "The log, replay, and forks").

## Open questions

Not contract. Resolve one by editing this file, then delete it here.

- **Can a character cross ruleset versions**, or sets of extensions?
- **How is a template distinguished from an instance**, and which content is
  copied into a match (a creature) and which is shared (a spell)?
- **Are spells and magic items built from parts as monsters are**, with an
  exclusion list for the rest?
- **What is a rule unit's size**, and where does the ledger live: a data
  file `check` reads, or annotations in the ruleset?
- **Where does combat end?** Which rule units count as combat, and so must
  be modelled: the seams, resting, a spell with uses in and out of a fight.
- **Which noncombat examples are enough**, and does the ledger list the
  noncombat chapters at all?
- **Where is an import's warning reported?** Core refuses or accepts today;
  it has no warnings.
- **How is time kept outside combat**, so that a duration of an hour and a
  rest mean something without a scheduler?
- **What is the ruleset's id** once it is no longer a slice?
- **Is content conformance checked against ttrpg-library**, or only against
  numbers written into the content itself?
- **Which format changes do the hard cases need?** Each is unknown until it
  is tried: a character built from class levels; spellcasting in full
  (preparation, pact magic, rituals, upcasting, areas, timed durations);
  sight (light, obscurement, hiding, invisibility); position (creatures
  larger than one square, cover, grappling, mounts); rolls in flight
  (advantage from many sources, rerolls, bonuses after the roll); changing
  form and summoning; equipment (armor, weapon properties and mastery,
  attunement, carrying); the fifteen conditions, exhaustion, death saves,
  temporary hit points, resistance, vulnerability, and immunity.

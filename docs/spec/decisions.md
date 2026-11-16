# Spec: decisions

How a seat's decision is asked for, chosen, and recorded, and how scripted
seats choose. An area of [`SPEC.md`](../../SPEC.md).

The syntax of prompts and behavior sets is in
[`format.md`](../format.md) "Prompts and the flow" and "Behaviors"; the calls
an engine makes are in [`host.md`](../host.md) "Driving a match".

Core is genre-neutral (`INV-1`): every mechanism here is one any ruleset can
use, and what is specific to a kind of play, such as tactics on a grid,
lives in a behavior set, never in the runtime.

## Ask, choose, record

Every decision in a match goes through the same three stages.

### Ask

- A `prompt` effect names a seat, the params it gives (`with`), and the
  intents or menus on `offer`.
- The runtime enumerates every binding of the offered intents' remaining
  params: intents in the order offered, params in the order declared, each
  param's `in` list in its own order.
- An **option** is a binding whose gates all hold. Domains and gates are
  evaluated through the deciding seat's view.
- The **decision** is the seat and its options, in enumeration order. The
  order is contract: it reaches the log.
- With no option, no decision is made: `ifNone` runs if this was the
  prompt's first asking, and the prompt ends. A decision with one option is
  still asked.
- With `repeat`, the seat is asked again after each chosen intent resolves,
  until an intent runs `done` or there is no option.

### Choose

- A **driver** is given a request and returns the index of one option:

  | Field | Holds |
  |---|---|
  | `seat` | The deciding seat. |
  | `options` | The decision's options. |
  | `state` | The state through the seat's view. |
  | `scores(behavior)` | A behavior's score for each option. |
  | `pick(count)` | An integer in `[0, count)` drawn from the seat's own stream. |

- A driver keeps nothing between decisions. Its only chance is `pick`.
- A seat's stream is keyed by the match seed and the seat, and is apart from
  the rules' dice.
- Two drivers ship. The random driver picks uniformly. The utility driver
  takes the option its behavior scores highest and picks among ties.
- A seat is driven by the behavior the run binds to it, else the one its
  scenario names, else at random. Binding an unknown seat or behavior is
  refused.
- A person or an agent fills a seat the same way: `advance()` returns the
  decision, and `submit(index)` takes it.

### Record

- The choice is one `intent` entry: `seat`, `intent`, `params`, `of` (how
  many options there were), `cause`, and, when the seat drew from its
  stream, `rng` (where the stream then stood).
- Choosing an index that is not an option is an error and records nothing.
- A replay or a fork restores each seat's stream from the log, so a decision
  chosen again is chosen the same way (`INV-3`, `INV-4`).

## Behaviors

- A behavior gives a **score** per intent: a numeric expression over that
  intent's params and `seat`, evaluated through the seat's view. An intent
  it does not score counts as 0.
- A **goal** has a name, a condition, and a factor per intent. While its
  condition holds for an option, that option's score is multiplied by the
  factor. Goals apply in the order declared. A negative factor reverses a
  score.
- Behavior sets given together merge in order: a later set adds behaviors,
  and adds to or replaces the scores and goals of earlier ones, a goal by
  its name.
- A behavior set is compiled against one registry, and scoring with it in a
  match of another is an error.

## Explaining

- `match.explain()` gives, for the pending decision, every candidate binding
  of every offered intent, legal or not, with each gate's result and every
  host call made. Its legal candidates are the decision's options, in order.
- `Planned (#TBD):` **A choice can be explained.** For a pending decision
  and a behavior: each option's score, the value of each consideration that
  made it, and each goal that scaled it.
- Explaining changes nothing in the match.

## Scoring

`Planned (#TBD):`

Scoring is a multi-step algorithm. Four levels each supply a part of it:

| Level | Supplies |
|---|---|
| Core | The mechanics of consideration and selection, and the outer bounds on awareness, memory, and prediction. |
| Ruleset | The sources of input available, the calculations, and the outputs: how awareness, memory, and prediction are worked out for this game. |
| Behavior | Configuration: **profiles**, preset or derived. |
| Scenario and the current turn | The inputs themselves. |

- **A seat owns its awareness, its memory, and its profile.** Core knows
  seats, not which entity is acting. A seat that plays several entities
  knows as one what any of them perceives. A ruleset that wants each
  creature to know only its own gives each its own seat.
- A seat's **considerations** are assembled from three sources: its
  awareness, its memory, and its predictions.
- Scoring reads the three and derives a selection set by applying sets of
  weights that the ruleset and the behavior define. A weight may read
  anything in the state: an entity's own fields can bear on its scoring.
- A consideration is a named, typed term, mapped through a **response
  curve**, and shared by name between the scores, goals, and behaviors of a
  set and of the sets merged over it.
  Why: a consideration is small enough to read, reuse, and inspect one at a
  time, where a nested expression is not.
- A position is scored as a consideration over a param's value. Core has no
  notion of scoring cells; a cell is one type of param among others.

### Awareness

- Awareness is the part of the current state a seat can perceive.
- The ruleset says how it is worked out. In hold 'em it is whether a card is
  hidden or revealed; in the 5e ruleset it turns on checks such as
  Perception and Insight.
- By default a seat is aware of everything its own entities hold. A ruleset
  may make a seat unaware of some of its own values.

- **Awareness is a second layer over `visible`, related but separate.**
  `visible` is the legal gate: it bounds a seat's options, and is applied at
  a decision before the seat's awareness is worked out again.
- Awareness and `visible` need not agree. A seat may be aware of something
  it cannot see, as a presence nearby; and may lose sight of something and
  stay aware that it exists.
- Awareness is per fact, and has an age. A seat that loses sight of a
  hiding goblin still knows the goblin exists; what it knows of the goblin's
  position is what it last perceived, now one turn stale.
- A seat may act on stale awareness: shoot at where the goblin was, or
  weigh the hiding places within reach of that square.

### Memory

- Memory is the part of the log a seat perceived, filtered by its awareness
  as each event occurred: an event is perceived or not, and a perceived
  event is remembered.
- Memory has a **length**, a whole number of events, and a **decay**: a
  weight on each remembered event that falls with time or with other
  parameters the ruleset names.
- In its simplest form an event is remembered or not. A ruleset may weight
  it instead, by proximity or by another mechanism it defines.

### Where memory lives

- The log is core's single source of truth for every event of a match. It
  is not the source of information for a seat that is deciding: a seat
  decides from its memory.
- A seat's memory is state held apart from the log. A memory is not a log
  entry, and `fold` does not give it.
  Why: a seat does not read other entities' data when it remembers their
  behavior, and the log holds all of it.
- Forming a memory is deterministic, so replaying a log rebuilds every
  seat's memory as it was, and a snapshot carries it (`INV-3`, `INV-4`).

### Prediction

- Prediction extrapolates from a seat's awareness, and has the same four
  levels as the rest of scoring: core's mechanics, the ruleset's definition,
  the behavior's profile, and the seat's own filtering of its memory, which
  a ruleset may tie to the fields of the seat's entities.
- A seat predicts the actions of an entity that is not its own. For one it has not
  encountered, it applies its own profile to what its awareness shows of the
  other at that moment.
- As events caused by the other entity enter its memory, they weight the
  prediction.
- A **prediction** of another entity is a weighted list of the intents it
  may choose next, from the state as it stands. Nothing of the other
  entity's is played forward.
- The intents a predictor may consider are filtered. The ruleset holds the
  conditions under which information about another entity is discovered and
  may be used. In hold 'em every seat knows every intent, and only the
  cards are hidden. In the 5e ruleset what a character knows of another's
  options depends on its situation.
- Where the predictor does not know the other's options, the list is a
  guess from two sources: the assumptions in its profile about what
  entities of a type typically do, and its memory of what like entities
  have done.
- The more precedent memory holds, and the more consistent it is, the more
  memory weighs against the profile's assumptions.
- A prediction draws only on what the seat itself perceived and still
  remembers.

### Predicting itself

- A seat may predict its own actions. This is lookahead: it weighs a
  path of its own decisions, not only the next one.
- By default a seat is fully aware of its own capabilities and fully
  confident in them.
- A path that passes through an outcome of chance outside the seat's
  control, such as a leap that calls for an Athletics check, carries less
  confidence, by a blind assessment of the probability.

### What a seat does not know

- **A seat's knowledge and its prediction model are separate.** A prediction
  never reads another seat's data. It is compiled from precedent in the
  seat's memory, and falls back on its profile where there is none.
- Where a path reaches something the seat cannot know (a roll, another
  entity's decision, a hidden value), the weight comes from the same two
  sources: a default in its profile, and what its memory has taught it.
- A profile's assumption is conditioned on what the seat is aware of, not
  on the other entity's state. A worg assumes a hostile creature that has
  not yet used its reaction will make an opportunity attack; it does not
  read the scout's attack bonus or its intent.
- Memory supports inference about what is hidden. A creature that has hit
  often against its creature's Armor Class is taken to have a high attack
  bonus; a caster seen to cast Shield is taken to have it prepared, and to
  be likely to hold its reaction for it.
- Where there is no information at all, the profile says what that is
  worth: nothing, or a greater threat. A profile may be optimistic,
  pessimistic, or neutral under uncertainty.

### Bounds

- The parameters of awareness, memory, and prediction are bounded by core,
  for performance and to prevent failure; defined within those bounds by the
  ruleset; and set within the ruleset's definition per seat, from the state.
  In the 5e ruleset a seat's memory length may follow its creature's
  Intelligence, its awareness of some types of event its Perception, and the
  weight it gives remembered actions of other creatures its Insight.

## What scoring is held to

`Planned (#TBD):`

- **The aim is a decision model that responds to its configuration**, not
  the one that wins most. A dull goblin plays like a dull goblin, a
  brilliant wizard like a brilliant wizard, a reckless barbarian like a
  reckless barbarian.
- The mechanics compile and run under a variety of configurations, in more
  rulesets than the 5e one (`INV-1`).
- Test fixtures show the pipeline works, as properties over the logs of many
  matches:
  - an outcome a seat holds less probable is chosen less often;
  - profiles configured differently play differently, in the way each
    profile's description says;
  - a seat more aware of what an entity may do predicts it more accurately.
- Two failures are looked for by name: information that consistently
  outweighs everything else in a decision, and information that is ignored.
- Core exposes measures of the pipeline for analysis, so a configuration
  can be refined against them.

## Decisions with large ranges

`Planned (#TBD):`

- **A decision is hierarchical.** An intent whose params have a very large
  range is not listed once per binding. In hold 'em the decision's list is
  `raise`, `call`, `fold`.
  Why: listing every binding of a wide param is inefficient at best and
  impossible at worst, and cutting the range to a few values changes the
  game.
- **A scalar param with a range is a parameter of the decision**, not an
  entry in its list. The amount of a raise is given by the seat that chooses
  `raise`.
- A scripted seat derives such a value from its profile, its awareness, its
  memory, and its predictions.
- **The legal values of such a param are worked out before the intent is
  offered.** An intent with no legal value is not offered, so a seat is
  never offered what it cannot choose, and a prompt still knows when
  nothing is legal.
- A value outside the legal ones is refused as an index that is not an
  option is: an error that records nothing.
- **Several of many are chosen one at a time**, as a sequence of single
  decisions: six spells of thirty are six decisions.

## Selection

`Planned (#TBD):`

- A behavior declares how it selects: the highest score, or a pick among the
  highest weighted by score, drawn from the seat's stream.
  Why: weighted selection gives varied play from one behavior and stays
  deterministic.

## Path distance

`Planned (#TBD):`

- Path distance between two cells is a space function: the length of the
  shortest route through `neighbors`, in game units. Only a ruleset that
  declares a grid can call it.

## Open questions

Not contract. Resolve one by editing this file, then delete it here.

- **Which measures does core expose, and what do the properties require as
  numbers?** How often is "less often", and over how many matches.
- **What does lookahead run?** Whether an entity's own intents are applied
  through the rules' effects on a copy of what it is aware of, or the path
  is weighed without running any rule; and where a path ends.
- **How are a profile's assumptions and memory's inferences written?** What
  an assumption is conditioned on, what it yields, and how a pattern of
  remembered events becomes a weight.
- **How far does lookahead reach**, in what unit, and how many paths may it
  weigh? Core has no notion of a turn; the flow is the ruleset's.
- **How is "like" decided** between a remembered entity and the one being
  predicted, and how are the amount and consistency of precedent measured?
- **How is awareness's age counted**, when core has no notion of a turn,
  and how does a stale fact differ from a memory?
- **What is a profile**, and what does a derived one derive from?
- **What are core's bounds**, as numbers?
- **Is rule data that exists only for behaviors acceptable**, or does a
  behavior set get somewhere of its own to derive such values?
- **How are considerations combined?** A product, a sum, or declared per
  score; and whether a score with more considerations is compensated.
- **Which response curves exist**, and are they a closed set like the
  effects?
- **Where does path distance come from?** A seventh host function, or core
  working it out from `neighbors`. Either changes the host contract's
  version.
- **How are a ranged param's legal values declared**, so that they are
  worked out without listing each: as bounds given by expressions, and
  whether a gate may still read the param.
- **How far does the hierarchy go?** Whether every param is chosen level by
  level after the intent.
- **How is a decision with a given value recorded, explained, and counted**
  (`of`) in the log?
- **Do the old score expressions remain** beside considerations, or is
  every shipped behavior set rewritten and the old form refused?

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
- By default an entity is aware of everything it holds. A ruleset may make
  an entity unaware of some of its own values.

### Memory

- Memory is the part of the log a seat perceived, filtered by its awareness
  as each event occurred: an event is perceived or not, and a perceived
  event is remembered.
- Memory has a **length**, a whole number of events, and a **decay**: a
  weight on each remembered event that falls with time or with other
  parameters the ruleset names.
- In its simplest form an event is remembered or not. A ruleset may weight
  it instead, by proximity or by another mechanism it defines.

### Prediction

- Prediction extrapolates from a seat's awareness, and has the same four
  levels as the rest of scoring: core's mechanics, the ruleset's definition,
  the behavior's profile, and the entity's own filtering of its memory,
  which a ruleset may tie to the entity's fields.
- An entity predicts the actions of another entity. For one it has not
  encountered, it applies its own profile to what its awareness shows of the
  other at that moment.
- As events caused by the other entity enter its memory, they weight the
  prediction.
- A **prediction** is a weighted list of the intents the other entity may
  choose next, from the state as it stands. Nothing is played forward.
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
- A prediction draws only on what the entity itself perceived and still
  remembers.

### Bounds

- The parameters of awareness, memory, and prediction are bounded by core,
  for performance and to prevent failure; defined within those bounds by the
  ruleset; and configurable within the ruleset's definition per entity. In
  the 5e ruleset an entity's memory length may follow its Intelligence, its
  awareness of some types of event its Perception, and the weight it gives
  remembered actions of other creatures its Insight.

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

- **How does a seat act coherently over its own turn of many decisions?**
  A score sees one option and the current state, and a turn in the 5e slice
  is many decisions (`move` is one square), so "walk four squares, then
  attack" cannot be weighed against "attack now". Prediction concerns other
  entities and plays nothing forward, so it does not answer this.
- **How is "like" decided** between a remembered entity and the one being
  predicted, and how are the amount and consistency of precedent measured?
- **How does awareness relate to `visible`?** Today a seat's options and
  scores are worked out through its view, and reading a hidden value there
  is an error.
- **Whose awareness and memory does a decision use** when a seat drives
  several entities, or none?
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
- **Can a param's domain be a range?** Enumeration lists every binding, so
  hold 'em's raise is cut to four amounts.
- **Do the old score expressions remain** beside considerations, or is
  every shipped behavior set rewritten and the old form refused?

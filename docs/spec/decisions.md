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
  intents or menus on `offer`. A menu stands for its intents, in place; an
  intent offered twice is offered once.
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
- `Planned (#19):` **A choice can be explained.** For a pending decision
  and a behavior: each option's score, the value of each consideration that
  made it, and each goal that scaled it.
- Explaining changes nothing in the match.

## Scoring

`Planned (#19):`

Scoring is a multi-step algorithm. Four levels each supply a part of it:

| Level | Supplies |
|---|---|
| Core | The mechanics of consideration and selection, and the outer bounds on awareness, memory, and prediction. |
| Ruleset | The sources of input available, the calculations, and the outputs: how awareness, memory, and prediction are worked out for this game. |
| Behavior | Configuration: **profiles**, preset or derived. |
| Scenario and the current turn | The inputs themselves. |

- **An agent owns its awareness, its memory, and its profile.** An agent
  is an entity that decides; a prop never does, and knows nothing. A seat
  owns any number of agents and an agent has exactly one seat, so a seat
  that plays several creatures decides for each from what that one knows.
  Why: knowledge held by the seat made every creature of a seat know what
  any of them perceived, and left a ruleset to split seats to prevent it.
- A ruleset whose seats decide has an agent for each: in hold 'em a player
  is the agent under each seat, and the cards and chips are props.
- **Version 1.1 builds a foundation**, not the whole of this section: a
  first layer that puts awareness, memory, and prediction to work together
  at their simplest. Which statements below that layer holds is an open
  question, and the rest stays a brief for a later version.
- An agent's awareness, memory, and predictions are worked out again only
  for what has changed since they were last worked out
  ([`SPEC.md`](../../SPEC.md) "Work in proportion to change").
- An agent's **considerations** are assembled from three sources: its
  awareness, its memory, and its predictions.
- Scoring reads the three and derives a selection set by applying sets of
  weights that the ruleset and the behavior define. A weight reads only
  what the agent is aware of or remembers; an agent's own fields can bear
  on its scoring.
- A consideration is a named, typed term, mapped through a **response
  curve**, and shared by name between the scores, goals, and behaviors of a
  set and of the sets merged over it.
  Why: a consideration is small enough to read, reuse, and inspect one at a
  time, where a nested expression is not.
- A position is scored as a consideration over a param's value. Core has no
  notion of scoring cells; a cell is one type of param among others.

### Awareness

- Awareness is the part of the current state an agent can perceive. It is
  present tense: what is visible to the agent now.
- **Awareness is what `visible` gives, worked out for an agent.** There is
  one mechanism, not two: it bounds the options of a decision the agent
  makes, and it is what the agent's scoring reads.
- An agent is not aware of anything hidden from it. What it knew of a thing
  before that thing was hidden is memory, not awareness.
- The ruleset says how it is worked out. In hold 'em it is whether a card is
  hidden or revealed; in the 5e ruleset it turns on checks such as
  Perception and Insight.
- By default an agent is aware of everything of its own. A ruleset may make
  an agent unaware of some of its own values.
- A seat's view is everything any of its agents is aware of.

### Memory

- Memory is past tense: what an agent was aware of, and the events of the
  log it perceived as each occurred. An event is perceived or not, and a
  perceived event is remembered.
- An agent that loses sight of a hiding goblin is no longer aware of it,
  and remembers it: that it exists, and where it last perceived it.
- An agent may act on what it remembers: shoot at where the goblin was, or
  weigh the hiding places within reach of that square.
- Memory has a **length**, a whole number of events, and a **decay**: a
  weight on each remembered event that falls with time or with other
  parameters the ruleset names.
- In its simplest form an event is remembered or not. A ruleset may weight
  it instead, by proximity or by another mechanism it defines.

### Where memory lives

- An agent that is deciding does not read the log: it decides from its
  memory.
  Why: the log holds every event of the match, and an agent remembers only
  what it perceived.
- **What an agent perceived is in the log**, in a form that can be told
  apart from the rest and left out, so a log of the rules alone does not
  grow with it. Replaying or folding a log gives every agent's memory as it
  was (`INV-3`, `INV-4`).

### Prediction

- Prediction extrapolates from an agent's awareness, and has the same four
  levels as the rest of scoring: core's mechanics, the ruleset's definition,
  the behavior's profile, and the agent's own filtering of its memory, which
  a ruleset may tie to the agent's fields.
- An agent predicts the actions of another agent. For one it has not
  encountered, it applies its own profile to what its awareness shows of
  the other at that moment.
- As events caused by the other agent enter its memory, they weight the
  prediction.
- A **prediction** of another agent is a weighted list of the intents it
  may choose next, from the state as it stands. Nothing of the other
  agent's is played forward.
- The intents a predictor may consider are filtered. The ruleset holds the
  conditions under which information about another agent is discovered and
  may be used. In hold 'em every player knows every intent, and only the
  cards are hidden. In the 5e ruleset what a character knows of another's
  options depends on its situation.
- Where the predictor does not know the other's options, the list is a
  guess from two sources: the assumptions in its profile about what
  entities of a type typically do, and its memory of what like entities
  have done.
- The more precedent memory holds, and the more consistent it is, the more
  memory weighs against the profile's assumptions.
- A prediction draws only on what the agent itself perceived and still
  remembers.

### Predicting itself

- An agent may predict its own actions. This is lookahead: it weighs a
  path of its own decisions, not only the next one.
- By default an agent is fully aware of its own capabilities and fully
  confident in them.
- A path that passes through an outcome of chance outside the agent's
  control, such as a leap that calls for an Athletics check, carries less
  confidence, by a blind assessment of the probability.

### What an agent does not know

- **An agent's knowledge and its prediction model are separate.** A
  prediction never reads another agent's data. It is compiled from
  precedent in the agent's memory, and falls back on its profile where there is none.
- Where a path reaches something the agent cannot know (a roll, another
  agent's decision, a hidden value), the weight comes from the same two
  sources: a default in its profile, and what its memory has taught it.
- A profile's assumption is conditioned on what the agent is aware of, not
  on the other agent's state. A worg assumes a hostile creature that has
  not yet used its reaction will make an opportunity attack; it does not
  read the scout's attack bonus or its intent.
- Memory supports inference about what is hidden. A creature that has hit
  often against its Armor Class is taken to have a high attack
  bonus; a caster seen to cast Shield is taken to have it prepared, and to
  be likely to hold its reaction for it.
- Where there is no information at all, the profile says what that is
  worth: nothing, or a greater threat. A profile may be optimistic,
  pessimistic, or neutral under uncertainty.

### Bounds

- The parameters of awareness, memory, and prediction are bounded by core,
  for performance and to prevent failure; defined within those bounds by the
  ruleset; and set within the ruleset's definition per agent, from the state.
  In the 5e ruleset an agent's memory length may follow its Intelligence, its awareness of some types of event its Perception, and the
  weight it gives remembered actions of other creatures its Insight.

## What scoring is held to

`Planned (#19):`

- **The aim is a decision model that responds to its configuration**, not
  the one that wins most. A dull goblin plays like a dull goblin, a
  brilliant wizard like a brilliant wizard, a reckless barbarian like a
  reckless barbarian.
- The mechanics compile and run under a variety of configurations, in more
  rulesets than the 5e one (`INV-1`).
- Test fixtures show the pipeline works, as properties over the logs of many
  matches:
  - an outcome an agent holds less probable is chosen less often;
  - profiles configured differently play differently, in the way each
    profile's description says;
  - an agent more aware of what another may do predicts it more accurately.
- Two failures are looked for by name: information that consistently
  outweighs everything else in a decision, and information that is ignored.
- Core exposes measures of the pipeline for analysis, so a configuration
  can be refined against them.

## Decisions with large ranges

`Planned (#19):`

- **A decision is hierarchical.** An intent whose params have a very large
  range is not listed once per binding. In hold 'em the decision's list is
  `raise`, `call`, `fold`.
  Why: listing every binding of a wide param is inefficient at best and
  impossible at worst, and cutting the range to a few values changes the
  game.
- **A scalar param with a range is a parameter of the decision**, not an
  entry in its list. The amount of a raise is given by the seat that chooses
  `raise`.
- A scripted seat derives such a value from the deciding agent's profile,
  awareness, memory, and predictions.
- **The decision a person or an agent filling a seat is shown is specified
  with it**: what is listed, what is left for the seat to give, and how
  the choice is submitted.
  Why: a hierarchical decision changes what any seat is handed, so the
  surface is designed once, for scripted seats and the others together.
- **The legal values of such a param are worked out before the intent is
  offered.** An intent with no legal value is not offered, so a seat is
  never offered what it cannot choose, and a prompt still knows when
  nothing is legal.
- A value outside the legal ones is refused as an index that is not an
  option is: an error that records nothing.
- **Several of many are chosen one at a time**, as a sequence of single
  decisions: six spells of thirty are six decisions.

## Selection

`Planned (#19):`

- A behavior declares how it selects: the highest score, or a pick among the
  highest weighted by score, drawn from the seat's stream.
  Why: weighted selection gives varied play from one behavior and stays
  deterministic.

## Path distance

`Planned (#19):`

- Path distance between two cells is the least cost of a route between
  them, and the ruleset says what a route costs. Core finds the route; it
  holds no rule of its own about steps, terrain, or diagonals.
  Why: a grid is itself a rule of the ruleset. The 5e ruleset counts steps
  on a 5-foot grid and charges more for difficult terrain; another ruleset
  has other rules, and may have no grid.
- The rules and the behaviors work a path's cost out from the same
  declaration.

## Open questions

Not contract. Resolve one by editing this file, then delete it here.

- **Which measures does core expose, and what do the properties require as
  numbers?** How often is "less often", and over how many matches.
- **What does lookahead run?** Whether a seat's own intents are applied
  through the rules' effects on a copy of what it is aware of, or the path
  is weighed without running any rule; and where a path ends.
- **How are a profile's assumptions and memory's inferences written?** What
  an assumption is conditioned on, what it yields, and how a pattern of
  remembered events becomes a weight.
- **How far does lookahead reach**, in what unit, and how many paths may it
  weigh? Core has no notion of a turn; the flow is the ruleset's.
- **How is "like" decided** between a remembered entity and the one being
  predicted, and how are the amount and consistency of precedent measured?
- **How is a memory's age counted**, when core has no notion of a turn? A
  checkpoint in the flow ([`SPEC.md`](../../SPEC.md) "Open questions") is
  one unit a ruleset could give it.
- **Which statements of "Scoring" does version 1.1's foundation hold?** A
  candidate: awareness as above; memory as the last value an agent
  perceived of each thing and its age; prediction as the agent's own
  behavior scoring what it can see of another's options, weighted by how
  often it remembers that agent choosing each intent. Considerations and
  response curves, lookahead, and inference about hidden values would stay
  in the brief. And where the brief lives once the foundation is built.
- **How does a kind say it is an agent**, and name the seat that owns it?
  Whether a prompt names the deciding agent, with the seat following from
  it.
- **Is a whole entity hidden, or only its fields?** For an agent to be
  unaware that a hidden creature exists, the creature has to be absent
  from `all.<kind>` in that agent's view, where reading a hidden field is
  an error today.
- **Do only behaviors read memory**, or may a rule or a gate?
- **How is what an agent perceived written to the log?** A candidate: one
  entry when an agent becomes aware or unaware of something, so that who
  perceived any event is whoever was aware at that entry, and the log
  grows with changes in awareness, not with events times agents. Listing
  the perceiving agents on every entry is the alternative. Whether the
  entries sit in the log or in a file beside it, keyed by `seq`.
- **What is a profile**, and what does a derived one derive from?
- **What are core's bounds**, as numbers?
- **Is rule data that exists only for behaviors acceptable**, or does a
  behavior set get somewhere of its own to derive such values?
- **How are considerations combined?** A product, a sum, or declared per
  score; and whether a score with more considerations is compensated.
- **Which response curves exist**, and are they a closed set like the
  effects?
- **How does a ruleset declare what a route costs?** A candidate: a named
  path rule giving the cells one step reaches, the cost of the step, and a
  small state carried along the route, which a cost that depends on the
  route so far needs (a diagonal that alternates between 5 and 10 feet).
  Whether the function a rule calls gives one distance, or every cell
  within a budget with its cost; and what stands for `neighbors` in a
  ruleset with no grid.
- **How are a ranged param's legal values declared**, so that they are
  worked out without listing each: as bounds given by expressions, and
  whether a gate may still read the param.
- **How far does the hierarchy go?** Whether every param is chosen level by
  level after the intent.
- **How is a decision with a given value recorded, explained, and counted**
  (`of`) in the log?
- **Do the old score expressions remain** beside considerations, or is
  every shipped behavior set rewritten and the old form refused?

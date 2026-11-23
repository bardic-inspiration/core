# Decisions

How a seat's decision is asked for, chosen, and recorded, and how scripted
seats choose.

The syntax of prompts and behavior sets is in
[`format.md`](format.md) "Prompts and the flow" and "Behaviors"; the calls
an engine makes are in [`api.md`](api.md) "Driving a match".

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
- Explaining changes nothing in the match.

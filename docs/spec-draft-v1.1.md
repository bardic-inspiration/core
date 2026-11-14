# v1.1 specification draft

The working draft of what v1.1 adds to [`SPEC.md`](../SPEC.md), one section
per goal. It is **not contract**: nothing is built against it. When the
draft is complete it is folded into `SPEC.md` and this file is deleted.

## The decision system

How a seat's decision is asked for, chosen, and recorded, and how scripted
AI seats choose.

### Goal

Better scripted AI for the studio. The 5e slice, and tactical and tabletop
RPG play generally, is the primary case. Core stays genre-neutral
(`INV-1`): every mechanism added here is one any ruleset can use, and what
is specific to tactical play lives in a behavior set, never in the runtime.

### What exists

Described in full in [`format.md`](format.md) "Prompts and the flow" and
"Behaviors", and [`host.md`](host.md) "Driving a match". In outline:

| Stage | What happens |
|---|---|
| Ask | A `prompt` effect names a seat and the intents on offer. The runtime enumerates every binding of their params and keeps those whose gates all pass, through the seat's own view. The result is the decision: the seat and its options. |
| Choose | A seat driver is given the options, the seat's view of the state, a scorer, and the seat's own seeded stream, and returns one option. Two drivers exist: one picks at random; one takes the option a behavior scores highest and breaks ties at random. |
| Record | The choice is logged as an `intent` entry with how many options there were and where the seat's stream then stood, so a replay or a fork reproduces it. |

A behavior gives one score expression per intent, over that intent's
params, and goals that multiply named scores by a constant while a
condition holds. An intent it does not score counts as 0.

Asking and recording are sound. Choosing is where v1.1 works:

- A score sees one option and the current state, never what the option
  leads to. A turn in the 5e slice is many decisions (`move` is one square),
  so "walk four squares, then attack" cannot be weighed against "attack
  now".
- `distance` ignores what lies between two cells, so movement is scored by
  straight-line distance.
- A driver keeps nothing between decisions, so a seat cannot hold a target
  or a plan unless the ruleset stores it for it.
- Scores are single long expressions, repeated between behaviors and shared
  by YAML anchor.
- `Match.explain()` says why an option is legal, not why it was chosen.

### Direction

Each of these is decided in outline and still needs its precise rules.

- **The decision contract is written into `SPEC.md` as it stands**, before
  anything changes it: prompt, decision, option, seat, driver, behavior,
  goal, and the ask, choose, record rule.
- **A choice can be explained.** For a pending decision and a behavior:
  each option's score, the inputs that made it, and the goals that scaled
  it. Explaining changes nothing in the match.
- **A score is built from considerations.** A behavior set declares named,
  typed terms; a score combines them, each mapped through a response curve.
  Terms are shared by name between scores, goals, and behaviors.
  Why: a consideration is small enough to read, reuse, and inspect one at a
  time, where a nested expression is not.
- **A behavior declares how it selects**: the highest score, or a pick
  among the highest weighted by score, drawn from the seat's stream.
  Why: weighted selection gives varied play from one behavior and stays
  deterministic.
- **Path distance is a space function.** Only a ruleset that declares a
  space can call it.
- **A position is scored as a term over a param's value.** Core has no
  notion of scoring tiles; a cell is one type of param among others.
- **Done means a non-tactical ruleset uses it too.** The 5e behavior set
  and at least one of hold 'em and checkers are rewritten in the new form.
- **Core's own code.** No game AI library is taken as a dependency.
  Why: those surveyed take decision logic as code and keep their own agent
  state and randomness, against `INV-1`, `INV-3`, and `INV-5`.

### Open questions

- **How does a seat act coherently over a turn?** Three shapes, the first
  two to be explored in spikes against the 5e slice before either is
  specified:
  - *In the behavior:* it settles on a destination or a target and holds it
    across the turn's decisions. Needs seat memory that survives replay and
    fork (`INV-3`, `INV-4`).
  - *In the driver:* it plays its own turn forward on a copy of the match
    and scores where it ends. Needs no memory; has to answer what a seat
    may simulate when it cannot see hidden state or coming dice, and what a
    copy costs.
  - *In the ruleset:* it offers an intent that moves to a destination.
    Cheap, but changes rules to suit the AI, as hold 'em's `strength`
    already does.
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

### Out of scope for v1.1

- **Seats for people and agents.** The decision a seat is shown, a log
  filtered by seat, and driving a seat by tool calls are reconsidered
  together in v2.
- **Search over future states** (alpha-beta, Monte Carlo tree search) with
  heuristics declared as data. It suits closed games of perfect
  information, which are not v1.1's primary case.
- **Behavior trees and planners.** The flow and gates already decide what
  may be done and when; what remains is the turn-level question above.

# Matches

The rules that hold across areas: how documents are compiled, and how a
match is played, decided, hidden, refereed, logged, and laid on its ground.
A surface's own rules are in its file ([`README.md`](README.md)).

## Compiling

- Every document is checked against a schema, then resolved against what it
  refers to. A document with an unknown key, an unknown name, an ill-typed
  expression, or a `format` other than the one core reads is refused.
- A refusal is a `CompileError` listing every reason found, each with the
  path of what it refuses, not only the first (`INV-2`).
- An extension may change only what its base lists under `open`. Two
  declarations that disagree are a conflict, not a merge.
- An extension, a behavior set, a map, and a scenario each name the ruleset
  `id` and `version` they are written for. The ruleset satisfies a wanted
  version when its major number is the same and it is not older; below
  1.0.0, the minor number must be the same too. Anything else is refused.
- An expression is typed and cannot loop. It reads and writes nothing
  outside the registry's addresses.
- A map is refused when it fails any of its ruleset's criteria, whether it
  is a document or written inline in a scenario. A refused map is never
  handed to a host.
- A scenario's entities are instances of the ruleset's kinds, made as play
  makes them: every field is typed, and every kind check holds on the
  starting state.

## Playing

- A match starts from its seed and its scenario's setup, both written to the
  log, then runs the ruleset's `flow`.
- The flow runs until a prompt needs a decision ([Decisions](#decisions)),
  and goes on when the decision is taken.
- A match ends in one of three ways, each an `end` entry:
  - with the outcome of the first scenario end condition that holds. The
    conditions are checked in order, once after setup and then after every
    write a rule or a referee makes;
  - as `{ result: complete }` when the flow runs out;
  - as `{ result: limit }` when a decision is needed and the match has
    already taken the scenario's `limits.maxDecisions` (10,000 when it gives
    none).
- Nothing runs after a match has ended.
- A rule that cannot be carried out stops the match with a `RuleError`
  saying why. Among them: a `create` whose instance fails a kind check, a
  value of the wrong type, a write to a cell off the map or one that leaves
  the cell failing a check, a read of a value hidden from the deciding seat,
  a `roll` of fewer than zero dice or of a die with no sides, a `done`
  outside any prompt, and a flow that runs a million steps without reaching
  a decision.
- A kind's checks are enforced when an instance is created and after a
  referee's changes. A rule's `set` does not run them; `Match.violations()`
  reports every check that fails in the current state.
- Chance comes only from seeded streams: one for the rules' dice, keyed by
  the match seed, and one for each seat's driver, keyed by the seed and the
  seat. How a seat decides never moves the dice (`INV-3`).

## Decisions

Every decision in a match is asked, chosen, and recorded the same way,
whether the flow asks for a turn or an intent's effects ask for a reaction:
the runtime enumerates the deciding seat's options, a driver returns the
index of one, and the choice is one `intent` entry in the log. The contract,
and how scripted seats choose, is in [`decisions.md`](decisions.md).

## Hidden information

- A field or a global may declare who sees it. The rules see everything.
- A seat's options, and a behavior's scores for them, are worked out through
  that seat's view. Reading a hidden value there is an error, not a blank.
- A derived value is hidden from a seat whenever anything it reads is.
- A referee seat sees everything.
- The log is not filtered by seat, and the seats' streams are in every
  seat's view.

## Referees

- A scenario marks a seat as a referee. Only a referee may author changes
  or make rulings, and only while the match has not ended.
- An authored change is a create, a set, a destroy, a link, an unlink, or a
  write to a mutable cell layer. Each must be something the ruleset
  declares, typed as it declares it. The changes of one call are applied
  together or not at all.
- A ruling makes an intent happen for a seat, whatever is on offer. Its
  params are type-checked; its gates are not evaluated.
- A change or a ruling made while a decision is pending sets that decision
  aside; the prompt asks again afterwards.
- Every entry a referee authors carries `by`, the referee's seat.

## The log, replay, and forks

- Each write, roll, decision, and signal is one entry, numbered by `seq`
  from 0. An entry made under an intent or a signal carries that entry's
  `seq` as `cause`.
- A write that changes nothing in a cell layer makes no entry.
- `fold` of a log, or of any prefix of it, gives the state at that point,
  the seats' streams included (`INV-4`).
- `replay` puts a log's decisions, referee changes, and rulings back through
  the rules, each where the log has it. It fails at the first entry the
  rules would now write differently, and at a recorded decision that is no
  longer an option, naming the entry.
- `fork` returns the match as it stood when a given decision was about to be
  made. Choosing the same again plays out the same match. An entry that is
  not a decision cannot be forked at.
- A snapshot is taken while a decision is pending. A match restored from
  one plays on as the original would have. `replay` and `fork` may start
  from a snapshot of the same log.
- A record is worked out from a log alone, and only from the log of a match
  that has ended. It holds nothing that differs between two runs of the same
  seed.

## The ground

- A map document is never changed. A match holds its writes to mutable
  layers in its state; the ground is the map with those laid over it.
- Expressions and the host answer from the ground as it stands, so a write
  takes effect from the next expression on.
- A host is a pure function of one map. It is never told of a change: core
  builds a host from each ground a match passes through.
- `scenario.mapAt(state)` returns the same object for the same
  `state.ground`.
- Two matches on one map do not see each other's writes.

## Limits

What core does not do.

- Space is a two-dimensional square grid, or a plane with no grid.
  `space.vertical` is refused.
- A plane with no grid has a size and places. No rule can ask a spatial
  question of it, and no host is built for it.
- The two space rules read one cell's layers and nothing else.
- An intent chosen at a prompt returns no value to the effects that
  prompted it, and a signal returns none to what emitted it.
- A log does not hold its map; it holds what play changed on it.
- A write to one key of a map-typed global is logged as the whole map, and
  a write to one cell builds the ground and its host again.

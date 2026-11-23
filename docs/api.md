# The API

How an engine drives core: compile documents, run a match, read and explain
it, replay and fork it, and record it. Everything named here is exported from
[`src/index.ts`](../src/index.ts), and [Every export](#every-export) lists
all of it. What an engine implements for space is in [`host.md`](host.md).

Documents are passed in parsed, as plain data; core reads no file. Nothing
reachable from the entry touches Node, so all of this runs as it is in a
browser or a Web Worker ([Running in a browser](#running-in-a-browser)).

## Driving a match

```ts
const registry = compile({ kit, base, extensions });        // plain data in
const behaviors = compileBehaviors(registry, [defaults, variant]);
const scenario = loadScenario(registry, scenarioDoc, { maps });   // the map documents, by id
const match = new Match(registry, scenario, seed);

match.run(bindSeats(scenario, behaviors));                   // to the end, headless
```

Or one decision at a time: `advance()` runs to the next decision and returns
it (the seat and its legal options), and `submit(index)` takes it. A human
seat is driven the same way. `step(seats)` does both with a driver.

| Call | Gives |
|---|---|
| `match.run(seats)` | Plays to the end: `{ outcome, state, log }`. |
| `match.advance()`, `match.submit(index)`, `match.step(seats)` | The next decision (`null` once the match has ended), taking one, or both with a driver. |
| `match.log`, `match.state` | The log so far and the state it folds to. `fold(log.slice(0, n))` is the state at any earlier point. |
| `match.outcome` | The `end` entry's outcome, or `null` while the match runs. |
| `match.view(seat)` | The state as a seat may know it. |
| `match.violations()` | Every kind check that fails in the current state, as `id: message`. |
| `match.explain()` | Why the pending decision offers what it does (below). |
| `match.scores(behavior, seat, options)` | A behavior's utility for each option. |
| `match.request()` | What the deciding seat's driver is given ([Drivers](#drivers)). |
| `match.snapshot()`, `Match.restore(registry, scenario, snapshot)` | The match as plain data at a decision, and back. |
| `match.author(seat, changes)`, `match.adjudicate(seat, actor, intent, params)` | A referee seat's changes and rulings. A change is one of `Authored`: a create, set, destroy, link, unlink, or `{ ground: { at, layer, value } }`, a write to a mutable layer. |
| `scenario.mapAt(state)` | The map as it stands in a state, with what play has changed. |

`compile` takes `{ kit?, base, extensions? }`. `compile`, `compileBehaviors`,
`loadScenario`, `loadMap`, `compileExpression`, and `bindSeats` refuse with a
`CompileError` whose `issues` list every reason, each with its `path`. A rule
that cannot be carried out in play throws a `RuleError`
([`matches.md`](matches.md) "Playing").

### Explaining a decision

`match.explain()` returns, for the pending decision, every candidate binding
of every offered intent, legal or not:

- `intents[].domains`: each evaluation of a param's `in` list, with the
  params bound before it (`given`), its size, and the host calls it made.
- `intents[].candidates`: each binding, whether it is `legal`, its index
  among the decision's options when it is, and every gate in order: its
  source, `pass`, `fail`, or `error`, and the host calls it made.

A host call is `{ fn, args, result }` in plain values, such as
`{ fn: 'lineOfSight', args: [{ x: 2, y: 6 }, { x: 9, y: 6 }], result: false }`.
A gate that reads a derived value is shown the calls behind that value. Every
gate is evaluated, also past the first that fails; one that cannot be
evaluated then (it relied on an earlier gate holding) is an `error` with its
message. The legal candidates are exactly the decision's options, in order.
Explaining changes nothing in the match.

### Expressions of your own

```ts
const bloodied = compileExpression(registry, 'all.creature.filter(c, c.hp * 2 <= c.hpMax).size()');
bloodied.evaluate(match.state, scenario);                            // on any state
bloodied.evaluate(fold(log.slice(0, seq)), scenario);                // at any point of a log
const big = compileExpression(registry, 'amount >= target.hpMax / 2', { vars: { target: 'creature', amount: 'int' }, expect: 'bool' });
big.evaluate(state, scenario, { vars: { target: 'worg', amount: 14 } });   // e.g. a signal's args
```

The expression gets the checks a ruleset's own get, and is refused with a
`CompileError`. `vars` declares extra variables by type; a signal's arguments
are the usual case, and `registry.signals` has their types. With
`{ viewer: seat }` it is evaluated through that seat's view, where reading
what the seat cannot see is an error.

### Replay and forks

`replay(registry, scenario, log)` puts a log back through the rules: every
decision is chosen again, and every referee change and ruling is made again
where the log has it. The rules must answer entry for entry as the log says;
the first entry that differs is an error naming it. `{ until: seq }` stops
before the entry at `seq`.

`fork(registry, scenario, log, seq)` returns the match as it stood when the
decision at `seq` was about to be made. Call `advance()` and choose
differently, bind another behavior, or author a change, and it is a new
branch. Choosing the same again plays out the same match, because the seats'
streams stand where they stood. Both take `{ from: snapshot }` to start from
a snapshot of the same log instead of the beginning.

## Drivers

A driver is a `Seat`: `{ name?, choose(request) }`, where `choose` returns
the index of one option and `name` is what a match record calls it. Its
request is a `SeatRequest` ([`decisions.md`](decisions.md) "Choose"):

| Field | Holds |
|---|---|
| `seat`, `options` | The deciding seat and the decision's options. |
| `state` | The state through the seat's view. |
| `scores(behavior)` | A behavior's score for each option. |
| `pick(count)` | An integer in `[0, count)` from the seat's own stream. |

- `new RandomSeat()` picks uniformly.
- `new UtilitySeat(behavior)` takes the option `behavior` scores highest,
  and picks among ties. A behavior is `behaviors.byName.get(name)`.
- `bindSeats(scenario, behaviors, bind?)` gives a driver for every seat: the
  behavior name or `Seat` that `bind` gives it, else the behavior its
  scenario names, else a `RandomSeat`. An unknown seat or behavior is
  refused.

## Records

- `playMatch(registry, scenario, seed, seats)` plays a match to its end and
  returns `{ record, log, match }`.
- `summarize(registry, scenario, log, drivers?)` works a `MatchRecord` out
  from an ended match's log alone; `drivers` names what drove each seat.
- `hashLog(log)` is the record's `logHash`.

What a record holds is in [`data/README.md`](../data/README.md) "A record".

## State and randomness

- `fold(log)` is the state a log, or any prefix of one, gives (`INV-4`).
  `apply(state, entry)` is one step of it, from `emptyState()`.
- A `State` holds `entities` (each an `Entity`: `kind` and `fields`),
  `links`, `game` (the globals), `rng` (the rules' dice), `nextId`,
  `streams` (each seat's), `ground`, and `ended`. Every value in it is a
  `Value`: plain JSON data.
- A `GameEvent` is one log entry ([`format.md`](format.md) "The log").
- `hashSeed(key)`, `nextRandom(position)`, and `rollDice(position, n, d)` are
  the seeded streams core rolls with, for an engine that wants to check or
  reproduce a roll. A stream's position is one 32-bit integer.

## Hosts

`createGridHost(map)` is the reference host, used when `loadScenario` is given
no `host`. `compareHosts(host, reference, map, ranges?)` lists every answer
on which two hosts differ. `loadMap(registry, mapDoc)` gives a map document's
`SpaceMap` without a scenario. The contract is [`host.md`](host.md).

## Running in a browser

Core's entry imports nothing from Node, and reading files is left to
[`src/load.ts`](../src/load.ts), which is not part of it. A page parses the
YAML itself and passes plain data to a worker;
[`scripts/browser/worker.ts`](../scripts/browser/worker.ts) is a complete
example. `npm run check` bundles it for the browser and runs it in
headless Chromium, and `npm run browser` plays every scenario there and in
Node and prints the timings.

Two things to know when embedding:

- The schema checker (Ajv) builds its validators with `new Function`. A page
  with a strict content security policy must allow `unsafe-eval` for the
  worker, until the validators are precompiled.
- A match is not transferable while it runs, but `snapshot()` and the log are
  plain data and cross `postMessage` as they are.

## Every export

The whole of [`src/index.ts`](../src/index.ts). Its version is `version` in
`package.json` ([`AGENTS.md`](../AGENTS.md) "Versioning").

| Export | Kind | Is |
|---|---|---|
| `compile` | function | Kit, ruleset, and extensions to a `Registry`. |
| `compileBehaviors` | function | Behavior sets to `Behaviors`, against a registry. |
| `compileExpression` | function | One expression to an `Expression`, against a registry. |
| `loadScenario` | function | A scenario document to a `Scenario`, with `ScenarioOptions` (`host`, `maps`). |
| `loadMap` | function | A map document to a `SpaceMap`. |
| `Match` | class | A match: [Driving a match](#driving-a-match). |
| `replay`, `fork` | function | [Replay and forks](#replay-and-forks); `ReplayOptions`. |
| `RandomSeat`, `UtilitySeat`, `bindSeats` | class, function | [Drivers](#drivers). |
| `playMatch`, `summarize`, `hashLog` | function | [Records](#records). |
| `fold`, `apply`, `emptyState` | function | [State and randomness](#state-and-randomness). |
| `hashSeed`, `nextRandom`, `rollDice` | function | [State and randomness](#state-and-randomness). |
| `createGridHost`, `compareHosts` | function | [Hosts](#hosts). |
| `CompileError`, `RuleError` | class | A refusal with every reason (`issues`), and a rule that failed in play. |
| `FORMAT_VERSION` | constant | The `format:` this build reads: 2. |
| `Registry`, `AddressInfo`, `BehaviorSpec`, `CellLayerSpec` | type | A compiled ruleset; `registry.addresses` describes each fact it allows, `registry.cellLayers` each layer, and a `BehaviorSpec` is one compiled behavior. |
| `Behaviors` | type | Compiled behavior sets: `registry`, `sets`, and `byName`. |
| `Expression`, `ExpressionOptions`, `EvaluateOptions` | type | [Expressions of your own](#expressions-of-your-own). |
| `Scenario`, `ScenarioOptions` | type | A loaded scenario: its `map`, `mapAt(state)`, and `maxDecisions`. |
| `Decision`, `Option`, `Seat`, `SeatRequest`, `Snapshot`, `Authored` | type | A match's decisions, drivers, snapshots, and referee changes. |
| `Explanation`, `IntentExplanation`, `Candidate`, `GateResult`, `DomainTrace` | type | [Explaining a decision](#explaining-a-decision). |
| `State`, `Entity`, `GameEvent`, `Value` | type | [State and randomness](#state-and-randomness). |
| `MatchRecord`, `SeatRecord` | type | [Records](#records). |
| `SpaceHost`, `SpaceMap`, `HostCall`, `Point`, `Place`, `CellValues` | type | The host contract ([`host.md`](host.md)). |
| `RulesetDoc`, `ExtensionDoc`, `KitDoc`, `PatternDoc`, `BehaviorSetDoc`, `MapDoc`, `ScenarioDoc`, and the types they are built from | type | The documents, as [`format.md`](format.md) describes them ([`src/format.ts`](../src/format.ts)). |

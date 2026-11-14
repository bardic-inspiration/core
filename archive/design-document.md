# RPG Core  Design Document

Nov 11, 2026 · @Reif

## Purpose

The goal is to develop a "ludematic core:" a model that fully expresses roleplaying game (or other open-ended game) rulesets as pure data. Any ruleset, whether a TTRPG like Dungeons and Dragons or a component-based virtual sandbox of self-assembling bots, is written as data and played by one generic runtime.

This is the brief for a one-shot Fable 5.2 build of the core prototype. The aim is to prove that central idea and get as far as possible. It describes direction, not procedure: where it is silent, make a reasonable call and log it.  This is an exploratory project.

## System overview

Core and the library are independent projects, made compatible by a translator; the engine is core's consumer.

&#91;embedded content: the projects · what each holds and what flows between them\]

The library keeps its schema, stats, and prose, and keeps shipping on its own plan. The translator reads library entries and writes core data, so it is the only piece that knows both formats. The engine runs core's compiled registry with core's own runtime.

## Core concepts:

- A [**ludeme**](https://en.wikipedia.org/wiki/Ludeme) is an abstract fundamental unit of play in a game, such as the L-shaped movement of a knight in chess, as opposed to an "instrument of play" which forms part of the equipment with which a game is played, such as the knight piece itself.
- **Ludematics** is a made-up term expressing the idea of systems of ludemes, systematic game abstraction, and the engineering of a kit of fundamental primitives to compose game rulesets.

### Open and closed games - the Ludii example:

**[Ludii](https://ludii.games/)**, a research system that describes board games as structures of reusable concepts (ludemes), is the closest precedent and a useful contrast.&#32;

Board games are **closed**: every component is known at the start, moves can be listed in full, and every game ends in a win or loss, which makes them solvable.&#32;

RPGs are **open** on all three counts:&#32;

- state grows
- players can attempt anything
- there is no win condition.  they cannot be "solved."&#32;

This project treats the closed case as a special case of the open one: a game where nothing is authored during play and an end condition is declared. End conditions belong to scenarios, not rulesets.

## Questions:

1. If Ludii approached the idea of ludematics for board games, or "closed" games with fixed environments and set win conditions, how can we make something similar for "open" games, such as RPGs?
2. What is the most distilled, complete expression of ludemes in this relatively unbounded context?  What are the fundamental primitives?
3. How can a library be built into an elegant framework for "ludematic design"?

## Key ideas

These are the key ideas supporting the design; a rough sketch of my design intent. Build this as you see fit, and flex on the design if you can find a more elegant or interesting way to solve it.

- **Rules are data.** No ruleset carries code of its own. When the format can't express a rule, the format grows. Anything outside the game ruleset, such as a rendering engine or chat system in a video game, is excluded from this.
- **One generic machinery.** A scheduler and event queue drive everything. Actions are intents with gates and effects, and the engine has no game-specific functions. For example, an "attack" is just data: an action, a paired vector from an instance of one type to another, with expressions over ruleset-authored keys (strength, weapon damage, AC, HP) as its gate and effect.
- **Ruleset and state are separate.** The ruleset (primitives and rules) is fixed for a game while it is running. State grows during play, including content authored live, but anything authored must be an instance of something the ruleset declares.
- **Composition through relations.** Composed things stay separate entities joined by links: a sword in a hand, a part on a bot. Some relations are peer pairings, like attacker and target.
- **Seats.** Every actor has a seat that takes legal intents and returns one. A player, a deterministic AI, or an agentic system can fill it. A referee seat can also author, mapping unplanned actions onto the ruleset during play.
- **Space as rules.** Core declares what is spatially possible (grid shape, movement increment, vertical movement); the engine does the geometry, rendering, etc.
- **A two-level kit.** A standardized library of math and logic functions, and above it named game patterns most games share (resource pools, checks, per-turn budgets, slots, durations, stacking).
- **Fail closed and deterministic.** Invalid rules data is refused, not guessed at. Randomness is seeded and every change is logged, so any match can be replayed exactly.

## Architecture

Same note as above.  This is a sketch illustrating my design intent.

- **Layers.** Function library, kit patterns, a base ruleset, and extensions (homebrew, custom content) that may change only what the base marks as open. They compile into one resolved registry for play.
- **Registry and addresses.** Every fact has an address, a path of ruleset-authored keys such as creature → ability → strength. The ruleset's own declarations define what may exist.
- **Expressions and gates.** Expressions compute values from addresses; gates are expressions that must hold. Derived values and consistency checks are both expressed this way.
- **Intents, effects, events.** The ruleset declares intents. Enumerating the intents whose gates pass gives every seat the same choices. Effects are a small closed set of writes; every applied effect goes into an event log, and state is the log replayed.
- **Scheduler.** Declared by the ruleset: rounds and initiative for 5.5e, ticks for a real-time sandbox.
- **Spatial queries.** Expressions reach spatial facts (distance, line of sight) through named host functions that core specifies and the engine implements.
- **Behavior.** A starting point is utility scoring: weighted expressions rank each legal intent, with longer-term goals shifting the weights.
- **Versioning.** The format and each ruleset are versioned separately. Rulesets live in core for now.

## Technology

TypeScript throughout; the engine will be Three.js and import core's runtime. Use existing open libraries for commodity parts and build only what is new.

Why? It's a web-based project. This format is easy to

- **Adopt:** CEL (Common Expression Language, e.g. @marcbachmann/cel-js) for expressions, since it is typed, non-Turing complete, and takes custom functions; Ajv and JSON Schema; a YAML parser; a seeded RNG; Immer for change diffs.
- **Build:** the ruleset format, the compiler, address resolution across relations, the runtime loop, the kit patterns, and conformance tests.

## Prototype

The target: a seeded headless match runs to completion from pure data, and replaying its event log reproduces it exactly. Prove it with two rulesets that share no code: one non-RPG game, such as checkers, and one 5.5e combat slice, such as a worg against a scout.

Signs of success:

- Invalid rules data is refused at compile time.
- Both rulesets run to an end state with every seat filled by an AI.
- The same seed gives the same log, and replay gives the same final state.

## Working approach

This is an exploratory, one-shot run, so keep process light. I'm leaning on your ingenuity to take this original idea and make it sing.

- **Decide and keep going.** Where this brief is silent or wrong, make the call and log it in an append-only decisions file.
- **Tests are the check.** One command runs everything; the signs of success above should be provable by it.
- **Order is yours.** Build in whatever sequence works.
- **Leave a handoff note:** what works, what is stubbed, where the build departed from this brief, and what comes next.

The library's structured, spec-driven process will be brought in after this run, starting from the decisions log and the handoff note.

## Starting material

Reference these; adapt freely rather than match them.

- **dnd-hirelings:** its tag grammar and registry (the shape of the self-defining registry), expression engine (semantics and test cases), seeded RNG, event log, rollback, and task engine (prior art for goals).
- **ttrpg-library:** the 5.5e SRD data and schemas, the derived values and checks in `rulesets/dnd-5e-2024/` that the format must be able to express as data, and its principles in `docs/decisions.md`.
- **Prior art:** [Ludii](https://ludii.games/) for the structure of a pattern kit; [boardgame.io](https://boardgame.io) for turn order, logs, and bots.

## Later (for reference, out of scope)

- **Content ****Library:** stays independent and unchanged by core.  For reference only.
- **Translator:** its own project. It turns library entries into core data, with LLM help for prose effects, and reports drift.
- **Game ****Engine:** geometry, decision layer, renderer, playtest front end, headless play.
- **Full ****Rulesets:** the full 5.5e SRD, the robot junkyard idea, etc.

## Open questions

Decide these during the build where they come up, and log the answer.

- **Hidden information:** does each seat see all state, or a filtered view (fog of war, secret rolls)?
- **Choices during resolution:** how does an effect ask a seat to decide mid-resolution, such as a reaction?
- **Spatial queries:** which host functions does the prototype need, and what does each return?
- **Rounding:** 5e rounds down (a 9 gives −1); confirm the expression layer does too.  This is just one example of a possible edge case; rules like this need to be able to exist.
- **Test rulesets:** are checkers and worg vs. scout the right pair?

# Docs

The index of `docs/`. These docs describe what is built on `main`. Design not
yet built is in [`SPEC.md`](../SPEC.md); what each release changed is in
[`CHANGELOG.md`](../CHANGELOG.md); how to work is in
[`AGENTS.md`](../AGENTS.md).

## Reference

What core is and does.

| File | Covers | Read it when |
|---|---|---|
| [`architecture.md`](architecture.md) | Purpose and non-goals, the invariants, the shared terms, the components, the versioned surfaces, and the quality bars | Starting out, or weighing whether a change belongs in core |
| [`matches.md`](matches.md) | Compiling, playing, hidden information, referees, the log, replay, forks, the ground, and what core does not do | Changing how a match runs, or asking why it ran as it did |
| [`format.md`](format.md) | How a ruleset, extension, behavior set, map, and scenario are written, and the log's entries | Writing or changing any document, the compiler, or the log |
| [`decisions.md`](decisions.md) | How a decision is asked for, chosen, and recorded, and how behaviors score | Changing prompts, drivers, or behaviors |
| [`api.md`](api.md) | Everything `src/index.ts` exports, and how an engine drives a match with it | Embedding core, or changing an export |
| [`host.md`](host.md) | The space host contract: what an engine implements for a map's geometry | Writing a host, or changing the contract |
| [`data/README.md`](../data/README.md) | The recorded matches, and what a record holds | Regenerating matches, or reading a record |

## Process

How work is done: [`AGENTS.md`](../AGENTS.md) "Protocol docs" routes to
[`spec-driven-development.md`](spec-driven-development.md),
[`workflow.md`](workflow.md), [`testing.md`](testing.md), [`ci.md`](ci.md),
and [`documentation.md`](documentation.md).

# Changelog

Notable changes to core, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers
follow [Semantic Versioning](https://semver.org/) as
[Releases](docs/workflow.md#releases) reads it.

## [1.0.0] - 2026-11-22

The first release: an internal pre-release.

### Added

- The ruleset format, format 2: kinds, relations, globals, enums, tables,
  intents, menus, signals, reactions, procedures, and the flow, written in
  YAML with typed CEL expressions, and checked against a JSON Schema
  (#1, #4).
- A compiler that expands patterns from the kit, layers extensions over what
  a ruleset leaves `open`, type-checks every expression, and refuses invalid
  documents with every reason listed (#1).
- One runtime that plays any compiled ruleset, logging every write, roll,
  decision, and signal, with each entry's cause (#1, #4).
- Folding, replay, forks, and snapshots of a match, with each seat's random
  stream kept in the state, so a match restored or forked plays on exactly
  as the original would have (#1, #4).
- Hidden information: fields and globals visible only to some seats, with a
  seat's options and scores worked out through its view (#2).
- Referee seats that author changes and make rulings during play (#4).
- Behavior sets as documents of their own, compiled against a ruleset and
  bound to seats by the scenario or the run, with random and utility
  drivers (#4).
- `Match.explain`, giving every candidate at a decision with each gate's
  result and the host calls it made, and `compileExpression` for
  expressions of an engine's own (#4).
- Space: maps as documents checked against the ruleset's space, cell
  layers that play may write, places, planes with no grid, the space host
  contract with a reference grid host, and `compareHosts` to check an
  engine's host against it (#4, #5).
- Core runs unchanged in a browser or a Web Worker, and writes the same
  logs there as in Node (#4).
- Four example rulesets: checkers, no-limit Texas Hold 'Em, a D&D 5e
  (SRD 5.2) combat slice with an extension, and junkyard, an open game of
  machines built from parts (#1, #2, #15).
- Recorded matches for seeds 1 to 40 of every scenario, and `npm run check`,
  the gate that compiles, loads, and plays everything against them (#2, #7).
- Documentation of the format, the API, the space host, and how a match
  runs (#25).

[1.0.0]: https://github.com/bardic-inspiration/core/releases/tag/v1.0.0

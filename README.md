# core

A ludematic core: a format that expresses a game's ruleset as pure data, and
one generic runtime that plays any ruleset written in it. Example rulesets
include checkers, Texas Hold 'Em, and a D&D 5e combat slice.

**Status:** working prototype in early development. Expect breaking changes.

## Install and run

Requires Node 22.6 or later. TypeScript runs directly; there is no build step.

```bash
git clone https://github.com/bardic-inspiration/core
cd core
npm install
```

Play a match and print its event log (ruleset, scenario, seed):

```bash
npm run play -- dnd-5e-2024-slice mage-duel 3
```

Run the full check (typecheck, every ruleset compiled and played, tests):

```bash
npm run check
```

One test needs Chromium; install it once with `npx playwright install chromium`.

## Documentation

- [`docs/format.md`](docs/format.md) — the ruleset, behavior, map, and
  scenario format, and the event log.
- [`docs/host.md`](docs/host.md) — what an engine implements to drive a match.
- [`SPEC.md`](SPEC.md) — what core does.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup and how to contribute.
- [`AGENTS.md`](AGENTS.md) — the full working guide, for humans and AI agents.

## License

[MIT](LICENSE). The 5e slice includes material from the System Reference
Document 5.2 by Wizards of the Coast LLC, licensed under
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/).

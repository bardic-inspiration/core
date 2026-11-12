# Recorded matches

[`matches.jsonl`](matches.jsonl) holds one record per match: every scenario
under `rulesets/`, played by its AI seats over seeds 1 to 40. It is written
by `npm run sim`.

```bash
npm run sim
```

```bash
npm run sim -- --seeds 200 --only holdem/four-handed --logs
```

`--only` plays one scenario and prints its summary without touching the file.
`--logs` also writes each match's full event log to `data/logs/`, which is
not committed.

A record holds nothing that changes between runs of the same seed: no clock
and no machine. So the file is also a regression check. If a rule, a
behavior, or the runtime changes how a match plays, that match's `logHash`
changes, and `npm run validate` fails until the file is regenerated and the
difference is committed with the change that caused it.

## A record

| Field | Holds |
|---|---|
| `ruleset`, `version`, `scenario`, `seed` | What was played. |
| `outcome` | What the scenario's end condition reported. |
| `decisions` | How many times a seat chose. |
| `forced` | Decisions with only one legal intent. |
| `options` | Legal intents on offer per decision: `mean` and `max`. |
| `events` | Entries in the event log. |
| `byType` | Log entries by type (`set`, `roll`, `intent`, ...). |
| `signals` | Signals emitted, by name. |
| `entities` | How many existed at the `start` and the `end`, and how many were `created` and `destroyed` in play. |
| `seats` | For each seat: its `driver` (a behavior, or `random`), its `decisions`, and how often it chose each intent. |
| `logHash` | A hash of the whole event log. |

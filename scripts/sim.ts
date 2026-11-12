// Plays every shipped scenario over a range of seeds and writes one record
// per match to data/matches.jsonl, for later analysis.
//   npm run sim -- [--seeds 40] [--only <ruleset>/<scenario>] [--logs]
// `--only` plays a subset and prints its summary without touching the file.
// `--logs` also writes each full event log to data/logs/ (not committed).

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CompileError } from '../src/index.ts';
import { measure, shipped, type MatchRecord } from './measure.ts';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
};
const seeds = Number(option('seeds') ?? 40);
const only = option('only');
const data = fileURLToPath(new URL('../data/', import.meta.url));

/** The outcome fields that say who or what won, as one label. */
const label = (record: MatchRecord): string =>
  ['result', 'winner'].flatMap((key) => (key in record.outcome ? [String(record.outcome[key])] : [])).join(': ');
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

try {
  const records: MatchRecord[] = [];
  const rows: Record<string, string | number>[] = [];
  for (const { ruleset, scenario, registry, loaded } of shipped()) {
    const name = `${ruleset}/${scenario}`;
    if (only && only !== name) continue;
    const played: MatchRecord[] = [];
    let ms = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const result = measure(registry, loaded, seed);
      played.push(result.record);
      ms += result.ms;
      if (args.includes('--logs')) {
        mkdirSync(`${data}logs`, { recursive: true });
        writeFileSync(`${data}logs/${ruleset}.${scenario}.${seed}.jsonl`, result.log.map((event) => JSON.stringify(event)).join('\n') + '\n');
      }
    }
    records.push(...played);
    const outcomes: Record<string, number> = {};
    for (const record of played) outcomes[label(record)] = (outcomes[label(record)] ?? 0) + 1;
    rows.push({
      scenario: name,
      matches: played.length,
      outcomes: Object.entries(outcomes).sort(([, a], [, b]) => b - a).map(([key, n]) => `${key} ${n}`).join(', '),
      decisions: Math.round(mean(played.map((record) => record.decisions))),
      options: Math.round(mean(played.map((record) => record.options.mean)) * 10) / 10,
      'max options': Math.max(...played.map((record) => record.options.max)),
      events: Math.round(mean(played.map((record) => record.events))),
      'ms/match': Math.round(ms / played.length),
    });
  }
  console.table(rows);
  if (only) console.log('A subset was played, so data/matches.jsonl was left as it is.');
  else {
    writeFileSync(`${data}matches.jsonl`, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
    console.log(`Wrote ${records.length} records to data/matches.jsonl.`);
  }
} catch (error) {
  if (!(error instanceof CompileError)) throw error;
  console.error(error.message);
  process.exit(1);
}

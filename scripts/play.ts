// Plays a scenario headless with AI seats and prints the log.
//   npm run play -- <ruleset> <scenario> [seed] [--quiet]

import { Match, bindSeats, CompileError, type GameEvent } from '../src/index.ts';
import { loadBehaviors, loadRuleset, loadScenarioFile } from '../src/load.ts';

const [ruleset = 'checkers', scenarioName = 'standard', seed = '1', ...flags] = process.argv.slice(2);
const quiet = flags.includes('--quiet');

const show = (event: GameEvent): string => {
  const { seq, t, ...rest } = event as GameEvent & Record<string, unknown>;
  return `${String(seq).padStart(5)}  ${t.padEnd(8)} ${JSON.stringify(rest)}`;
};

try {
  const registry = loadRuleset(ruleset);
  const scenario = loadScenarioFile(registry, ruleset, scenarioName);
  const match = new Match(registry, scenario, seed);
  const seats = bindSeats(scenario, loadBehaviors(registry, ruleset));
  const started = Date.now();
  const { outcome, log } = match.run(seats);
  if (!quiet) for (const event of log) console.log(show(event));
  console.log(`\n${registry.id}@${registry.version} / ${scenarioName}, seed ${seed}`);
  console.log(`${log.length} events, ${log.filter((event) => event.t === 'intent').length} decisions, ${Date.now() - started} ms`);
  console.log(`outcome: ${JSON.stringify(outcome)}`);
} catch (error) {
  if (!(error instanceof CompileError)) throw error;
  console.error(error.message);
  process.exit(1);
}

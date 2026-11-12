// Finds every shipped scenario and plays it with its AI seats, timed. The
// record itself is core's (`src/record.ts`).

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bindSeats, fold, playMatch, type Behaviors, type GameEvent, type MatchRecord, type Registry, type Scenario } from '../src/index.ts';
import { loadBehaviors, loadRuleset, loadScenarioFile } from '../src/load.ts';

export type { MatchRecord };

export function measure(
  registry: Registry, scenario: Scenario, behaviors: Behaviors, seed: number,
): { record: MatchRecord; log: GameEvent[]; ms: number } {
  const started = performance.now();
  const { record, log, match } = playMatch(registry, scenario, seed, bindSeats(scenario, behaviors));
  const ms = performance.now() - started;
  if (JSON.stringify(fold(log)) !== JSON.stringify(match.state)) throw new Error('folding the log did not give the final state');
  return { record, log, ms };
}

export interface Shipped {
  ruleset: string;
  scenario: string;
  registry: Registry;
  /** The ruleset's default behavior set, loaded apart from it. */
  behaviors: Behaviors;
  loaded: Scenario;
}

const names = (dir: string): string[] => {
  try {
    return readdirSync(fileURLToPath(new URL(`../rulesets/${dir}`, import.meta.url))).sort().map((file) => file.replace(/\.yaml$/, ''));
  } catch {
    return [];
  }
};

/** Every scenario under `rulesets/`, compiled and loaded. Throws a CompileError if any is refused. */
export function shipped(): Shipped[] {
  const out: Shipped[] = [];
  for (const ruleset of names('')) {
    const registry = loadRuleset(ruleset);
    const behaviors = loadBehaviors(registry, ruleset);
    for (const scenario of names(`${ruleset}/scenarios`)) {
      out.push({ ruleset, scenario, registry, behaviors, loaded: loadScenarioFile(registry, ruleset, scenario) });
    }
  }
  return out;
}

/** The extension files of a ruleset, by name. */
export const extensionsOf = (ruleset: string): string[] => names(`${ruleset}/extensions`);

/** The behavior sets of a ruleset, by name. */
export const behaviorSetsOf = (ruleset: string): string[] => names(`${ruleset}/behaviors`);

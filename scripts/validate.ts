// The check a pull request must pass, apart from the tests:
//   1. every ruleset under rulesets/ compiles, alone and with each of its extensions,
//      and every behavior set compiles against the ruleset it is written for;
//   2. every map and every scenario loads against its ruleset;
//   3. every scenario plays to an end the scenario or the flow declares, and folding its log gives its final state;
//   4. data/matches.jsonl still matches how the rules play.
//   npm run validate

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CompileError, loadMap } from '../src/index.ts';
import type { BehaviorSetDoc } from '../src/index.ts';
import { loadBehaviors, loadRuleset, readMaps, readYaml } from '../src/load.ts';
import { behaviorSetsOf, extensionsOf, measure, shipped, type MatchRecord } from './measure.ts';

/** How many seeds of each scenario are replayed against the recorded data. */
const SEEDS = 3;

const failures: string[] = [];
const ok = (line: string) => console.log(`  ok    ${line}`);
const fail = (line: string) => {
  console.log(`  FAIL  ${line}`);
  failures.push(line);
};

const file = fileURLToPath(new URL('../data/matches.jsonl', import.meta.url));
const recorded = new Map<string, MatchRecord>();
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const record = JSON.parse(line) as MatchRecord;
    recorded.set(`${record.ruleset}/${record.scenario}/${record.seed}`, record);
  }
}

try {
  const scenarios = shipped();
  console.log('Rulesets');
  for (const ruleset of new Set(scenarios.map((entry) => entry.ruleset))) {
    const { registry } = scenarios.find((entry) => entry.ruleset === ruleset)!;
    ok(`${registry.id}@${registry.version}: ${registry.kinds.size} kinds, ${registry.intents.size} intents, ${registry.addresses.size} addresses`);
    for (const extension of extensionsOf(ruleset)) {
      try {
        loadRuleset(ruleset, [extension]);
        ok(`${registry.id} + ${extension}`);
      } catch (error) {
        if (!(error instanceof CompileError)) throw error;
        fail(`${registry.id} + ${extension}: ${error.message}`);
      }
    }
    // A behavior set is compiled over the default set, against the ruleset with the extensions it names.
    for (const set of behaviorSetsOf(ruleset)) {
      try {
        const needs = (readYaml(`rulesets/${ruleset}/behaviors/${set}.yaml`) as BehaviorSetDoc).extensions ?? [];
        const compiled = loadBehaviors(loadRuleset(ruleset, needs), ruleset, set === 'default' ? ['default'] : ['default', set]);
        ok(`${registry.id} behaviors/${set}${needs.length > 0 ? ` (with ${needs.join(', ')})` : ''}: ${compiled.byName.size} behaviors`);
      } catch (error) {
        if (!(error instanceof CompileError)) throw error;
        fail(`${registry.id} behaviors/${set}: ${error.message}`);
      }
    }
  }

  console.log('Maps');
  for (const ruleset of new Set(scenarios.map((entry) => entry.ruleset))) {
    const { registry } = scenarios.find((entry) => entry.ruleset === ruleset)!;
    const maps = readMaps(ruleset);
    const standard = registry.space.map?.standard;
    if (standard !== undefined && !(standard in maps)) fail(`${registry.id}: its standard map, "${standard}", is not under maps/`);
    for (const [id, doc] of Object.entries(maps)) {
      try {
        const map = loadMap(registry, doc);
        const holds = map.grid === 'none' ? `no grid, ${Object.keys(map.places).length} places` : `${map.cells.length} cells given`;
        ok(`${registry.id} maps/${id}${id === standard ? ' (standard)' : ''}: ${map.width} by ${map.height}, ${holds}`);
      } catch (error) {
        if (!(error instanceof CompileError)) throw error;
        fail(`${registry.id} maps/${id}: ${error.message}`);
      }
    }
  }

  console.log('Scenarios');
  let stale = false;
  for (const { ruleset, scenario, registry, behaviors, loaded } of scenarios) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const name = `${ruleset}/${scenario} seed ${seed}`;
      try {
        const { record } = measure(registry, loaded, behaviors, seed);
        const was = recorded.get(`${registry.id}/${record.scenario}/${seed}`);
        if (record.outcome.result === 'limit') fail(`${name}: hit the decision limit without ending`);
        else if (!was) {
          stale = true;
          fail(`${name}: no record in data/matches.jsonl`);
        } else if (was.logHash !== record.logHash || was.version !== record.version) {
          stale = true;
          fail(`${name}: plays differently from its record in data/matches.jsonl`);
        } else ok(`${name}: ${JSON.stringify(record.outcome)}`);
      } catch (error) {
        fail(`${name}: ${(error as Error).message}`);
      }
    }
  }
  if (stale) console.log('\nThe recorded matches are out of date. If the change in play is intended, run `npm run sim` and commit data/matches.jsonl.');
} catch (error) {
  if (!(error instanceof CompileError)) throw error;
  fail(error.message);
}

console.log(failures.length === 0 ? '\nValid.' : `\n${failures.length} failed.`);
process.exit(failures.length === 0 ? 0 : 1);

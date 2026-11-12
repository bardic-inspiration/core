// One unit of batch work, as a browser worker does it: compile a ruleset and
// its behaviors from plain data, load a scenario, and play it over some
// seeds. Nothing here or beneath it touches Node, so the same function runs
// in Node, in a bare JavaScript realm, and in a Web Worker.

import { bindSeats, compile, compileBehaviors, loadScenario, playMatch } from '../../src/index.ts';

export interface Job {
  kit: unknown;
  ruleset: unknown;
  behaviors: unknown[];
  scenario: unknown;
  /** The ruleset's map documents, by id. */
  maps?: Record<string, unknown>;
  seeds: number[];
}

export interface JobResult {
  /** Compiling the ruleset and behaviors and loading the scenario. */
  compileMs: number;
  matches: { seed: number; ms: number; events: number; logHash: string }[];
}

export function runJob(job: Job): JobResult {
  const started = performance.now();
  const registry = compile({ kit: job.kit, base: job.ruleset });
  const behaviors = compileBehaviors(registry, job.behaviors);
  const scenario = loadScenario(registry, job.scenario, { maps: job.maps });
  const compileMs = performance.now() - started;
  const matches = job.seeds.map((seed) => {
    const before = performance.now();
    const { record } = playMatch(registry, scenario, seed, bindSeats(scenario, behaviors));
    return { seed, ms: performance.now() - before, events: record.events, logHash: record.logHash };
  });
  return { compileMs, matches };
}

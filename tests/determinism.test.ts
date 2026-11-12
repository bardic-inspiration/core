// Signs of success 2 and 3: every ruleset runs to an end state with every seat
// filled by an AI; the same seed gives the same log; replay gives the same
// final state. The rulesets share no code: each is a YAML file.

import { describe, expect, it } from 'vitest';
import { fold, fork, Match, replay } from '../src/index.ts';
import { loadRuleset, loadScenarioFile } from '../src/load.ts';
import { aiSeats, behaviorsFor, play } from './helpers.ts';

const games = [
  { name: 'checkers', ruleset: 'checkers', scenario: 'standard', results: ['win', 'draw'] },
  { name: 'worg against scout (5e)', ruleset: 'dnd-5e-2024-slice', scenario: 'worg-vs-scout', results: ['win'] },
  { name: 'pack ambush (5e, seven seats)', ruleset: 'dnd-5e-2024-slice', scenario: 'pack-ambush', results: ['win', 'draw'] },
  { name: 'mage duel (5e, reactions)', ruleset: 'dnd-5e-2024-slice', scenario: 'mage-duel', results: ['win', 'draw'] },
  { name: 'hold \'em (hidden cards)', ruleset: 'holdem', scenario: 'four-handed', results: ['win', 'time'] },
  { name: 'junkyard (ticks, no winner)', ruleset: 'junkyard', scenario: 'yard', results: ['census'] },
];
const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

describe.each(games)('$name', ({ ruleset, scenario: scenarioName, results }) => {
  const registry = loadRuleset(ruleset);
  const scenario = loadScenarioFile(registry, ruleset, scenarioName);
  const behaviors = behaviorsFor(registry);

  it.each(seeds)('seed %i runs to an end state the scenario declares', (seed) => {
    const { match, outcome, log } = play(registry, scenario, seed);
    expect(results).toContain(outcome.result);
    expect(log[log.length - 1].t).toBe('end');
    expect(match.advance()).toBeNull();
    expect(match.violations()).toEqual([]);
  });

  it('gives the same log for the same seed', () => {
    for (const seed of seeds.slice(0, 3)) {
      expect(play(registry, scenario, seed).log).toEqual(play(registry, scenario, seed).log);
    }
  });

  it('gives different matches for different seeds', () => {
    const logs = new Set(seeds.map((seed) => JSON.stringify(play(registry, scenario, seed).log.slice(1))));
    expect(logs.size).toBeGreaterThan(1);
  });

  it('rebuilds the final state from the log alone', () => {
    for (const seed of seeds.slice(0, 3)) {
      const { state, log } = play(registry, scenario, seed);
      expect(fold(log)).toEqual(state);
      // The log is plain data: it survives a trip through JSON.
      expect(fold(JSON.parse(JSON.stringify(log)))).toEqual(state);
    }
  });

  it('reproduces the match exactly when its recorded decisions are replayed through the rules', () => {
    const original = play(registry, scenario, 5);
    const replayed = replay(registry, scenario, original.log);
    expect(replayed.log).toEqual(original.log);
    expect(replayed.state).toEqual(original.state);
  });

  it('refuses to replay a decision the rules no longer allow', () => {
    const { log } = play(registry, scenario, 5);
    const tampered = log.map((event) => (event.t === 'intent' ? { ...event, intent: 'cheat' } : event));
    expect(() => replay(registry, scenario, tampered)).toThrow(/is not legal here/);
  });

  it('refuses a log the rules would no longer write', () => {
    const { log } = play(registry, scenario, 5);
    const at = log.findIndex((event) => event.t === 'intent') + 1;
    const tampered = log.map((event) => (event.seq === at ? { ...event, cause: 0 } : event));
    expect(() => replay(registry, scenario, tampered)).toThrow(new RegExp(`parts from the log at entry ${at}`));
  });

  it('can be saved at any decision and resumed to the same end', () => {
    const reference = play(registry, scenario, 4);
    const decisions = reference.log.filter((event) => event.t === 'intent').length;
    for (const stopAt of [0, 1, Math.floor(decisions / 2), decisions - 1]) {
      const first = new Match(registry, scenario, 4);
      const seats = aiSeats(scenario, behaviors);
      for (let taken = 0; taken < stopAt; taken++) first.step(seats);
      first.advance();
      // The snapshot is plain data, and holds every seat's random stream: fresh drivers pick up where the old ones stopped.
      const saved = JSON.parse(JSON.stringify(first.snapshot()));
      const resumed = Match.restore(registry, scenario, saved);
      resumed.run(aiSeats(scenario, behaviors));
      expect(resumed.log).toEqual(reference.log);
      expect(resumed.state).toEqual(reference.state);
    }
  });

  it('forks at any decision, and plays out the same match when the same choice is made', () => {
    const reference = play(registry, scenario, 4);
    const decisions = reference.log.filter((event) => event.t === 'intent');
    for (const at of [0, Math.floor(decisions.length / 2), decisions.length - 1]) {
      const forked = fork(registry, scenario, reference.log, decisions[at].seq);
      expect(forked.log).toEqual(reference.log.slice(0, decisions[at].seq));
      expect(forked.state).toEqual(fold(forked.log));
      forked.run(aiSeats(scenario, behaviors));
      expect(forked.log).toEqual(reference.log);
    }
  });

  it('links every entry to the intent or signal it ran under', () => {
    const { log } = play(registry, scenario, 2);
    const setup = scenario.setup.length + 1;
    for (const event of log) {
      if (event.seq < setup) expect(event.cause).toBeUndefined();
      if (event.cause === undefined) continue;
      expect(event.cause).toBeLessThan(event.seq);
      expect(['intent', 'signal']).toContain(log[event.cause].t);
    }
    // What a decision does is logged under it.
    const decision = log.find((event) => event.t === 'intent')!;
    expect(log.some((event) => event.cause === decision.seq)).toBe(true);
  });
});

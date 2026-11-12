// Signs of success 2 and 3: both rulesets run to an end state with every seat
// filled by an AI; the same seed gives the same log; replay gives the same
// final state. The two rulesets share no code: each is a YAML file.

import { describe, expect, it } from 'vitest';
import { fold, Match, ReplaySeat, type Seat } from '../src/index.ts';
import { loadRuleset, loadScenarioFile } from '../src/load.ts';
import { aiSeats, play } from './helpers.ts';

const games = [
  { name: 'checkers', ruleset: 'checkers', scenario: 'standard', results: ['win', 'draw'] },
  { name: 'worg against scout (5e)', ruleset: 'dnd-5e-2024-slice', scenario: 'worg-vs-scout', results: ['win'] },
];
const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

describe.each(games)('$name', ({ ruleset, scenario: scenarioName, results }) => {
  const registry = loadRuleset(ruleset);
  const scenario = loadScenarioFile(registry, ruleset, scenarioName);

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
    const replay = new ReplaySeat(original.log);
    const seats = Object.fromEntries(Object.keys(scenario.doc.seats).map((id) => [id, replay]));
    const replayed = new Match(registry, scenario, 5).run(seats);
    expect(replayed.log).toEqual(original.log);
    expect(replayed.state).toEqual(original.state);
  });

  it('refuses to replay a decision the rules no longer allow', () => {
    const { log } = play(registry, scenario, 5);
    const tampered = log.map((event) => (event.t === 'intent' ? { ...event, intent: 'cheat' } : event));
    const replay = new ReplaySeat(tampered);
    const seats = Object.fromEntries(Object.keys(scenario.doc.seats).map((id) => [id, replay]));
    expect(() => new Match(registry, scenario, 5).run(seats)).toThrow(/is not legal here/);
  });

  it('can be saved at any decision and resumed to the same end', () => {
    const reference = play(registry, scenario, 4);
    const decisions = reference.log.filter((event) => event.t === 'intent').length;
    for (const stopAt of [0, 1, Math.floor(decisions / 2), decisions - 1]) {
      const seats = aiSeats(scenario, 4);
      const drive = (match: Match, seat: Record<string, Seat>, limit: number) => {
        let taken = 0;
        for (let decision = match.advance(); decision && taken < limit; decision = match.advance(), taken++) {
          match.submit(seat[decision.seat].choose({
            seat: decision.seat, options: decision.options, state: match.state,
            scores: (behavior) => match.scores(behavior, decision.seat, decision.options),
          }));
        }
      };
      const first = new Match(registry, scenario, 4);
      drive(first, seats, stopAt);
      first.advance();
      const saved = JSON.parse(JSON.stringify(first.snapshot()));
      const resumed = Match.restore(registry, scenario, saved);
      drive(resumed, seats, Infinity);
      expect(resumed.log).toEqual(reference.log);
      expect(resumed.state).toEqual(reference.state);
    }
  });
});

// The small fixed parts everything else stands on: the random stream, the
// function library, the reference grid host, and the runtime's failure modes.

import { describe, expect, it } from 'vitest';
import { createGridHost, hashSeed, Match, rollDice, RuleError } from '../src/index.ts';
import { versionSatisfies } from '../src/compile/layers.ts';
import { compileWith, loadScenario, read, tiny, tinyScenario } from './helpers.ts';

describe('seeded randomness', () => {
  // Golden values: changing the hash or the generator changes every replay.
  it('is pinned', () => {
    expect(hashSeed('1')).toBe(1428125071);
    expect(hashSeed('rpg-core')).toBe(1967010365);
    expect(rollDice(hashSeed('rpg-core'), 5, 20)).toEqual({ position: 2534904838, values: [4, 1, 15, 12, 3] });
  });

  it('rolls within the die', () => {
    const { values } = rollDice(hashSeed('range'), 2000, 6);
    expect(Math.min(...values)).toBe(1);
    expect(Math.max(...values)).toBe(6);
  });
});

describe('function library', () => {
  const registry = compileWith(tiny());
  const scenario = loadScenario(registry, tinyScenario());
  const state = new Match(registry, scenario, 1).state;
  const value = (source: string) => read(registry, scenario, state, source);

  it.each([
    ['floorDiv(7, 2)', 3], ['floorDiv(-7, 2)', -4], ['floorDiv(-8, 2)', -4], ['-7 / 2', -3],
    ['ceilDiv(7, 2)', 4], ['ceilDiv(-7, 2)', -3],
    ['abs(-3)', 3], ['sign(-9)', -1], ['min(2, 5)', 2], ['max(2, 5)', 5], ['clamp(12, 0, 10)', 10],
    ['floor(2.7)', 2], ['ceil(2.1)', 3], ['round(2.5)', 3], ['max(1.5, 0.5)', 1.5],
    ['[3, 1, 2].sum()', 6], ['[3, 1, 2].min()', 1], ['[3, 1, 2].max()', 3], ['[7, 8].first()', 7],
    ['sortBy(["c", "a", "b"], [3, 1, 2])', ['a', 'b', 'c']],
    ['sortBy(["x", "y", "z"], [1, 1, 0])', ['z', 'x', 'y']],
    ['range(3)', [0, 1, 2]],
    ['cell(1, 2).offset(2, -1)', { x: 3, y: 1 }], ['cell(0, 0).mid(cell(2, 2))', { x: 1, y: 1 }],
    ['cell(1, 2) == cell(1, 2)', true], ['cell(1, 2) == cell(2, 1)', false],
  ])('%s', (source, expected) => {
    expect(value(source)).toEqual(expected);
  });

  it('fails rather than guess on an empty list', () => {
    expect(() => value('all.token.filter(t, false).map(t, t.value).max()')).toThrow(RuleError);
  });

  it('refuses spatial questions in a ruleset with no space', () => {
    expect(() => value('distance(cell(0, 0), cell(1, 1))')).toThrow(/declares no space/);
  });
});

describe('reference grid host', () => {
  const host = createGridHost({ grid: 'square', adjacency: 8, unit: 5 }, { width: 6, height: 4, blocked: [[2, 1]] });
  const orthogonal = createGridHost({ grid: 'square', adjacency: 4 }, { width: 6, height: 4 });

  it('measures distance in the ruleset\'s units, by its adjacency', () => {
    expect(host.distance({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(15);
    expect(orthogonal.distance({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(5);
  });

  it('keeps to the map and around blocked cells', () => {
    expect(host.inBounds({ x: 5, y: 3 })).toBe(true);
    expect(host.inBounds({ x: 6, y: 3 })).toBe(false);
    expect(host.inBounds({ x: 2, y: 1 })).toBe(false);
    expect(host.neighbors({ x: 0, y: 0 })).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
    expect(orthogonal.neighbors({ x: 0, y: 0 })).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }]);
    expect(host.cellsWithin({ x: 1, y: 1 }, 5)).toHaveLength(8);
  });

  it('breaks line of sight on a blocked cell', () => {
    expect(host.lineOfSight({ x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
    expect(host.lineOfSight({ x: 0, y: 3 }, { x: 4, y: 3 })).toBe(true);
  });
});

describe('versions', () => {
  it.each([
    ['1.4.2', '1.2.0', true], ['1.2.0', '1.2.0', true], ['1.1.9', '1.2.0', false], ['2.0.0', '1.2.0', false],
    ['0.1.5', '0.1.0', true], ['0.2.0', '0.1.0', false],
  ])('%s satisfies %s: %s', (actual, wanted, expected) => {
    expect(versionSatisfies(actual, wanted)).toBe(expected);
  });
});

describe('runtime failures', () => {
  it('stops with a rule error, not a guess, when a write is invalid at run time', () => {
    const doc = tiny();
    // Type-correct, so it compiles; but "c" is not a seat in the match.
    doc.intents.bump.effects.push({ set: { 'token.owner': "'c'" } });
    const registry = compileWith(doc);
    const match = new Match(registry, loadScenario(registry, tinyScenario()), 1);
    match.advance();
    match.submit(0);
    expect(() => match.advance()).toThrow(/"c" is not a seat in this match/);
  });

  it('ends a match that outruns the scenario\'s decision limit', () => {
    const registry = compileWith(tiny());
    const doc = tinyScenario();
    doc.end = [];
    doc.limits = { maxDecisions: 3 };
    doc.entities.forEach((entity: any) => { entity.fields.value = -0; });
    const match = new Match(registry, loadScenario(registry, doc), 1);
    for (let decision = match.advance(); decision; decision = match.advance()) match.submit(0);
    expect(match.outcome).toEqual({ result: 'limit' });
  });

  it('ends as complete when the flow runs out', () => {
    const doc = tiny();
    doc.flow = [{ prompt: { seat: "'a'", offer: ['bump'] } }];
    const registry = compileWith(doc);
    const scenario = tinyScenario();
    scenario.end = [];
    const match = new Match(registry, loadScenario(registry, scenario), 1);
    for (let decision = match.advance(); decision; decision = match.advance()) match.submit(0);
    expect(match.outcome).toEqual({ result: 'complete' });
    expect(match.state.entities.t1.fields.value).toBe(2);
  });

  it('refuses a choice that was not offered', () => {
    const registry = compileWith(tiny());
    const match = new Match(registry, loadScenario(registry, tinyScenario()), 1);
    match.advance();
    expect(() => match.submit(5)).toThrow(/no option 5/);
  });
});

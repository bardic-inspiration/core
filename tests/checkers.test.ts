// The checkers rules, checked position by position. Every rule asserted here
// is written in rulesets/checkers/ruleset.yaml; the runtime knows none of them.

import { describe, expect, it } from 'vitest';
import { Match } from '../src/index.ts';
import { loadRuleset, loadScenarioFile } from '../src/load.ts';
import { choose, loadScenario, refusal } from './helpers.ts';

const registry = loadRuleset('checkers');
const standard = loadScenarioFile(registry, 'checkers', 'standard');

/** A scenario with just these pieces: `[id, owner, x, y, king?]`. */
const position = (pieces: [string, string, number, number, boolean?][]) =>
  loadScenario(registry, {
    format: 2,
    scenario: { id: 'position' },
    ruleset: { id: 'checkers', version: '0.2.0' },
    seats: { red: {}, black: {} },
    entities: pieces.map(([id, owner, x, y, king = false]) => ({ id, kind: 'piece', fields: { owner, pos: [x, y], king } })),
    end: standard.doc.end,
  });

const at = (x: number, y: number) => ({ x, y });

describe('checkers', () => {
  it('gives red seven opening moves, all steps', () => {
    const decision = new Match(registry, standard, 1).advance()!;
    expect(decision.seat).toBe('red');
    expect(decision.options).toHaveLength(7);
    expect(decision.options.every((option) => option.intent === 'step')).toBe(true);
  });

  it('moves men forward only', () => {
    const match = new Match(registry, position([['r', 'red', 2, 2], ['b', 'black', 5, 5]]), 1);
    expect(match.advance()!.options.map((option) => option.params.to)).toEqual([at(3, 3), at(1, 3)]);
    choose(match, 'red', 'step', { to: at(3, 3) });
    expect(match.advance()!.options.map((option) => option.params.to)).toEqual([at(6, 4), at(4, 4)]);
  });

  it('makes a capture mandatory and removes the captured piece', () => {
    const match = new Match(registry, position([['r', 'red', 2, 2], ['r2', 'red', 6, 0], ['b', 'black', 3, 3], ['b2', 'black', 7, 7]]), 1);
    const decision = match.advance()!;
    expect(decision.options).toEqual([{ intent: 'jump', params: { piece: 'r', to: at(4, 4) } }]);
    match.submit(0);
    expect(match.advance()!.seat).toBe('black');
    expect(match.state.entities.b).toBeUndefined();
    expect(match.state.entities.r.fields.pos).toEqual(at(4, 4));
  });

  it('keeps the same piece jumping while it can', () => {
    const match = new Match(registry, position([['r', 'red', 0, 0], ['r2', 'red', 6, 0], ['b1', 'black', 1, 1], ['b2', 'black', 3, 3], ['b3', 'black', 7, 7]]), 1);
    choose(match, 'red', 'jump', { piece: 'r', to: at(2, 2) });
    // Still red's decision, and only the jumping piece may move.
    const next = match.advance()!;
    expect(next.seat).toBe('red');
    expect(next.options).toEqual([{ intent: 'jump', params: { piece: 'r', to: at(4, 4) } }]);
    match.submit(0);
    expect(match.advance()!.seat).toBe('black');
    expect(Object.keys(match.state.entities).sort()).toEqual(['b3', 'r', 'r2']);
  });

  it('crowns a man on the far row, and a king moves both ways', () => {
    const match = new Match(registry, position([['r', 'red', 0, 6], ['b', 'black', 7, 1]]), 1);
    choose(match, 'red', 'step', { to: at(1, 7) });
    match.advance();
    expect(match.state.entities.r.fields.king).toBe(true);
    choose(match, 'black', 'step', { to: at(6, 0) });
    expect(match.advance()!.options.map((option) => option.params.to)).toEqual([at(2, 6), at(0, 6)]);
  });

  it('ends when a seat cannot move, and the other seat wins', () => {
    // Black's only man is pinned against the edge behind two red men.
    const match = new Match(registry, position([['b', 'black', 0, 2], ['r1', 'red', 1, 1], ['r2', 'red', 2, 0], ['r3', 'red', 6, 0]]), 1);
    choose(match, 'red', 'step', { piece: 'r3', to: at(7, 1) });
    expect(match.advance()).toBeNull();
    expect(match.outcome).toEqual({ result: 'win', winner: 'red' });
  });

  it('refuses a position the kind checks rule out', () => {
    expect(refusal(() => position([['r', 'red', 1, 0]]))).toMatch(/dark square/);
    expect(refusal(() => position([['r', 'red', 2, 2], ['b', 'black', 2, 2]]))).toMatch(/cannot share a square/);
    expect(refusal(() => position([['r', 'red', 8, 8]]))).toMatch(/dark square/);
  });
});

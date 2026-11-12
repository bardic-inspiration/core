// Hidden information and computed map keys: the two things the format gained
// for poker and for spell slots. Tested here on the tiny ruleset, apart from
// any game.

import { describe, expect, it } from 'vitest';
import { compileBehaviors, Match, RuleError } from '../src/index.ts';
import { compileWith, loadScenario, refusal, tiny, tinyBehaviors, tinyScenario } from './helpers.ts';

/** The tiny ruleset with a secret on each token, a secret global, and a tally kept by seat. */
const secretive = (change: (doc: any) => void = () => {}) => {
  const doc = tiny();
  doc.kinds.token.fields.secret = { type: 'int', default: 7, visible: 'viewer == self.owner' };
  doc.globals.vault = { type: 'int', default: 99, visible: false };
  doc.globals.tally = { type: 'map<string,int>', default: {} };
  doc.intents.bump.effects.push({ set: { 'game.tally[seat]': "(seat in game.tally ? game.tally[seat] : 0) + 1" } });
  change(doc);
  return doc;
};
const start = (doc = secretive()) => {
  const registry = compileWith(doc);
  const scenario = loadScenario(registry, { ...tinyScenario(), seats: { a: {}, b: {}, ref: { referee: true } } });
  return new Match(registry, scenario, 1);
};

describe('hidden information', () => {
  it('gives each seat the state without what is hidden from it', () => {
    const match = start();
    const a = match.view('a');
    expect(a.entities.t1.fields.secret).toBe(7);
    expect('secret' in a.entities.t2.fields).toBe(false);
    expect('vault' in a.game).toBe(false);
    expect(a.game.turns).toBe(0);
    expect(match.view('b').entities.t2.fields.secret).toBe(7);
    // The rules, the log, and a referee see everything.
    expect(match.state.entities.t2.fields.secret).toBe(7);
    expect(match.view('ref')).toBe(match.state);
  });

  it('leaves the state alone when a ruleset hides nothing', () => {
    const registry = compileWith(tiny());
    const match = new Match(registry, loadScenario(registry, tinyScenario()), 1);
    expect(match.view('a')).toBe(match.state);
  });

  it('scores a behavior through the seat\'s own view, so reading a secret is an error', () => {
    const match = start();
    const decision = match.advance()!;
    expect(decision.seat).toBe('a');
    const { byName } = compileBehaviors(match.registry, tinyBehaviors({
      honest: { scores: { bump: 'token.secret' } },
      peeker: { scores: { bump: 'all.token.map(t, t.secret).sum()' } },
      thief: { scores: { bump: 'game.vault' } },
    }));
    expect(match.scores(byName.get('honest')!, 'a', decision.options)).toEqual([7]);
    expect(() => match.scores(byName.get('peeker')!, 'a', decision.options)).toThrow(RuleError);
    expect(() => match.scores(byName.get('peeker')!, 'a', decision.options)).toThrow(/token\.secret of "t2" is hidden from seat "a"/);
    expect(() => match.scores(byName.get('thief')!, 'a', decision.options)).toThrow(/game\.vault is hidden from seat "a"/);
  });

  it('works out the legal intents through the seat\'s view too', () => {
    // A gate that reads another seat's secret cannot be evaluated for the seat deciding.
    const match = start(secretive((doc) => { doc.intents.bump.gate = 'all.token.all(t, t.secret > 0)'; }));
    expect(() => match.advance()).toThrow(/is hidden from seat "a"/);
  });

  it('refuses a visibility rule that is not a yes or no, or that reads what is out of scope', () => {
    expect(refusal(() => compileWith(secretive((doc) => { doc.kinds.token.fields.secret.visible = 'self.value'; }))))
      .toMatch(/kinds\.token\.fields\.secret\.visible: is int, but bool is needed/);
    expect(refusal(() => compileWith(secretive((doc) => { doc.globals.vault.visible = 'self.owner == viewer'; }))))
      .toMatch(/globals\.vault\.visible/);
    expect(refusal(() => compileWith(secretive((doc) => { doc.intents.bump.params.viewer = 'seat'; }))))
      .toMatch(/"viewer" is a reserved name/);
  });
});

describe('a write to a computed map key', () => {
  it('writes one entry and keeps the rest', () => {
    const match = start();
    for (let i = 0; i < 3; i++) {
      match.advance();
      match.submit(0);
    }
    match.advance();
    expect(match.state.game.tally).toEqual({ a: 2, b: 1 });
    // A global is logged whole: the scenario's starting value, then one entry per write.
    expect(match.log.filter((event) => event.t === 'global' && event.field === 'tally').map((event) => (event as any).value))
      .toEqual([{}, { a: 1 }, { a: 1, b: 1 }, { a: 2, b: 1 }]);
  });

  it('writes an entry of an entity\'s map, as a keyed event', () => {
    const doc = secretive((d) => {
      d.kinds.token.fields.marks = { type: 'map<color,int>', default: { red: 0, blue: 0 } };
      d.intents.bump.effects.push({ set: { 'token.marks[token.color]': 'token.marks[token.color] + 1' } });
    });
    const match = start(doc);
    match.advance();
    match.submit(0);
    match.advance();
    expect(match.state.entities.t1.fields.marks).toEqual({ red: 1, blue: 0 });
    expect(match.log.find((event) => event.t === 'set' && event.field === 'marks')).toMatchObject({ id: 't1', key: 'red', value: 1 });
  });

  it('refuses a key on something that is not a map, and a key of the wrong type', () => {
    expect(refusal(() => compileWith(secretive((d) => { d.intents.bump.effects.push({ set: { 'token.value[seat]': 1 } }); }))))
      .toMatch(/"value" has no keys/);
    expect(refusal(() => compileWith(secretive((d) => { d.intents.bump.effects.push({ set: { 'game.tally[token.value]': 1 } }); }))))
      .toMatch(/is int, but string is needed/);
  });

  it('refuses, when the write runs, a key the map\'s enum does not have', () => {
    const doc = secretive((d) => {
      d.kinds.token.fields.marks = { type: 'map<color,int>', default: { red: 0, blue: 0 } };
      d.intents.bump.effects.push({ set: { 'token.marks[seat]': 1 } });
    });
    const match = start(doc);
    match.advance();
    match.submit(0);
    expect(() => match.advance()).toThrow(/"a" is not a valid color/);
  });
});

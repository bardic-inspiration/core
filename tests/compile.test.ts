// Sign of success 1: invalid rules data is refused at compile time.

import { describe, expect, it } from 'vitest';
import { loadRuleset, loadScenarioFile } from '../src/load.ts';
import { compileWith, loadScenario, refusal, tiny, tinyScenario } from './helpers.ts';

describe('compile', () => {
  it('accepts the minimal ruleset and its scenario', () => {
    const registry = compileWith(tiny());
    expect(() => loadScenario(registry, tinyScenario())).not.toThrow();
  });

  it('accepts both shipped rulesets and their scenarios', () => {
    const checkers = loadRuleset('checkers');
    expect(() => loadScenarioFile(checkers, 'checkers', 'standard')).not.toThrow();
    const dnd = loadRuleset('dnd-5e-2024-slice');
    expect(() => loadScenarioFile(dnd, 'dnd-5e-2024-slice', 'worg-vs-scout')).not.toThrow();
  });

  it('gives every declared fact an address', () => {
    const { addresses } = loadRuleset('dnd-5e-2024-slice');
    expect(addresses.get('creature.ability.str')).toEqual({ of: 'key', type: 'int' });
    expect(addresses.get('creature.mod.dex')).toEqual({ of: 'key', type: 'int' });
    expect(addresses.get('creature.hpMax')).toEqual({ of: 'derived', type: 'int' });
    expect(addresses.get('creature.wields')).toEqual({ of: 'relation', type: 'list<weapon>' });
    expect(addresses.get('game.round')).toEqual({ of: 'global', type: 'int' });
    expect(addresses.has('creature.mana')).toBe(false);
  });

  // Each case breaks the minimal ruleset one way and names the reason it must be refused for.
  const refusals: [string, (doc: any) => void, RegExp][] = [
    ['an unknown top-level key', (d) => { d.rules = {}; }, /unknown key "rules"/],
    ['an unsupported format version', (d) => { d.format = 2; }, /format 2 is not supported/],
    ['an unknown effect', (d) => { d.intents.bump.effects.push({ teleport: 'token' }); }, /intents\.bump\.effects/],
    ['an unknown field type', (d) => { d.kinds.token.fields.value = 'integer'; }, /unknown type "integer"/],
    ['a reserved kind name', (d) => { d.kinds.string = {}; }, /reserved type name/],
    ['a default of the wrong type', (d) => { d.kinds.token.fields.value.default = 'one'; }, /"one" is not a valid int/],
    ['an address that does not exist', (d) => { d.kinds.token.derived.double.value = 'self.valeu * 2'; }, /No such key: valeu/],
    ['a derived value of the wrong type', (d) => { d.kinds.token.derived.double.value = '"two"'; }, /is string, but int is needed/],
    ['a syntax error in an expression', (d) => { d.intents.bump.gate = 'token.value <'; }, /intents\.bump\.gate/],
    ['a gate that is not a bool', (d) => { d.intents.bump.gate = 'token.value + 1'; }, /is int, but bool is needed/],
    ['an unknown function', (d) => { d.intents.bump.gate = 'lucky(token.value)'; }, /intents\.bump\.gate/],
    ['an unbound variable', (d) => { d.intents.bump.gate = 'other.value < 3'; }, /Unknown variable: other/],
    ['a write of the wrong type', (d) => { d.intents.bump.effects[0].set['token.value'] = '"more"'; }, /is string, but int is needed/],
    ['a write to an undeclared address', (d) => { d.intents.bump.effects[0] = { set: { 'token.weight': 1 } }; }, /no such address "token\.weight"/],
    ['a write to a derived value', (d) => { d.intents.bump.effects[0] = { set: { 'token.double': 4 } }; }, /"double" is derived/],
    ['a write to an undeclared global', (d) => { d.reactions[0].do[0] = { set: { 'game.score': 1 } }; }, /no such address "game\.score"/],
    ['an unknown signal', (d) => { d.intents.bump.effects[1].emit = 'bounced'; }, /unknown signal "bounced"/],
    ['a missing signal argument', (d) => { delete d.intents.bump.effects[1].with; }, /signal "bumped" needs "token"/],
    ['an extra signal argument', (d) => { d.intents.bump.effects[1].with.force = 2; }, /takes no "force"/],
    ['a reaction to an unknown signal', (d) => { d.reactions[0].on = 'bounced'; }, /unknown signal "bounced"/],
    ['a prompt offering an unknown intent', (d) => { d.flow[0].do[0].do[0].prompt.offer = ['pass']; }, /unknown intent "pass"/],
    ['a prompt seat that is not a seat', (d) => { d.flow[0].do[0].do[0].prompt.seat = 'game.turns'; }, /is int, but string is needed/],
    ['a prompt that does not give a needed param', (d) => { delete d.intents.bump.params.token.in; }, /needs "token" given/],
    ['a create that leaves out a required field', (d) => { d.reactions[0].do.push({ create: { kind: 'token', fields: { owner: 'token.owner' } } }); }, /token needs "color"/],
    ['a create of an unknown kind', (d) => { d.reactions[0].do.push({ create: { kind: 'coin' } }); }, /unknown kind "coin"/],
    ['an unknown relation', (d) => { d.reactions[0].do.push({ link: { rel: 'holds', from: 'token', to: 'token' } }); }, /unknown relation "holds"/],
    ['a rebinding of a reserved name', (d) => { d.reactions[0].do.unshift({ let: { game: '1' } }); }, /"game" is a reserved name/],
    ['a variable assigned a different type', (d) => { d.reactions[0].do.unshift({ let: { n: '1' } }, { let: { n: '"x"' } }); }, /"n" is int; it cannot take a string/],
    ['an unknown pattern', (d) => { d.uses = [{ pattern: 'mana' }]; }, /unknown pattern "mana"/],
    ['a pattern missing a param', (d) => { d.uses = [{ pattern: 'pool', with: { kind: 'token', name: 'hp' } }]; }, /pattern "pool" needs "max"/],
    ['a pattern given an unknown param', (d) => { d.uses = [{ pattern: 'check', with: { name: 'test', dice: 3 } }]; }, /has no param "dice"/],
    ['a behavior scoring an unknown intent', (d) => { d.behaviors.eager.scores.pass = 1; }, /unknown intent "pass"/],
    ['a relation to an unknown kind', (d) => { d.relations = { holds: { from: 'token', to: 'bag' } }; }, /unknown kind "bag"/],
    ['vertical movement, which core does not support yet', (d) => { d.space = { grid: 'square', vertical: true }; }, /vertical movement is not supported/],
    ['a mixed-type table', (d) => { d.tables = { odd: { a: 1, b: 'two' } }; }, /table entries must share one type/],
  ];

  it.each(refusals)('refuses %s', (_name, breakIt, reason) => {
    const doc = tiny();
    breakIt(doc);
    expect(refusal(() => compileWith(doc))).toMatch(reason);
  });

  it('reports every problem at once, each with its path', () => {
    const doc = tiny();
    doc.kinds.token.derived.double.value = 'self.valeu * 2';
    doc.intents.bump.gate = 'token.value + 1';
    const message = refusal(() => compileWith(doc));
    expect(message).toMatch(/ruleset\.kinds\.token\.derived\.double\.value/);
    expect(message).toMatch(/ruleset\.intents\.bump\.gate\.0/);
  });
});

describe('scenario', () => {
  const registry = compileWith(tiny());
  const scenarioRefusals: [string, (doc: any) => void, RegExp][] = [
    ['an unknown key', (d) => { d.board = {}; }, /unknown key "board"/],
    ['another ruleset', (d) => { d.ruleset.id = 'chess'; }, /written for chess/],
    ['a newer ruleset version than the one loaded', (d) => { d.ruleset.version = '1.1.0'; }, /written for tiny@1\.1\.0/],
    ['an instance of an undeclared kind', (d) => { d.entities.push({ kind: 'coin' }); }, /declares no kind "coin"/],
    ['an undeclared field', (d) => { d.entities[0].fields.weight = 2; }, /token has no field "weight"/],
    ['a missing required field', (d) => { delete d.entities[0].fields.color; }, /token needs "color"/],
    ['a value outside its enum', (d) => { d.entities[0].fields.color = 'green'; }, /"green" is not a valid color/],
    ['a non-integer in an int field', (d) => { d.entities[0].fields.value = 1.5; }, /1\.5 is not a valid int/],
    ['a seat that is not in the match', (d) => { d.entities[0].fields.owner = 'c'; }, /"c" is not a seat/],
    ['an instance that fails a kind check', (d) => { d.entities[0].fields.value = -1; }, /value cannot be negative/],
    ['a duplicate id', (d) => { d.entities[1].id = 't1'; }, /"t1" already exists/],
    ['an undeclared global', (d) => { d.game = { score: 1 }; }, /declares no such global/],
    ['a space the ruleset does not have', (d) => { d.space = { width: 3, height: 3 }; }, /declares no space/],
    ['an end condition with a bad address', (d) => { d.end[0].when = 'game.turn > 3'; }, /No such key: turn/],
    ['an end condition that is not a bool', (d) => { d.end[0].when = 'game.turns'; }, /an end condition is a bool/],
    ['an unknown behavior', (d) => { d.seats.a.behavior = 'lazy'; }, /unknown behavior "lazy"/],
  ];

  it.each(scenarioRefusals)('refuses %s', (_name, breakIt, reason) => {
    const doc = tinyScenario();
    breakIt(doc);
    expect(refusal(() => loadScenario(registry, doc))).toMatch(reason);
  });

  it('holds a ruleset with fixed seats to exactly those seats', () => {
    const checkers = loadRuleset('checkers');
    const doc = { format: 1, scenario: { id: 'x' }, ruleset: { id: 'checkers', version: '0.1.0' }, seats: { red: {}, green: {} } };
    expect(refusal(() => loadScenario(checkers, doc))).toMatch(/fixes the seats as red, black/);
  });
});

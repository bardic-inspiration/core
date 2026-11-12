// Layers: the pattern kit, a base ruleset, and extensions that may change
// only what the base marks open.

import { describe, expect, it } from 'vitest';
import { loadScenario, Match, UtilitySeat, fold } from '../src/index.ts';
import { loadRuleset, loadScenarioFile, readYaml } from '../src/load.ts';
import { aiSeats, compileWith, fixture, read, refusal, tiny } from './helpers.ts';

const base = () => readYaml('rulesets/dnd-5e-2024-slice/ruleset.yaml');
const extension = (body: Record<string, unknown>, wants = '0.1.0') => ({
  format: 1, extension: { id: 'test', version: '0.1.0' }, extends: { id: 'dnd-5e-2024-slice', version: wants }, ...body,
});

describe('extensions', () => {
  it('adds what the base marks open, and the addition plays', () => {
    const registry = loadRuleset('dnd-5e-2024-slice', ['second-wind']);
    expect(registry.layers.map((layer) => layer.id)).toEqual(['dnd-5e-2024-slice', 'second-wind']);
    expect(registry.addresses.has('creature.secondWinds')).toBe(true);
    const scenario = loadScenarioFile(registry, 'dnd-5e-2024-slice', 'worg-vs-scout');
    const used = [1, 2, 3, 4, 5, 6].some((seed) => {
      const { log, state } = new Match(registry, scenario, seed).run(aiSeats(scenario, seed));
      expect(fold(log)).toEqual(state);
      return log.some((event) => event.t === 'intent' && event.intent === 'secondWind');
    });
    expect(used).toBe(true);
  });

  it('leaves the base untouched when no extension is loaded', () => {
    expect(loadRuleset('dnd-5e-2024-slice').addresses.has('creature.secondWinds')).toBe(false);
  });

  const closed: [string, Record<string, unknown>, RegExp][] = [
    ['replaces a derived value', { kinds: { creature: { derived: { mod: { value: '5' } } } } }, /replaces this.*kinds\.creature\.derived\.mod\.value/],
    ['replaces an intent\'s gate', { intents: { dash: { gate: 'true' } } }, /replaces this.*intents\.dash\.gate/],
    ['appends to an existing intent\'s effects', { intents: { endTurn: { effects: [{ done: true }] } } }, /appends to this.*intents\.endTurn\.effects/],
    ['adds to a closed enum', { enums: { ability: ['luck'] } }, /appends to this.*enums\.ability/],
    ['rewrites the flow', { flow: [{ set: { 'game.round': 99 } }] }, /appends to this.*"flow"/],
    ['replaces a table entry', { tables: { hitDie: { large: 100 } } }, /replaces this.*tables\.hitDie\.large/],
    ['changes the space', { space: { unit: 10 } }, /replaces this.*space\.unit/],
  ];
  it.each(closed)('refuses an extension that %s', (_name, body, reason) => {
    expect(refusal(() => compileWith(base(), [extension(body)]))).toMatch(reason);
  });

  it('allows additions to an open enum and new tables', () => {
    const registry = compileWith(base(), [extension({ enums: { damageType: ['poison'] }, tables: { poisonDc: { weak: 10, strong: 15 } } })]);
    expect(registry.enums.get('damageType')).toContain('poison');
    expect(registry.addresses.has('tables.poisonDc')).toBe(true);
  });

  it('still type-checks what an extension adds', () => {
    const body = { intents: { howl: { params: { actor: 'creature' }, effects: [{ set: { 'actor.courage': 1 } }] } } };
    expect(refusal(() => compileWith(base(), [extension(body)]))).toMatch(/no such address "actor\.courage"/);
  });

  it('refuses an extension written for another ruleset or an incompatible version', () => {
    expect(refusal(() => compileWith(base(), [extension({}, '0.2.0')]))).toMatch(/extends dnd-5e-2024-slice@0\.2\.0/);
    expect(refusal(() => compileWith(tiny(), [extension({})]))).toMatch(/but the base is tiny@1\.0\.0/);
  });

  it('refuses an extension that tries to open the base itself', () => {
    expect(refusal(() => compileWith(base(), [extension({ open: ['flow'] })]))).toMatch(/unknown key "open"/);
  });
});

describe('patterns', () => {
  it('expand to ordinary declarations', () => {
    const doc = tiny();
    doc.uses = [{ pattern: 'pool', with: { kind: 'token', name: 'charge', max: 'self.value * 3' } }];
    const registry = compileWith(doc);
    expect(registry.addresses.get('token.charge')).toEqual({ of: 'field', type: 'int' });
    expect(registry.addresses.get('token.chargeMax')).toEqual({ of: 'derived', type: 'int' });
    expect([...registry.signals.keys()]).toEqual(expect.arrayContaining(['charge.lose', 'charge.gain', 'charge.empty']));
    expect(registry.doc.kinds!.token.fields!.charge).toEqual({ type: 'int', init: 'self.chargeMax' });
    expect('uses' in registry.doc).toBe(false);
  });

  it('are type-checked after substitution, like anything else', () => {
    const doc = tiny();
    doc.uses = [{ pattern: 'pool', with: { kind: 'token', name: 'charge', max: 'self.color' } }];
    expect(refusal(() => compileWith(doc))).toMatch(/derived\.chargeMax\.value: is string, but int is needed/);
  });

  it('conflict loudly when two declarations disagree', () => {
    const doc = tiny();
    doc.uses = [{ pattern: 'budget', with: { kind: 'token', name: 'value', amount: 2, signal: 'bumped', who: 'token' } }];
    expect(refusal(() => compileWith(doc))).toMatch(/kinds\.token\.fields\.value\.default: declared twice/);
  });
});

describe('a tick-driven sandbox (fixture)', () => {
  const registry = compileWith(fixture('junkyard'));
  const scenario = loadScenario(registry, {
    format: 1,
    scenario: { id: 'yard' },
    ruleset: { id: 'junkyard', version: '0.1.0' },
    seats: { yard: { behavior: 'builder' } },
    entities: [{ id: 'first', kind: 'bot', fields: { seat: 'yard' } }],
    end: [{ when: 'game.tick >= 8', outcome: { bots: 'all.bot.size()', power: 'all.bot.map(b, b.power).sum()' } }],
  });

  it('grows state during play: bots salvage parts and split into new bots', () => {
    const match = new Match(registry, scenario, 7);
    const { outcome, state, log } = match.run({ yard: new UtilitySeat('builder', 7, 'yard') });
    expect(outcome.bots).toBe(4);
    expect(Object.values(state.entities).filter((entity) => entity.kind === 'part')).toHaveLength(6);
    expect(state.game.scrap).toBe(0);
    expect(match.violations()).toEqual([]);
    expect(fold(log)).toEqual(state);
  });

  it('stacks part bonuses by the declared rule', () => {
    const match = new Match(registry, scenario, 7);
    match.run({ yard: new UtilitySeat('builder', 7, 'yard') });
    const mounted = (match.state.links.mounts ?? []).filter(([from]) => from === 'first').map(([, to]) => match.state.entities[to].fields);
    expect(mounted.length).toBeGreaterThan(0);
    // Power sums over the base of 1; armor counts only the best part.
    const first = "all.bot.filter(b, b.id == 'first').first()";
    expect(read(registry, scenario, match.state, `${first}.power`)).toBe(1 + mounted.reduce((sum, part) => sum + (part.power as number), 0));
    expect(read(registry, scenario, match.state, `${first}.armor`)).toBe(Math.max(...mounted.map((part) => part.armor as number)));
  });

  it('refuses a link that overfills the slots', () => {
    const doc = structuredClone(scenario.doc) as any;
    doc.entities.push(...[1, 2, 3].map((n) => ({ id: `p${n}`, kind: 'part', fields: { power: 1, armor: 1 } })));
    doc.links = [1, 2, 3].map((n) => ({ rel: 'mounts', from: 'first', to: `p${n}` }));
    expect(refusal(() => loadScenario(registry, doc))).toMatch(/mounts holds at most self\.sockets/);
  });
});

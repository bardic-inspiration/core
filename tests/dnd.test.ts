// The 5e combat slice. The derived numbers are checked against what SRD 5.2
// prints for the worg and the scout, the same numbers ttrpg-library derives
// in rulesets/dnd-5e-2024/derive.ts.

import { describe, expect, it } from 'vitest';
import { Match, RuleError } from '../src/index.ts';
import { loadRuleset, loadScenarioFile, readYaml } from '../src/load.ts';
import { choose, loadScenario, play, read as readState, refusal } from './helpers.ts';

const registry = loadRuleset('dnd-5e-2024-slice');
const scenario = loadScenarioFile(registry, 'dnd-5e-2024-slice', 'worg-vs-scout');

const read = (match: Match, source: string): unknown => readState(registry, scenario, match.state, source);
const creature = (id: string) => `all.creature.filter(c, c.id == '${id}').first()`;

/** The worg and scout standing next to each other, so tests can skip the approach. */
const adjacent = () => {
  const doc = readYaml('rulesets/dnd-5e-2024-slice/scenarios/worg-vs-scout.yaml') as any;
  doc.entities[0].fields.pos = [10, 6];
  doc.entities[2].fields.pos = [11, 6];
  return loadScenario(registry, doc);
};

/** Plays turns by script until `seat` is asked to decide, ending anyone else's turn. */
const until = (match: Match, seat: string) => {
  for (let decision = match.advance(); decision && decision.seat !== seat; decision = match.advance()) {
    match.submit(decision.options.findIndex((option) => option.intent === 'endTurn'));
  }
};

describe('derived values', () => {
  const match = new Match(registry, scenario, 1);

  it('rounds ability modifiers down, as 5e does', () => {
    expect(read(match, `${creature('worg')}.mod['str']`)).toBe(3);
    expect(read(match, `${creature('worg')}.mod['int']`)).toBe(-2); // 7 gives -2, not -1
    expect(read(match, `${creature('worg')}.mod['cha']`)).toBe(-1); // 8 gives -1
    expect(read(match, `${creature('scout')}.mod['dex']`)).toBe(2);
    expect(read(match, 'floorDiv(9 - 10, 2)')).toBe(-1);
    expect(read(match, '(9 - 10) / 2')).toBe(0); // plain division truncates toward zero
  });

  it('derives hit points from Hit Dice, size, and Constitution', () => {
    expect(read(match, `${creature('worg')}.hpMax`)).toBe(26); // 4d10 + 4
    expect(read(match, `${creature('scout')}.hpMax`)).toBe(16); // 3d8 + 3
    expect(match.state.entities.worg.fields.hp).toBe(26);
  });

  it('derives the proficiency bonus from the CR table, and reach from wielded weapons', () => {
    expect(read(match, `${creature('worg')}.pb`)).toBe(2);
    expect(read(match, `${creature('scout')}.reach`)).toBe(5);
    expect(read(match, `${creature('scout')}.wields.map(w, w.maxRange)`)).toEqual([5, 600]);
  });
});

describe('scenario checks', () => {
  const broken = (change: (doc: any) => void) => {
    const doc = readYaml('rulesets/dnd-5e-2024-slice/scenarios/worg-vs-scout.yaml') as any;
    change(doc);
    return refusal(() => loadScenario(registry, doc));
  };

  it('refuses a stat block that breaks a consistency check', () => {
    expect(broken((d) => { d.entities[0].fields.speed = 33; })).toMatch(/speed must be a multiple of 5/);
    expect(broken((d) => { d.entities[0].fields.cr = '3/4'; })).toMatch(/not in the CR table|No such key/);
    expect(broken((d) => { delete d.entities[0].fields.ability.wis; })).toMatch(/map is missing wis/);
    expect(broken((d) => { d.entities[0].fields.ability.luck = 10; })).toMatch(/"luck" is not a valid ability/);
  });

  it('refuses more wielded weapons than the slots allow', () => {
    expect(broken((d) => { d.links.push({ rel: 'wields', from: 'scout', to: 'bite' }); })).toMatch(/wields holds at most 2/);
  });
});

describe('combat', () => {
  it('rolls initiative and gives each turn its budgets', () => {
    const match = new Match(registry, scenario, 1);
    const first = match.advance()!;
    const actor = first.options[0].params.actor as string;
    expect(match.state.game.round).toBe(1);
    expect(match.state.entities[actor].fields).toMatchObject({ action: 1, reaction: 1 });
    expect(match.state.entities[actor].fields.movement).toBe(match.state.entities[actor].fields.speed);
  });

  it('offers only attacks that are in range', () => {
    const match = new Match(registry, scenario, 1);
    until(match, 'wild');
    // 90 feet apart: the worg's bite reaches 5.
    expect(match.advance()!.options.some((option) => option.intent === 'attack')).toBe(false);
    until(match, 'ranger');
    const attacks = match.advance()!.options.filter((option) => option.intent === 'attack');
    expect(attacks).toEqual([{ intent: 'attack', params: { actor: 'scout', weapon: 'longbow', target: 'worg' } }]);
  });

  it('gives the scout two attacks for one action, and no third', () => {
    const match = new Match(registry, scenario, 1);
    until(match, 'ranger');
    choose(match, 'ranger', 'attack', { weapon: 'longbow' });
    choose(match, 'ranger', 'attack', { weapon: 'longbow' });
    const after = match.advance();
    if (after) expect(after.options.some((option) => option.intent === 'attack' || option.intent === 'dash')).toBe(false);
  });

  it('asks the other seat for a reaction in the middle of a move', () => {
    const match = new Match(registry, adjacent(), 2);
    until(match, 'ranger');
    choose(match, 'ranger', 'move', { to: { x: 12, y: 6 } });
    // The scout has not moved yet: the worg's seat decides first.
    const reaction = match.advance()!;
    expect(reaction.seat).toBe('wild');
    expect(reaction.options.map((option) => option.intent)).toEqual(['opportunityAttack', 'holdReaction']);
    expect(match.state.entities.scout.fields.pos).toEqual({ x: 11, y: 6 });
    choose(match, 'wild', 'opportunityAttack');
    const back = match.advance();
    expect(match.state.entities.worg.fields.reaction).toBe(0);
    if (back) {
      // The move completes, and it is still the scout's turn.
      expect(back.seat).toBe('ranger');
      expect(match.state.entities.scout.fields.pos).toEqual({ x: 12, y: 6 });
      // The reaction is spent: stepping away again provokes nothing.
      choose(match, 'ranger', 'move', { to: { x: 13, y: 6 } });
      expect(match.advance()!.seat).toBe('ranger');
    }
  });

  it('lets the reaction be declined', () => {
    const match = new Match(registry, adjacent(), 2);
    until(match, 'ranger');
    choose(match, 'ranger', 'move', { to: { x: 12, y: 6 } });
    choose(match, 'wild', 'holdReaction');
    expect(match.advance()!.seat).toBe('ranger');
    expect(match.state.entities.worg.fields.reaction).toBe(1);
    expect(match.state.entities.scout.fields.hp).toBe(16);
  });

  it('marks the bitten target, spends the mark on the next attack roll, and expires it on the worg\'s turn', () => {
    // Find a seed where the worg's bite hits without dropping the scout.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const { log } = play(registry, scenario, seed);
      const created = log.find((event) => event.t === 'create' && event.kind === 'exposure');
      if (!created || created.t !== 'create') continue;
      const destroyed = log.find((event) => event.t === 'destroy' && event.id === created.id);
      const linked = log.find((event) => event.t === 'link' && event.from === created.id);
      expect(linked).toMatchObject({ rel: 'exposureOn', to: 'scout' });
      if (destroyed) expect(destroyed.seq).toBeGreaterThan(created.seq);
      return;
    }
    throw new Error('no seed produced a bite that hit');
  });

  it('ends the moment one side is down, mid-turn', () => {
    const { log, outcome, state } = play(registry, scenario, 3);
    expect(outcome).toMatchObject({ result: 'win' });
    const loser = Object.entries(state.entities).find(([, entity]) => entity.fields.defeated === true)![0];
    expect(state.entities[loser].fields.hp).toBe(0);
    expect(log[log.length - 2]).toMatchObject({ t: 'set', id: loser, field: 'defeated', value: true });
  });
});

describe('referee seat', () => {
  const start = () => {
    const match = new Match(registry, scenario, 1);
    match.advance();
    return match;
  };

  it('authors new instances of declared kinds during play', () => {
    const match = start();
    match.author('referee', [
      { create: { id: 'pup', kind: 'creature', fields: { name: 'Worg Pup', seat: 'wild', side: 'monsters', size: 'medium', cr: '1/8', ac: 12, hitDice: 2, speed: 40, ability: { str: 12, dex: 13, con: 12, int: 5, wis: 11, cha: 6 }, pos: [3, 3] } } },
      { create: { id: 'nip', kind: 'weapon', fields: { name: 'Nip', ability: 'str', dice: 1, die: 4, damageType: 'piercing' } } },
      { link: { rel: 'wields', from: 'pup', to: 'nip' } },
    ]);
    expect(match.state.entities.pup.fields.hp).toBe(11); // 2d8 + 2, derived like any other creature
    expect(match.log.filter((event) => event.by === 'referee')).toHaveLength(3);
    // The pup joins the fight: it is in the next round's turn order.
    const actors = new Set<string>();
    for (let decision = match.advance(), i = 0; decision && i < 200; decision = match.advance(), i++) {
      actors.add(decision.options[0].params.actor as string);
      match.submit(decision.options.findIndex((option) => option.intent === 'endTurn' || option.intent === 'holdReaction'));
      if (actors.has('pup')) break;
    }
    expect(actors.has('pup')).toBe(true);
  });

  it('refuses anything the ruleset does not declare, and changes nothing', () => {
    const match = start();
    const before = match.state;
    const refused = (changes: Parameters<Match['author']>[1], reason: RegExp) => {
      expect(() => match.author('referee', changes)).toThrow(RuleError);
      expect(() => match.author('referee', changes)).toThrow(reason);
    };
    refused([{ create: { kind: 'trap', fields: {} } }], /declares no kind "trap"/);
    refused([{ set: { id: 'worg', field: 'mana', value: 3 } }], /no such address "worg\.mana"/);
    refused([{ set: { id: 'worg', field: 'hp', value: 'lots' } }], /"lots" is not a valid int/);
    refused([{ set: { id: 'worg', field: 'hp', value: 999 } }], /hp must be between 0 and its maximum/);
    refused([{ set: { id: 'worg', field: 'ability', key: 'luck', value: 3 } }], /no such address/);
    refused([{ link: { rel: 'wields', from: 'worg', to: 'scout' } }], /wields joins a creature to a weapon/);
    refused([{ set: { id: 'scout', field: 'hp', value: 5 } }, { create: { kind: 'trap' } }], /declares no kind/);
    expect(match.state).toBe(before);
    expect(() => match.author('wild', [{ destroy: 'scout' }])).toThrow(/is not a referee/);
  });

  it('rules that an intent happens outside the prompt on offer', () => {
    const match = start();
    // An unplanned action: the scout snaps off a shot out of turn. The referee maps it onto `attack`.
    match.adjudicate('referee', 'ranger', 'attack', { actor: 'scout', weapon: 'longbow', target: 'worg' });
    match.advance();
    const ruled = match.log.find((event) => event.t === 'intent' && event.by === 'referee');
    expect(ruled).toMatchObject({ seat: 'ranger', intent: 'attack' });
    expect(match.log.some((event) => event.t === 'roll' && event.seq > ruled!.seq)).toBe(true);
    expect(() => match.adjudicate('referee', 'ranger', 'attack', { actor: 'scout', weapon: 'worg', target: 'worg' })).toThrow(/is not an existing weapon/);
    expect(() => match.adjudicate('referee', 'ranger', 'fly', {})).toThrow(/declares no intent "fly"/);
  });
});

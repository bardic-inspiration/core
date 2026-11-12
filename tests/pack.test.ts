// The pack ambush: ten creatures on seven seats. Tests the rules it adds to
// the 5e slice (Pack Tactics, Prone, Nimble Escape, extra damage with
// Advantage, healing) and what its behaviors choose.

import { describe, expect, it } from 'vitest';
import { Match, type Decision } from '../src/index.ts';
import { loadRuleset, loadScenarioFile, readYaml } from '../src/load.ts';
import { findSeed, loadScenario, play, read as readState } from './helpers.ts';

const registry = loadRuleset('dnd-5e-2024-slice');
const shipped = loadScenarioFile(registry, 'dnd-5e-2024-slice', 'pack-ambush');

/** The scenario with some creatures moved; everyone else stays where the file puts them. */
const arranged = (positions: Record<string, [number, number]>) => {
  const doc = readYaml('rulesets/dnd-5e-2024-slice/scenarios/pack-ambush.yaml') as any;
  for (const entity of doc.entities) if (entity.id in positions) entity.fields.pos = positions[entity.id];
  return loadScenario(registry, doc);
};

/** Passes every decision until `actor` has its turn, and returns that decision. */
const turnOf = (match: Match, actor: string): Decision => {
  for (let decision = match.advance(); decision; decision = match.advance()) {
    if (decision.options.some((option) => option.intent === 'endTurn' && option.params.actor === actor)) return decision;
    match.submit(decision.options.findIndex((option) => option.intent === 'endTurn' || option.intent === 'holdReaction'));
  }
  throw new Error(`the match ended before ${actor} had a turn`);
};
const take = (match: Match, intent: string, want: Record<string, unknown> = {}) => {
  const decision = match.advance()!;
  const index = decision.options.findIndex((option) =>
    option.intent === intent && Object.entries(want).every(([name, value]) => JSON.stringify(option.params[name]) === JSON.stringify(value)));
  if (index < 0) throw new Error(`cannot ${intent} ${JSON.stringify(want)}; legal: ${JSON.stringify(decision.options)}`);
  match.submit(index);
};
const d20s = (match: Match, from: number) => match.log.slice(from).filter((event) => event.t === 'roll' && event.d === 20).length;

describe('the scenario', () => {
  it('derives every stat block\'s hit points from its Hit Dice, size, and Constitution', () => {
    const match = new Match(registry, shipped, 1);
    const hp = (id: string) => match.state.entities[id].fields.hp;
    expect({ worg: hp('worg'), wolf: hp('wolf-a'), goblin: hp('goblin-a'), tough: hp('tough'), guard: hp('guard'), scout: hp('scout'), acolyte: hp('acolyte') })
      .toEqual({ worg: 26, wolf: 11, goblin: 10, tough: 32, guard: 11, scout: 16, acolyte: 11 });
    expect(readState(registry, shipped, match.state, "all.creature.filter(c, c.id == 'acolyte').first().spellDc")).toBe(12);
  });

  it('is played by six seats, some running several creatures', () => {
    const { log, outcome } = play(registry, shipped, 1);
    const deciders = new Map<string, Set<string>>();
    for (const event of log) {
      if (event.t !== 'intent') continue;
      deciders.set(event.seat, (deciders.get(event.seat) ?? new Set()).add(event.params.actor as string));
    }
    expect([...deciders.keys()].sort()).toEqual(['goblins', 'healer', 'pack', 'ranger', 'sentry', 'vanguard']);
    // A creature that falls before its first turn never decides anything.
    expect(deciders.get('pack')!.size).toBeGreaterThanOrEqual(3);
    expect(deciders.get('goblins')!.size).toBe(2);
    expect(outcome.result).toBe('win');
  });
});

describe('pack tactics', () => {
  it('gives advantage when an able ally is next to the target', () => {
    // Two wolves on the guard: the attack roll is two d20s.
    const flanked = new Match(registry, arranged({ 'wolf-a': [8, 8], 'wolf-b': [8, 9] }), 1);
    turnOf(flanked, 'wolf-a');
    let from = flanked.log.length;
    take(flanked, 'attack', { target: 'guard' });
    flanked.advance();
    expect(d20s(flanked, from)).toBe(2);

    // One wolf alone: a single d20.
    const alone = new Match(registry, arranged({ 'wolf-a': [8, 8] }), 1);
    turnOf(alone, 'wolf-a');
    from = alone.log.length;
    take(alone, 'attack', { target: 'guard' });
    alone.advance();
    expect(d20s(alone, from)).toBe(1);
  });
});

describe('prone', () => {
  it('follows a wolf\'s bite, stops movement, and costs half of Speed to end', () => {
    const scenario = arranged({ 'wolf-a': [8, 8] });
    const match = findSeed((seed) => {
      const attempt = new Match(registry, scenario, seed);
      turnOf(attempt, 'wolf-a');
      take(attempt, 'attack', { target: 'guard' });
      attempt.advance();
      const prone = readState(registry, scenario, attempt.state, "all.creature.filter(c, c.id == 'guard').first().prone");
      return prone === true && attempt.state.entities.guard.fields.defeated === false ? attempt : undefined;
    });
    const turn = turnOf(match, 'guard');
    const intents = new Set(turn.options.map((option) => option.intent));
    expect(intents.has('standUp')).toBe(true);
    expect(intents.has('move')).toBe(false);
    take(match, 'standUp');
    const after = match.advance()!;
    expect(match.state.entities.guard.fields.movement).toBe(15);
    expect(after.options.some((option) => option.intent === 'move')).toBe(true);
    expect(Object.values(match.state.entities).some((entity) => entity.kind === 'effect' && entity.fields.condition === 'prone')).toBe(false);
  });
});

describe('nimble escape', () => {
  const scenario = arranged({ 'goblin-a': [8, 6] }); // next to the tough at 7,6

  it('lets a goblin leave an enemy\'s reach without an opportunity attack', () => {
    const match = new Match(registry, scenario, 1);
    turnOf(match, 'goblin-a');
    take(match, 'nimbleEscape');
    take(match, 'move', { to: { x: 9, y: 6 } });
    // Nobody is asked for a reaction: the goblin moves on.
    expect(match.advance()!.seat).toBe('goblins');
    expect(match.state.entities['goblin-a'].fields).toMatchObject({ pos: { x: 9, y: 6 }, bonus: 0, disengaged: true, action: 1 });
  });

  it('is what saves it: without it, the tough gets a swing', () => {
    const match = new Match(registry, scenario, 1);
    turnOf(match, 'goblin-a');
    take(match, 'move', { to: { x: 9, y: 6 } });
    const reaction = match.advance()!;
    expect(reaction.seat).toBe('vanguard');
    expect(reaction.options.map((option) => option.intent)).toEqual(['opportunityAttack', 'holdReaction']);
  });

  it('is not open to a creature without the trait', () => {
    const match = new Match(registry, scenario, 1);
    const turn = turnOf(match, 'tough');
    expect(turn.options.some((option) => option.intent === 'nimbleEscape')).toBe(false);
    expect(turn.options.some((option) => option.intent === 'disengage')).toBe(true);
  });
});

describe('advantage', () => {
  it('adds a goblin\'s extra damage die, and comes from attacking a prone creature up close', () => {
    const scenario = arranged({ 'goblin-a': [8, 6] });
    const match = findSeed((seed) => {
      const attempt = new Match(registry, scenario, seed);
      turnOf(attempt, 'goblin-a');
      // The referee knocks the tough down.
      attempt.author('referee', [
        { create: { id: 'down', kind: 'effect', fields: { condition: 'prone', source: 'goblin-a' } } },
        { link: { rel: 'affects', from: 'down', to: 'tough' } },
      ]);
      const from = attempt.log.length;
      take(attempt, 'attack', { weapon: 'scimitar', target: 'tough' });
      attempt.advance();
      expect(d20s(attempt, from)).toBe(2);
      return attempt.log.slice(from).some((event) => event.t === 'signal' && event.name === 'attack.hit') ? { attempt, from } : undefined;
    });
    const rolls = match.attempt.log.slice(match.from).filter((event) => event.t === 'roll').map((event) => (event as any).d);
    // Two d20s, the scimitar's d6, and the extra d4.
    expect(rolls).toEqual([20, 20, 6, 4]);
  });
});

describe('behaviors', () => {
  const best = (match: Match, behavior: string) => {
    const decision = match.advance()!;
    const scores = match.scores(behavior, decision.seat, decision.options);
    return { option: decision.options[scores.indexOf(Math.max(...scores))], scores, decision };
  };

  it('has the medic heal a bloodied ally before anything else', () => {
    const match = new Match(registry, shipped, 1);
    turnOf(match, 'acolyte');
    expect(best(match, 'medic').option.intent).not.toBe('cast');
    match.author('referee', [{ set: { id: 'tough', field: 'hp', value: 5 } }]);
    expect(best(match, 'medic').option).toEqual({ intent: 'cast', params: { actor: 'acolyte', spell: 'healing-word', slot: 1, target: 'tough' } });
    take(match, 'cast', { spell: 'healing-word', target: 'tough' });
    match.advance();
    // 2d4 + 2, as a Bonus Action: the action is still there for Sacred Flame.
    expect(match.state.entities.tough.fields.hp).toBeGreaterThanOrEqual(9);
    expect(match.state.entities.acolyte.fields).toMatchObject({ bonus: 0, action: 1, slots: { 1: 1 } });
  });

  it('has the defender advance, but not far from the ally it guards', () => {
    const match = new Match(registry, shipped, 1);
    turnOf(match, 'guard');
    // The acolyte, at 5,8, has the fewest hit points. The guard starts 10 feet from it.
    const score = (to: { x: number; y: number }) => {
      const { decision, scores } = best(match, 'defender');
      return scores[decision.options.findIndex((option) => option.intent === 'move' && JSON.stringify(option.params.to) === JSON.stringify(to))];
    };
    expect(score({ x: 8, y: 8 })).toBeGreaterThan(0); // 15 feet away: fine
    take(match, 'move', { to: { x: 8, y: 8 } });
    expect(score({ x: 9, y: 8 })).toBe(0); // 20 feet away: the goal holds it back
    expect(score({ x: 8, y: 7 })).not.toBeGreaterThan(0);
  });

  it('has the pack go for whoever is down', () => {
    const match = new Match(registry, arranged({ 'wolf-a': [6, 7] }), 1); // next to the tough, the guard, and the acolyte
    turnOf(match, 'wolf-a');
    match.author('referee', [
      { create: { id: 'down', kind: 'effect', fields: { condition: 'prone', source: 'wolf-a' } } },
      { link: { rel: 'affects', from: 'down', to: 'tough' } },
    ]);
    expect(best(match, 'packHunter').option).toMatchObject({ intent: 'attack', params: { target: 'tough' } });
  });
});

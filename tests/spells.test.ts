// Spellcasting in the 5e slice, played as the mage duel: slots, reactions
// that answer a spell or a hit while it is in flight, saving throws, lasting
// effects, concentration, and damage types.

import { describe, expect, it } from 'vitest';
import { Match, type GameEvent } from '../src/index.ts';
import { loadRuleset, readYaml } from '../src/load.ts';
import { choose, findSeed, loadScenario, read as readState, until } from './helpers.ts';

const registry = loadRuleset('dnd-5e-2024-slice');
const doc = (): any => readYaml('rulesets/dnd-5e-2024-slice/scenarios/mage-duel.yaml');
/** The duel as shipped: 105 feet apart, out of reach of a counterspell. */
const far = loadScenario(registry, doc());
/** The duellists 40 feet apart, or wherever `rime` is put. */
const close = (rime: [number, number] = [18, 6]) => {
  const d = doc();
  d.entities[0].fields.pos = [10, 6];
  d.entities[1].fields.pos = rime;
  return loadScenario(registry, d);
};
const near = close();

const fields = (match: Match, id: string) => match.state.entities[id].fields as Record<string, any>;
const read = (match: Match, scenario: typeof far, id: string, member: string) =>
  readState(registry, scenario, match.state, `all.creature.filter(c, c.id == '${id}').first().${member}`);
const signals = (match: Match, name: string, from = 0) =>
  match.log.filter((event): event is Extract<GameEvent, { t: 'signal' }> => event.t === 'signal' && event.name === name && event.seq >= from);
const lost = (match: Match, id: string, from = 0) =>
  signals(match, 'hp.lose', from).filter((event) => event.args.target === id).reduce((sum, event) => sum + (event.args.amount as number), 0);
/** Whether `seat` is asked next and may choose `intent`. */
const asked = (match: Match, seat: string, intent: string) => {
  const decision = match.advance();
  return !!decision && decision.seat === seat && decision.options.some((option) => option.intent === intent);
};

describe('slots', () => {
  it('offers each spell at every slot level that can power it', () => {
    const match = new Match(registry, near, 1);
    until(match, 'ember', 'cast');
    const options = match.advance()!.options;
    const levels = (spell: string) => options.filter((option) => option.params.spell === spell).map((option) => option.params.slot);
    expect(levels('fire-bolt')).toEqual([0]);
    expect(levels('magic-missile')).toEqual([1, 2, 3]);
    expect(levels('scorching-ray')).toEqual([2, 3]);
    expect(new Set(levels('fireball'))).toEqual(new Set([3]));
    // A teleport gains nothing from a bigger slot, so it takes the smallest.
    expect(new Set(levels('misty-step'))).toEqual(new Set([2]));
    // Reaction spells are not cast on a turn.
    expect(levels('shield')).toEqual([]);
    expect(levels('counterspell')).toEqual([]);
  });

  it('aims a burst at any square in range that would catch someone', () => {
    const match = new Match(registry, near, 1);
    until(match, 'ember', 'castAt');
    const points = match.advance()!.options.filter((option) => option.intent === 'castAt').map((option) => option.params.at as { x: number; y: number });
    const reach = (a: { x: number; y: number }, b: number[]) => Math.max(Math.abs(a.x - b[0]), Math.abs(a.y - b[1])) * 5;
    expect(points.length).toBeGreaterThan(50);
    for (const point of points) expect(Math.min(reach(point, [10, 6]), reach(point, [18, 6]))).toBeLessThanOrEqual(20);
    expect(points).toContainEqual({ x: 18, y: 6 });
  });

  it('spends the slot, and allows only one slot a turn', () => {
    const match = new Match(registry, near, 1);
    until(match, 'ember', 'castStep');
    choose(match, 'ember', 'castStep', { to: { x: 10, y: 5 } });
    choose(match, 'rime', 'holdReaction');
    const next = match.advance()!;
    expect(next.seat).toBe('ember');
    expect(fields(match, 'ember')).toMatchObject({ pos: { x: 10, y: 5 }, bonus: 0, slotSpent: true, slots: { 1: 4, 2: 2, 3: 2 } });
    // Only cantrips are left this turn.
    expect(next.options.filter((option) => option.intent === 'cast').map((option) => option.params.slot)).toEqual([0]);
    expect(next.options.some((option) => option.intent === 'castAt')).toBe(false);
    // The limit lifts when the next turn starts.
    until(match, 'rime', 'cast');
    expect(fields(match, 'ember').slotSpent).toBe(false);
  });
});

describe('counterspell', () => {
  /** Ember throws a fireball at Rime, who counters it. Returns the match if Ember's save went the way asked. */
  const countered = (saved: boolean) => findSeed((seed) => {
    const match = new Match(registry, near, seed);
    until(match, 'ember', 'castAt');
    choose(match, 'ember', 'castAt', { at: { x: 18, y: 6 } });
    choose(match, 'rime', 'counterspell');
    match.advance();
    const save = signals(match, 'save.rolled').find((event) => event.args.creature === 'ember' && event.args.ability === 'con');
    return save && save.args.saved === saved ? match : undefined;
  });

  it('stops the spell: the action is lost, and the slot is not', () => {
    const match = countered(false);
    expect(signals(match, 'spell.countered')).toHaveLength(1);
    expect(lost(match, 'rime')).toBe(0);
    expect(fields(match, 'ember')).toMatchObject({ action: 0, slotSpent: false, slots: { 1: 4, 2: 3, 3: 2 } });
    expect(fields(match, 'rime')).toMatchObject({ reaction: 0, slots: { 1: 4, 2: 3, 3: 1 } });
    // Nothing is left in flight.
    expect(Object.values(match.state.entities).some((entity) => entity.kind === 'casting' || entity.kind === 'wound')).toBe(false);
  });

  it('fails if the caster makes the save: the spell lands and both slots are gone', () => {
    const match = countered(true);
    expect(signals(match, 'spell.countered')).toHaveLength(0);
    expect(lost(match, 'rime')).toBeGreaterThan(0);
    expect(fields(match, 'ember').slots).toEqual({ 1: 4, 2: 3, 3: 1 });
    expect(fields(match, 'rime').slots).toEqual({ 1: 4, 2: 3, 3: 1 });
  });

  it('is not on offer from more than 60 feet', () => {
    const match = new Match(registry, far, 1);
    until(match, 'ember', 'castAt');
    choose(match, 'ember', 'castAt', { at: { x: 28, y: 6 } });
    // Rime is not asked: the next decision is Ember's again.
    expect(match.advance()!.seat).toBe('ember');
    expect(lost(match, 'rime')).toBeGreaterThan(0);
  });

  it('cannot be answered by a caster who has already used a slot this turn', () => {
    const match = countered(false);
    // Ember was casting with a slot, so was never asked to counter the counterspell.
    const reactions = match.log.filter((event) => event.t === 'intent' && event.seat === 'ember' && event.intent !== 'castAt' && event.intent !== 'move' && event.intent !== 'endTurn');
    expect(reactions.filter((event) => event.t === 'intent' && (event.intent === 'counterspell' || event.intent === 'holdReaction'))).toEqual([]);
  });
});

describe('shield', () => {
  /** Rime hits Ember with a ray of frost, by a margin a shield would cover. Stops at Ember's decision. */
  const hit = () => findSeed((seed) => {
    const match = new Match(registry, near, seed);
    until(match, 'rime', 'cast');
    choose(match, 'rime', 'cast', { spell: 'ray-of-frost' });
    choose(match, 'ember', 'holdReaction'); // Ember lets the cantrip be cast
    if (!asked(match, 'ember', 'castWard')) return undefined;
    const total = match.advance()!.options.find((option) => option.intent === 'castWard')!.params.total as number;
    return total >= 15 && total < 20 ? match : undefined;
  });

  it('turns a hit into a miss, and lasts until the caster\'s next turn', () => {
    const match = hit();
    choose(match, 'ember', 'castWard');
    // Shield is a spell like any other: Rime could counter it, and lets it be.
    choose(match, 'rime', 'holdReaction');
    match.advance();
    expect(lost(match, 'ember')).toBe(0);
    expect(read(match, near, 'ember', 'armorClass')).toBe(20);
    expect(fields(match, 'ember')).toMatchObject({ reaction: 0, slots: { 1: 3, 2: 3, 3: 2 } });
    until(match, 'ember', 'endTurn');
    expect(read(match, near, 'ember', 'armorClass')).toBe(15);
    expect(Object.values(match.state.entities).some((entity) => entity.kind === 'effect')).toBe(false);
  });

  it('can be declined, and then the hit lands', () => {
    const match = hit();
    choose(match, 'ember', 'holdReaction');
    match.advance();
    expect(lost(match, 'ember')).toBeGreaterThan(0);
    expect(fields(match, 'ember').slots).toEqual({ 1: 4, 2: 3, 3: 2 });
  });

  it('stops magic missile, which otherwise cannot miss', () => {
    const cast = () => {
      const match = new Match(registry, near, 3);
      until(match, 'rime', 'cast');
      choose(match, 'rime', 'cast', { spell: 'magic-missile', slot: 1 });
      choose(match, 'ember', 'holdReaction'); // no counterspell
      expect(match.advance()!.options.find((option) => option.intent === 'castWard')!.params.total).toBe(0);
      return match;
    };
    const warded = cast();
    choose(warded, 'ember', 'castWard');
    warded.advance();
    expect(lost(warded, 'ember')).toBe(0);
    expect(fields(warded, 'rime').slots).toEqual({ 1: 3, 2: 3, 3: 2 });

    const open = cast();
    const from = open.log.length;
    choose(open, 'ember', 'holdReaction');
    open.advance();
    // Three darts of 1d4 + 1 each, and no attack roll.
    expect(lost(open, 'ember')).toBeGreaterThanOrEqual(6);
    expect(lost(open, 'ember')).toBeLessThanOrEqual(15);
    expect(open.log.slice(from).some((event) => event.t === 'roll' && event.d === 20)).toBe(false);
  });
});

describe('lasting effects', () => {
  /** Rime casts Hold Person on Ember, and Ember fails the save. Stops at Rime's next decision. */
  const held = (seed: number) => {
    const match = new Match(registry, near, seed);
    until(match, 'rime', 'cast');
    choose(match, 'rime', 'cast', { spell: 'hold-person', slot: 2 });
    choose(match, 'ember', 'holdReaction');
    match.advance();
    return read(match, near, 'ember', 'paralyzed') === true ? match : undefined;
  };

  it('paralyzes on a failed save: the creature has a turn but no choices, and saves again at the end of it', () => {
    const match = findSeed(held);
    expect(read(match, near, 'ember', 'able')).toBe(false);
    expect(read(match, near, 'rime', 'concentrating')).toBe(true);
    const from = match.log.length;
    until(match, 'rime', 'endTurn');
    choose(match, 'rime', 'endTurn');
    until(match, 'rime', 'cast');
    const turn = match.log.slice(from);
    // Ember's turn came and went without a decision, but with a save.
    expect(turn.some((event) => event.t === 'signal' && event.name === 'turn.start' && event.args.actor === 'ember')).toBe(true);
    expect(turn.some((event) => event.t === 'intent' && event.seat === 'ember')).toBe(false);
    expect(turn.some((event) => event.t === 'signal' && event.name === 'save.rolled' && event.args.creature === 'ember' && event.args.ability === 'wis')).toBe(true);
    // It began the turn paralyzed, so it had no movement, whether or not the save then freed it.
    expect(fields(match, 'ember').movement).toBe(0);
  });

  it('ends when damage breaks the caster\'s concentration', () => {
    const match = findSeed((seed) => {
      const paralyzed = held(seed);
      if (!paralyzed) return undefined;
      // The referee rules that Ember's familiar sets off a wand: magic missile, out of turn.
      paralyzed.adjudicate('referee', 'ember', 'cast', { actor: 'ember', spell: 'magic-missile', slot: 1, target: 'rime' });
      paralyzed.advance();
      const save = signals(paralyzed, 'save.rolled').find((event) => event.args.creature === 'rime' && event.args.ability === 'con');
      return save && save.args.saved === false ? paralyzed : undefined;
    });
    // Half the damage or 10, whichever is more, is the DC.
    expect(signals(match, 'save.rolled').find((event) => event.args.creature === 'rime')!.args.dc).toBe(10);
    expect(read(match, near, 'ember', 'paralyzed')).toBe(false);
    expect(read(match, near, 'rime', 'concentrating')).toBe(false);
  });

  it('slows a creature hit by a ray of frost until the caster\'s next turn', () => {
    const match = findSeed((seed) => {
      const attempt = new Match(registry, near, seed);
      until(attempt, 'rime', 'cast');
      choose(attempt, 'rime', 'cast', { spell: 'ray-of-frost' });
      choose(attempt, 'ember', 'holdReaction');
      if (asked(attempt, 'ember', 'castWard')) choose(attempt, 'ember', 'holdReaction');
      attempt.advance();
      return read(attempt, near, 'ember', 'speedNow') === 20 ? attempt : undefined;
    });
    until(match, 'ember', 'endTurn');
    expect(fields(match, 'ember').movement).toBe(20);
    until(match, 'rime', 'cast');
    expect(read(match, near, 'ember', 'speedNow')).toBe(30);
  });
});

describe('damage', () => {
  it('is halved by resistance, while it is still in flight', () => {
    const match = findSeed((seed) => {
      const attempt = new Match(registry, far, seed);
      until(attempt, 'ember', 'cast');
      choose(attempt, 'ember', 'cast', { spell: 'fire-bolt' });
      if (asked(attempt, 'rime', 'castWard')) choose(attempt, 'rime', 'holdReaction');
      attempt.advance();
      return lost(attempt, 'rime') > 0 ? attempt : undefined;
    });
    const wound = match.log.find((event) => event.t === 'create' && event.kind === 'wound')!;
    const rolled = (wound as Extract<GameEvent, { t: 'create' }>).fields.amount as number;
    expect(match.log.find((event) => event.t === 'set' && event.id === (wound as any).id)).toMatchObject({ field: 'amount', value: Math.floor(rolled / 2) });
    expect(lost(match, 'rime')).toBe(Math.floor(rolled / 2));
    expect(match.log.some((event) => event.t === 'destroy' && event.id === (wound as any).id)).toBe(true);
  });

  it('from a burst reaches everyone inside it, the caster included', () => {
    const adjacent = close([11, 6]);
    const match = new Match(registry, adjacent, 1);
    until(match, 'ember', 'castAt');
    choose(match, 'ember', 'castAt', { at: { x: 10, y: 6 } });
    choose(match, 'rime', 'holdReaction');
    match.advance();
    expect(lost(match, 'ember')).toBeGreaterThan(0);
    expect(lost(match, 'rime')).toBeGreaterThan(0);
    // One damage roll for both: Rime resists fire, so never takes more than Ember could have.
    expect(signals(match, 'save.rolled').map((event) => event.args.creature).sort()).toEqual(['ember', 'rime']);
    expect(match.log.filter((event) => event.t === 'roll' && event.d === 6)).toHaveLength(1);
  });
});

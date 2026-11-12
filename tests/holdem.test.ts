// Texas Hold 'Em: hand ranking written as derived values, betting rounds as
// a flow, side pots, and hole cards that only their owner sees.

import { describe, expect, it } from 'vitest';
import { compileBehaviors, fold, Match } from '../src/index.ts';
import { viewOf } from '../src/runtime/session.ts';
import { loadRuleset, loadScenarioFile, readYaml } from '../src/load.ts';
import { choose, loadScenario, play, read as readState } from './helpers.ts';

const registry = loadRuleset('holdem');
const scenario = loadScenarioFile(registry, 'holdem', 'four-handed');
const scenarioDoc = (): any => readYaml('rulesets/holdem/scenarios/four-handed.yaml');

/** `As` is the ace of spades: rank is `c / 4 + 2`, suit is `c % 4`. */
const card = (name: string): number => ('23456789TJQKA'.indexOf(name[0])) * 4 + 'cdhs'.indexOf(name[1]);
const cards = (names: string): number[] => names.split(' ').map(card);

/** The category, tie-breakers, and number of the best hand from two hole cards and a board. */
const rank = (hole: string, board: string) => {
  const doc = scenarioDoc();
  doc.game = { ...doc.game, board: cards(board), street: 'showdown' };
  doc.entities[0].fields.hole = cards(hole);
  const loaded = loadScenario(registry, doc);
  const match = new Match(registry, loaded, 1);
  const of = (member: string) => readState(registry, loaded, match.state, `all.player.filter(p, p.id == 'p-north').first().${member}`);
  return { category: of('category'), kickers: of('kickers'), hand: of('hand') as number, name: readState(registry, loaded, match.state, `tables.category[all.player.filter(p, p.id == 'p-north').first().category]`) };
};

describe('hand ranking', () => {
  it.each([
    ['As Ks', 'Qs Js Ts 2h 3d', 'straight flush', [14, 0, 0, 0, 0]],
    ['As 2s', '3s 4s 5s Kh Kd', 'straight flush', [5, 0, 0, 0, 0]], // the ace plays low
    ['9c 9d', '9h 9s Kc Qd 2h', 'four of a kind', [9, 13, 0, 0, 0]],
    ['Ac Ad', 'Ah Kc Kd Ks 2h', 'full house', [14, 13, 0, 0, 0]], // two sets of three: aces full of kings
    ['Ah 9h', '7h 4h 2h Kh 3c', 'flush', [14, 13, 9, 7, 4]], // six hearts: the best five count
    ['9c 8d', '7h 6s 5c Kd Kh', 'straight', [9, 0, 0, 0, 0]],
    ['Ac 2d', '3h 4s 5c 9d Jh', 'straight', [5, 0, 0, 0, 0]],
    ['Qc Qd', 'Qh 7s 4c 9d 2h', 'three of a kind', [12, 9, 7, 0, 0]],
    ['Ac Ad', 'Kh Ks 2c 2d Qh', 'two pair', [14, 13, 12, 0, 0]], // three pairs: the queen outkicks the twos
    ['Jc Jd', 'Ah 7s 4c 9d 2h', 'pair', [11, 14, 9, 7, 0]],
    ['Kc Jd', 'Ah 7s 4c 9d 2h', 'high card', [14, 13, 11, 9, 7]],
  ])('reads %s on %s as a %s', (hole, board, name, kickers) => {
    const got = rank(hole, board);
    expect(got.name).toBe(name);
    expect(got.kickers).toEqual(kickers);
  });

  it('orders hands by category, then by tie-breakers', () => {
    const order = [
      rank('Kc Jd', 'Ah 7s 4c 9d 2h'), // ace high
      rank('Jc Jd', 'Kh 7s 4c 9d 2h'), // pair of jacks, king kicker
      rank('Jc Jd', 'Ah 7s 4c 9d 2h'), // pair of jacks, ace kicker
      rank('Ac 2d', '3h 4s 5c 9d Jh'), // five-high straight
      rank('9c 8d', '7h 6s 5c Kd Kh'), // nine-high straight
      rank('As Ks', 'Qs Js Ts 2h 3d'), // royal flush
    ].map((got) => got.hand);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
    // The same five cards from different hole cards tie.
    expect(rank('2c 3d', 'Ah Ks Qc Jd Th').hand).toBe(rank('4c 5d', 'Ah Ks Qc Jd Th').hand);
  });
});

describe('a hand', () => {
  const fields = (match: Match, id: string) => match.state.entities[id].fields;

  it('posts the blinds, deals two cards each, and starts left of the big blind', () => {
    const match = new Match(registry, scenario, 1);
    const first = match.advance()!;
    // The button is on chair 0, so chairs 1 and 2 post, and chair 3 acts first.
    expect(match.state.game).toMatchObject({ hand: 1, button: 0, street: 'preflop', bet: 20, minRaise: 20 });
    expect(fields(match, 'p-east')).toMatchObject({ chips: 990, staked: 10 });
    expect(fields(match, 'p-south')).toMatchObject({ chips: 980, staked: 20 });
    expect(first.seat).toBe('west');
    const dealt = ['p-north', 'p-east', 'p-south', 'p-west'].flatMap((id) => fields(match, id).hole as number[]);
    expect(new Set(dealt).size).toBe(8);
    expect((match.state.game.deck as number[]).length).toBe(44);
    expect(first.options.map((option) => option.intent)).toEqual(['fold', 'call', 'raise', 'raise', 'raise', 'raise']);
    // The minimum raise, half the pot, the pot, and all in.
    expect(first.options.filter((option) => option.intent === 'raise').map((option) => option.params.to)).toEqual([40, 45, 70, 1000]);
  });

  it('gives the big blind the last word, and makes the next raise at least as big as the last', () => {
    const match = new Match(registry, scenario, 1);
    choose(match, 'west', 'call');
    choose(match, 'north', 'raise', { to: 90 }); // the pot: a raise of 70
    const east = match.advance()!;
    expect(east.seat).toBe('east');
    expect(Math.min(...east.options.filter((option) => option.intent === 'raise').map((option) => option.params.to as number))).toBe(160);
    choose(match, 'east', 'fold');
    choose(match, 'south', 'call');
    // West called before the raise, so west is asked again. That closes the betting.
    choose(match, 'west', 'call');
    match.advance();
    expect(match.state.game.street).toBe('flop');
    expect((match.state.game.board as number[]).length).toBe(3);
    // After the flop, play starts on the button's left with a fresh bet.
    expect(match.advance()!.seat).toBe('south');
    expect(match.state.game.bet).toBe(0);
  });

  it('lets the big blind check or raise when everyone just calls', () => {
    const match = new Match(registry, scenario, 1);
    choose(match, 'west', 'call');
    choose(match, 'north', 'call');
    choose(match, 'east', 'call');
    const south = match.advance()!;
    expect(south.seat).toBe('south');
    expect(south.options.map((option) => option.intent)).toContain('check');
    expect(south.options.map((option) => option.intent)).toContain('raise');
    expect(match.state.game.street).toBe('preflop');
  });

  it('gives the pot to the last player in without a showdown, and moves the button', () => {
    const match = new Match(registry, scenario, 1);
    choose(match, 'west', 'fold');
    choose(match, 'north', 'fold');
    choose(match, 'east', 'fold');
    match.advance();
    expect(match.log.some((event) => event.t === 'global' && event.field === 'street' && event.value === 'showdown')).toBe(false);
    expect(match.log.find((event) => event.t === 'signal' && event.name === 'pot.win')).toMatchObject({ args: { player: 'p-south', amount: 30 } });
    expect(match.state.game).toMatchObject({ hand: 2, button: 1 });
    expect((fields(match, 'p-south').chips as number) + (fields(match, 'p-south').committed as number)).toBe(1010);
  });
});

describe('hidden cards', () => {
  it('shows a seat its own hole cards and nobody else\'s, and never the deck', () => {
    const match = new Match(registry, scenario, 1);
    match.advance();
    const west = match.view('west');
    expect((west.entities['p-west'].fields.hole as number[]).length).toBe(2);
    for (const other of ['p-north', 'p-east', 'p-south']) expect('hole' in west.entities[other].fields).toBe(false);
    expect('deck' in west.game).toBe(false);
    expect(west.entities['p-east'].fields.chips).toBe(990);
  });

  it('turns the cards of those still in face up at a showdown', () => {
    // Everyone calls every street, so the first hand is shown down.
    const match = new Match(registry, scenario, 2);
    for (let decision = match.advance(); decision && match.state.game.hand === 1; decision = match.advance()) {
      match.submit(decision.options.findIndex((option) => option.intent === 'call' || option.intent === 'check'));
    }
    const reveal = match.log.findIndex((event) => event.t === 'global' && event.field === 'street' && event.value === 'showdown');
    expect(reveal).toBeGreaterThan(0);
    // The state just before the showdown, and at it, as west sees them.
    const before = viewOf(registry, fold(match.log.slice(0, reveal)), scenario.world, 'west');
    const at = viewOf(registry, fold(match.log.slice(0, reveal + 1)), scenario.world, 'west');
    expect('hole' in before.entities['p-north'].fields).toBe(false);
    for (const id of ['p-north', 'p-east', 'p-south', 'p-west']) expect((at.entities[id].fields.hole as number[]).length).toBe(2);
    expect('deck' in at.game).toBe(false);
  });

  it('will not score a behavior that reads another player\'s cards', () => {
    const cheat = {
      format: 2, behaviorSet: { id: 'cheat' }, ruleset: { id: 'holdem', version: '0.2.0' },
      behaviors: { cheat: { scores: { call: 'all.player.map(p, p.strength).max()' } } },
    };
    const { byName } = compileBehaviors(registry, [readYaml('rulesets/holdem/behaviors/default.yaml'), cheat]);
    const match = new Match(registry, loadScenario(registry, scenarioDoc()), 1);
    const decision = match.advance()!;
    expect(() => match.scores(byName.get('cheat')!, decision.seat, decision.options)).toThrow(/player\.hole of "p-(north|east|south)" is hidden from seat "west"/);
    expect(() => match.scores(byName.get('shark')!, decision.seat, decision.options)).not.toThrow();
  });
});

describe('all-in and side pots', () => {
  /** Three players with uneven stacks; the match ends after one hand. */
  const uneven = () => {
    const doc = scenarioDoc();
    doc.seats = { north: {}, east: {}, south: {} };
    doc.entities = [
      { id: 'short', kind: 'player', fields: { seat: 'north', chair: 0, chips: 100 } },
      { id: 'mid', kind: 'player', fields: { seat: 'east', chair: 1, chips: 300 } },
      { id: 'deep', kind: 'player', fields: { seat: 'south', chair: 2, chips: 900 } },
    ];
    doc.end = [{ when: "game.street == 'done' && game.hand >= 1", outcome: { result: "'one hand'" } }];
    return loadScenario(registry, doc);
  };

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('pays each layer of the pot to the best hand that paid into it (seed %i)', (seed) => {
    const loaded = uneven();
    const match = new Match(registry, loaded, seed);
    // Button is `short`; `mid` and `deep` post. Everyone goes all in.
    choose(match, 'north', 'raise', { to: 100 });
    choose(match, 'east', 'raise', { to: 300 });
    choose(match, 'south', 'call');
    expect(match.advance()).toBeNull();
    const chips = (id: string) => match.state.entities[id].fields.chips as number;
    const hand = (id: string) => readState(registry, loaded, match.state, `all.player.filter(p, p.id == '${id}').first().hand`) as number;
    expect(chips('short') + chips('mid') + chips('deep')).toBe(1300);
    expect(match.violations()).toEqual([]);
    // The deep stack's 600 that nobody could call never leaves it.
    expect(chips('deep')).toBeGreaterThanOrEqual(600);

    const main = [hand('short'), hand('mid'), hand('deep')];
    const side = [hand('mid'), hand('deep')];
    const share = (pot: number, hands: number[], mine: number) => {
      const winners = hands.filter((h) => h === Math.max(...hands)).length;
      return mine === Math.max(...hands) ? Math.floor(pot / winners) : 0;
    };
    // The main pot is 100 from each; the side pot is 200 more from the two bigger stacks.
    expect(chips('short')).toBe(share(300, main, hand('short')));
    expect(chips('mid')).toBe(share(300, main, hand('mid')) + share(400, side, hand('mid')));
    expect(chips('deep')).toBe(600 + share(300, main, hand('deep')) + share(400, side, hand('deep')));
  });

  it('does not let a short all-in reopen the betting', () => {
    const doc = scenarioDoc();
    doc.entities[1].fields.chips = 55; // east, the small blind
    const match = new Match(registry, loadScenario(registry, doc), 1);
    choose(match, 'west', 'raise', { to: 40 }); // the minimum raise
    choose(match, 'north', 'call');
    // East shoves for 55: 15 more than the bet, less than a full raise of 20.
    choose(match, 'east', 'raise', { to: 55 });
    choose(match, 'south', 'call');
    // West and north have acted since the last full raise: they may call or fold, but not raise again.
    const west = match.advance()!;
    expect(west.seat).toBe('west');
    expect(west.options.map((option) => option.intent)).toEqual(['fold', 'call']);
  });

  it('has the button post the small blind when two are left', () => {
    const doc = scenarioDoc();
    doc.entities[0].fields.chips = 0;
    doc.entities[1].fields.chips = 0;
    // An end condition would stop a match with one stack left, but two remain here.
    const match = new Match(registry, loadScenario(registry, doc), 1);
    const first = match.advance()!;
    expect(match.state.game.button).toBe(2);
    expect(match.state.entities['p-south'].fields).toMatchObject({ staked: 10, folded: false });
    expect(match.state.entities['p-west'].fields).toMatchObject({ staked: 20 });
    expect(match.state.entities['p-north'].fields).toMatchObject({ folded: true, hole: [] });
    // Before the flop the button acts first.
    expect(first.seat).toBe('south');
  });
});

describe('a whole match', () => {
  it.each([1, 2, 3, 4, 5, 6])('keeps every chip on the table (seed %i)', (seed) => {
    const { state, outcome, match } = play(registry, scenario, seed);
    const chips = Object.values(state.entities).map((entity) => entity.fields.chips as number);
    expect(chips.reduce((sum, value) => sum + value, 0)).toBe(4000);
    expect(['win', 'time']).toContain(outcome.result);
    if (outcome.result === 'win') expect(chips.filter((value) => value > 0)).toEqual([4000]);
    expect(match.violations()).toEqual([]);
  });
});

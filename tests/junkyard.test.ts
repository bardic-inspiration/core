// The junkyard: an open game. What a bot can do comes from the parts linked
// to it, state grows and shrinks during play, a referee authors scrap while
// the match runs, and the ruleset declares no winner.

import { describe, expect, it } from 'vitest';
import { Match, RuleError, type Decision } from '../src/index.ts';
import { loadRuleset, loadScenarioFile, readYaml } from '../src/load.ts';
import { compileWith, findSeed, loadScenario, play, read as readState, refusal } from './helpers.ts';

const registry = loadRuleset('junkyard');
const yard = loadScenarioFile(registry, 'junkyard', 'yard');

/** A small empty yard with the bots, parts, and piles a test names. Nothing falls from the sky. */
const bench = (entities: any[], links: any[] = [], game: Record<string, unknown> = {}) => loadScenario(registry, {
  format: 1, scenario: { id: 'bench' }, ruleset: { id: 'junkyard', version: '0.1.0' },
  seats: { rust: {}, chrome: {}, yardmaster: { referee: true } },
  space: { width: 6, height: 6 }, game: { dropEvery: 0, ...game }, entities, links,
});
const bot = (id: string, seat: string, pos: [number, number]) => ({ id, kind: 'bot', fields: { seat, pos } });
const part = (id: string, type: string, rating = 1) => ({ id, kind: 'part', fields: { type, rating } });
const mount = (from: string, to: string) => ({ rel: 'mounts', from, to });

/** Idles every bot until `id` is asked, and returns that decision. */
const turnOf = (match: Match, id: string): Decision => {
  for (let decision = match.advance(); decision; decision = match.advance()) {
    if (decision.options[0].params.bot === id) return decision;
    match.submit(decision.options.findIndex((option) => option.intent === 'idle'));
  }
  throw new Error(`the match ended before ${id} acted`);
};
const take = (match: Match, intent: string, want: Record<string, unknown> = {}) => {
  const decision = match.advance()!;
  const index = decision.options.findIndex((option) =>
    option.intent === intent && Object.entries(want).every(([name, value]) => JSON.stringify(option.params[name]) === JSON.stringify(value)));
  if (index < 0) throw new Error(`cannot ${intent} ${JSON.stringify(want)}; legal: ${JSON.stringify(decision.options)}`);
  match.submit(index);
};
const intents = (decision: Decision) => [...new Set(decision.options.map((option) => option.intent))].sort();
const stat = (scenario: typeof yard, match: Match, id: string, member: string) =>
  readState(registry, scenario, match.state, `all.bot.filter(b, b.id == '${id}').first().${member}`);

describe('what a bot can do comes from its parts', () => {
  it('can only idle as a bare frame', () => {
    const match = new Match(registry, bench([bot('a', 'rust', [1, 1]), bot('z', 'chrome', [2, 1])]), 1);
    expect(intents(turnOf(match, 'a'))).toEqual(['idle']);
  });

  it('moves with legs and strikes with arms', () => {
    const scenario = bench(
      [bot('a', 'rust', [1, 1]), bot('z', 'chrome', [2, 1]), part('leg', 'leg'), part('arm', 'arm', 2)],
      [mount('a', 'leg')],
    );
    const match = new Match(registry, scenario, 1);
    expect(intents(turnOf(match, 'a'))).toEqual(['idle', 'move']);
    // The referee bolts an arm on. The same bot can now strike its neighbour.
    match.author('yardmaster', [{ link: { rel: 'mounts', from: 'a', to: 'arm' } }]);
    expect(intents(match.advance()!)).toEqual(['idle', 'move', 'strike']);
    expect(stat(scenario, match, 'a', 'power')).toBe(2);
  });

  it('adds up arms, legs, cells, and panels, but counts only the thickest plate', () => {
    const scenario = bench(
      [bot('a', 'rust', [1, 1]), part('p1', 'plate', 1), part('p2', 'plate', 3), part('c', 'cell', 2), part('s', 'panel', 2)],
      [mount('a', 'p1'), mount('a', 'p2'), mount('a', 'c'), mount('a', 's')],
    );
    const match = new Match(registry, scenario, 1);
    expect(stat(scenario, match, 'a', 'armor')).toBe(3);
    expect(stat(scenario, match, 'a', 'chargeMax')).toBe(6);
    expect(stat(scenario, match, 'a', 'free')).toBe(0);
    // It starts with the charge of a bare frame, and gains 1 + its panels each tick.
    turnOf(match, 'a');
    expect(match.state.entities.a.fields.charge).toBe(5);
    take(match, 'idle');
    turnOf(match, 'a');
    expect(match.state.entities.a.fields.charge).toBe(6);
  });

  it('refuses a fifth part on a four-socket frame', () => {
    const parts = ['p1', 'p2', 'p3', 'p4', 'p5'];
    expect(refusal(() => bench([bot('a', 'rust', [1, 1]), ...parts.map((id) => part(id, 'leg'))], parts.map((id) => mount('a', id)))))
      .toMatch(/mounts holds at most self\.sockets/);
  });
});

describe('state grows and shrinks', () => {
  it('takes a part from a pile, and the empty pile is gone', () => {
    const scenario = bench(
      [bot('a', 'rust', [1, 1]), { id: 'heap', kind: 'pile', fields: { pos: [2, 2] } }, part('leg', 'leg')],
      [{ rel: 'holds', from: 'heap', to: 'leg' }],
    );
    const match = new Match(registry, scenario, 1);
    turnOf(match, 'a');
    take(match, 'salvage', { part: 'leg' });
    match.advance();
    expect(match.state.entities.heap).toBeUndefined();
    expect(match.state.links.mounts).toEqual([['a', 'leg']]);
    expect(stat(scenario, match, 'a', 'mobility')).toBe(1);
  });

  it('builds a new bot out of one of its own parts', () => {
    const scenario = bench(
      [bot('a', 'rust', [1, 1]), part('l1', 'leg'), part('l2', 'leg'), part('c', 'cell')],
      [mount('a', 'l1'), mount('a', 'l2'), mount('a', 'c')],
    );
    const match = new Match(registry, scenario, 1);
    turnOf(match, 'a');
    take(match, 'assemble', { part: 'l2', to: { x: 2, y: 1 } });
    const next = match.advance()!;
    const child = match.log.find((event) => event.t === 'signal' && event.name === 'bot.built')!;
    const id = (child as any).args.child as string;
    expect(match.state.entities[id]).toMatchObject({ kind: 'bot', fields: { seat: 'rust', pos: { x: 2, y: 1 }, born: 1 } });
    expect(match.state.links.mounts).toEqual([['a', 'l1'], ['a', 'c'], [id, 'l2']]);
    // The new bot waits for the next tick: the parent is the only one asked this tick.
    expect(next.options[0].params.bot).toBe('a');
    expect(match.state.game.tick).toBe(2);
    // Two parts left: the parent keeps them.
    expect(next.options.some((option) => option.intent === 'assemble')).toBe(false);
  });

  it('stops a swarm growing past its limit', () => {
    const scenario = bench(
      [bot('a', 'rust', [1, 1]), part('l1', 'leg'), part('l2', 'leg'), part('c', 'cell')],
      [mount('a', 'l1'), mount('a', 'l2'), mount('a', 'c')],
      { swarmLimit: 1 },
    );
    const match = new Match(registry, scenario, 1);
    expect(intents(turnOf(match, 'a'))).toEqual(['idle', 'move']);
  });

  it('breaks a wrecked bot down into a pile of its parts', () => {
    const scenario = bench(
      [bot('a', 'chrome', [1, 1]), bot('z', 'rust', [2, 1]), part('arm', 'arm', 3), part('cell', 'cell', 3), part('leg', 'leg'), part('plate', 'plate')],
      [mount('a', 'arm'), mount('a', 'cell'), mount('z', 'leg'), mount('z', 'plate')],
    );
    const match = findSeed((seed) => {
      const attempt = new Match(registry, scenario, seed);
      for (let i = 0; i < 12 && attempt.state.entities.z; i++) {
        const turn = turnOf(attempt, 'a');
        attempt.submit(Math.max(0, turn.options.findIndex((option) => option.intent === 'strike')));
        attempt.advance();
      }
      return attempt.state.entities.z ? undefined : attempt;
    });
    expect(match.log.some((event) => event.t === 'signal' && event.name === 'bot.wrecked')).toBe(true);
    const pile = Object.entries(match.state.entities).find(([, entity]) => entity.kind === 'pile')!;
    expect(pile[1].fields.pos).toEqual({ x: 2, y: 1 });
    expect(match.state.links.holds).toEqual([[pile[0], 'leg'], [pile[0], 'plate']]);
    // What was a bot is now scrap the winner can take.
    const turn = turnOf(match, 'a');
    expect(turn.options.filter((option) => option.intent === 'salvage').map((option) => option.params.part)).toEqual(['leg', 'plate']);
    expect(match.violations()).toEqual([]);
  });
});

describe('the yardmaster', () => {
  it('drops new scrap into a running match, and a bot picks it up', () => {
    const scenario = bench([bot('a', 'rust', [1, 1])]);
    const match = new Match(registry, scenario, 1);
    expect(intents(turnOf(match, 'a'))).toEqual(['idle']);
    match.author('yardmaster', [
      { create: { id: 'crate', kind: 'pile', fields: { pos: [1, 2] } } },
      { create: { id: 'gift', kind: 'part', fields: { type: 'leg', rating: 3 } } },
      { link: { rel: 'holds', from: 'crate', to: 'gift' } },
    ]);
    expect(intents(match.advance()!)).toEqual(['idle', 'salvage']);
    take(match, 'salvage', { part: 'gift' });
    expect(intents(turnOf(match, 'a'))).toEqual(['idle', 'move']);
    expect(match.log.filter((event) => event.by === 'yardmaster')).toHaveLength(3);
  });

  it('cannot author what the ruleset does not declare', () => {
    const match = new Match(registry, bench([bot('a', 'rust', [1, 1])]), 1);
    match.advance();
    const before = match.state;
    expect(() => match.author('yardmaster', [{ create: { kind: 'part', fields: { type: 'laser' } } }])).toThrow(/"laser" is not a valid partType/);
    expect(() => match.author('yardmaster', [{ create: { kind: 'part', fields: { type: 'arm', rating: 9 } } }])).toThrow(/a part is rated from 1 to 3/);
    expect(() => match.author('yardmaster', [{ create: { kind: 'bot', fields: { seat: 'rust', pos: [1, 1] } } }])).toThrow(/two bots cannot share a square/);
    expect(() => match.author('rust', [{ destroy: 'a' }])).toThrow(RuleError);
    expect(match.state).toBe(before);
  });

  it('can author a new kind of part once a layer declares it', () => {
    const extension = {
      format: 1, extension: { id: 'drills', version: '0.1.0' }, extends: { id: 'junkyard', version: '0.1.0' },
      enums: { partType: ['drill'] },
      intents: {
        dig: {
          doc: 'Dig a part out of the ground. Needs a drill.',
          params: { bot: 'bot' },
          gate: "bot.mounts.exists(p, p.type == 'drill') && bot.free > 0",
          effects: [
            { create: { kind: 'part', as: 'found', fields: { type: "'cell'" } } },
            { link: { rel: 'mounts', from: 'bot', to: 'found' } },
          ],
        },
      },
      menus: { act: ['dig'] },
    };
    const extended = compileWith(readYaml('rulesets/junkyard/ruleset.yaml'), [extension]);
    const scenario = loadScenario(extended, {
      format: 1, scenario: { id: 'dig' }, ruleset: { id: 'junkyard', version: '0.1.0' },
      seats: { rust: {}, yardmaster: { referee: true } }, space: { width: 4, height: 4 }, game: { dropEvery: 0 },
      entities: [bot('a', 'rust', [1, 1])],
    });
    const match = new Match(extended, scenario, 1);
    match.advance();
    match.author('yardmaster', [{ create: { id: 'bit', kind: 'part', fields: { type: 'drill' } } }, { link: { rel: 'mounts', from: 'a', to: 'bit' } }]);
    take(match, 'dig');
    match.advance();
    expect(match.state.links.mounts).toHaveLength(2);
    // The base ruleset still refuses it.
    expect(() => new Match(registry, bench([bot('a', 'rust', [1, 1])]), 1).author('yardmaster', [{ create: { kind: 'part', fields: { type: 'drill' } } }])).toThrow(/not a valid partType/);
  });
});

describe('the yard', () => {
  it.each([1, 2, 3])('runs for 60 ticks and ends in a census, not a win (seed %i)', (seed) => {
    const { outcome, state, log, match } = play(registry, yard, seed);
    expect(outcome.result).toBe('census');
    expect('winner' in outcome).toBe(false);
    expect(state.game.tick).toBe(61);
    expect(outcome.bots).toBe(Object.values(state.entities).filter((entity) => entity.kind === 'bot').length);
    expect((outcome.rust as number) + (outcome.moss as number) + (outcome.chrome as number)).toBe(outcome.bots);
    // Scrap fell from the sky, and bots were built: the state is bigger than it started.
    expect(log.filter((event) => event.t === 'create' && event.kind === 'bot').length).toBeGreaterThan(3);
    expect(outcome.parts as number).toBeGreaterThan(21);
    expect(match.violations()).toEqual([]);
  });

  it('never lets one seat run more bots than the limit', () => {
    const { log } = play(registry, yard, 2);
    const alive: Record<string, string> = {};
    let most = 0;
    for (const event of log) {
      if (event.t === 'create' && event.kind === 'bot') alive[event.id] = event.fields.seat as string;
      if (event.t === 'destroy') delete alive[event.id];
      for (const seat of ['rust', 'moss', 'chrome']) most = Math.max(most, Object.values(alive).filter((owner) => owner === seat).length);
    }
    expect(most).toBe(6);
  });
});

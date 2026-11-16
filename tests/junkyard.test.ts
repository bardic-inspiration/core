// The junkyard: an open game. Every part is one primitive, a machine can do
// what its working parts add up to, and it acts once it closes the loop of
// sensing, deciding, and acting. State grows and shrinks during play, a
// referee authors scrap while the match runs, and the ruleset declares no
// winner.

import { describe, expect, it } from 'vitest';
import { bindSeats, Match, RuleError, type Decision } from '../src/index.ts';
import { loadRuleset, loadScenarioFile, readYaml } from '../src/load.ts';
import { behaviorsFor, compileWith, findSeed, loadScenario, play, read as readState, refusal } from './helpers.ts';

const registry = loadRuleset('junkyard');
const yard = loadScenarioFile(registry, 'junkyard', 'yard');

/** The primitive behind each job, as the ruleset's `jobs` table has it, and one pair the table leaves out. */
const PRIMITIVES: Record<string, [string, string]> = {
  generator: ['energy', 'source'], battery: ['energy', 'store'], furnace: ['energy', 'converter'],
  legs: ['motion', 'source'], striker: ['motion', 'gate'], armor: ['motion', 'sink'],
  gripper: ['matter', 'gate'], welder: ['matter', 'converter'], frame: ['matter', 'conduit'],
  eye: ['signal', 'sensor'], brain: ['signal', 'gate'], radiator: ['heat', 'sink'], junk: ['heat', 'store'],
};
type Entity = { id: string; kind: string; fields: Record<string, unknown> };
type Link = { rel: string; from: string; to: string };
type Setup = { entities: Entity[]; links: Link[] };

const part = (id: string, job: string, fields: Record<string, unknown> = {}): Entity =>
  ({ id, kind: 'part', fields: { flow: PRIMITIVES[job][0], role: PRIMITIVES[job][1], ...fields } });
/** A machine with the parts given, each mounted on it. */
const machine = (id: string, seat: string, pos: [number, number], parts: Entity[] = [], gauge = 2): Setup => ({
  entities: [{ id, kind: 'machine', fields: { seat, pos, gauge } }, ...parts],
  links: parts.map((mounted) => ({ rel: 'mounts', from: id, to: mounted.id })),
});
/** A machine that closes the loop: an eye, a brain, legs enough for six parts, a gripper, and a generator. */
const robot = (id: string, seat: string, pos: [number, number], more: Entity[] = [], gauge = 2): Setup => machine(id, seat, pos, [
  part(`${id}-eye`, 'eye'), part(`${id}-brain`, 'brain'), part(`${id}-legs`, 'legs', { rate: 2 }),
  part(`${id}-grip`, 'gripper'), part(`${id}-panel`, 'generator'), ...more,
], gauge);
const pile = (id: string, pos: [number, number], parts: Entity[]): Setup => ({
  entities: [{ id, kind: 'pile', fields: { pos } }, ...parts],
  links: parts.map((held) => ({ rel: 'holds', from: id, to: held.id })),
});

/** A small empty yard with what a test names. Nothing falls from the sky. */
const bench = (setups: Setup[], game: Record<string, unknown> = {}, behavior?: string) => loadScenario(registry, {
  format: 2, scenario: { id: 'bench' }, ruleset: { id: 'junkyard', version: '0.3.0' },
  seats: { rust: behavior ? { behavior } : {}, chrome: behavior ? { behavior } : {}, yardmaster: { referee: true } },
  space: { width: 6, height: 6 }, game: { dropEvery: 0, ...game },
  entities: setups.flatMap((setup) => setup.entities), links: setups.flatMap((setup) => setup.links),
});

/** Idles every machine until `id` is asked, and returns that decision. */
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
type Loaded = ReturnType<typeof bench>;
const stat = (scenario: Loaded, match: Match, id: string, member: string) =>
  readState(registry, scenario, match.state, `all.machine.filter(m, m.id == '${id}').first().${member}`);
const jobOf = (scenario: Loaded, match: Match, id: string, rules = registry) =>
  readState(rules, scenario, match.state, `all.part.filter(p, p.id == '${id}').first().job`);
const signals = (match: Match, name: string) => match.log.filter((event) => event.t === 'signal' && event.name === name) as any[];
const mountsOf = (match: Match, id: string) => (match.state.links.mounts ?? []).filter(([from]) => from === id).map(([, to]) => to);

describe('a part is one primitive', () => {
  it('gets its job from the library, and a pair the library leaves out is junk', () => {
    const scenario = bench([robot('a', 'rust', [1, 1], [part('odd', 'junk')])]);
    const match = new Match(registry, scenario, 1);
    expect(jobOf(scenario, match, 'a-legs')).toBe('legs');
    expect(jobOf(scenario, match, 'a-brain')).toBe('brain');
    expect(jobOf(scenario, match, 'odd')).toBe('none');
    expect(stat(scenario, match, 'a', "does['none']")).toBe(1);
  });

  it('adds up what the working parts do, but counts only the thickest plate', () => {
    const scenario = bench([machine('a', 'rust', [1, 1], [
      part('l1', 'legs'), part('l2', 'legs', { rate: 3 }), part('p1', 'armor'), part('p2', 'armor', { rate: 3 }),
      part('c', 'battery', { rate: 2 }), part('dead', 'legs', { rate: 3, broken: true }),
    ], 3)]);
    const match = new Match(registry, scenario, 1);
    expect(stat(scenario, match, 'a', "does['legs']")).toBe(4);
    expect(stat(scenario, match, 'a', 'armor')).toBe(3);
    expect(stat(scenario, match, 'a', 'chargeMax')).toBe(6);
    expect(stat(scenario, match, 'a', 'free')).toBe(2);
  });

  it('refuses a part rated above the frame, and more parts than the frame has sockets', () => {
    expect(refusal(() => bench([machine('a', 'rust', [1, 1], [part('big', 'legs', { rate: 2 })], 1)])))
      .toMatch(/a part rated above the frame's gauge does not fit/);
    const five = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => part(id, 'legs'));
    expect(refusal(() => bench([machine('a', 'rust', [1, 1], five, 1)]))).toMatch(/mounts holds at most self\.sockets/);
  });
});

describe('a machine acts once it closes the loop', () => {
  it('is asked nothing as a shell, and wakes as the seat of whoever fits the last part', () => {
    const scenario = bench([
      robot('a', 'rust', [1, 1]),
      machine('z', 'chrome', [2, 1], [part('z-eye', 'eye'), part('z-grip', 'gripper'), part('z-panel', 'generator')], 1),
      pile('heap', [1, 2], [part('mind', 'brain')]),
    ]);
    const match = new Match(registry, scenario, 1);
    expect(stat(scenario, match, 'z', 'awake')).toBe(false);
    // Tick after tick, only the robot is asked.
    turnOf(match, 'a');
    take(match, 'idle');
    expect(match.advance()!.options[0].params.bot).toBe('a');
    take(match, 'attach', { part: 'mind', onto: 'z' });
    match.advance();
    expect(match.state.entities.heap).toBeUndefined();
    expect(signals(match, 'machine.woke').map((event) => event.args.machine)).toEqual(['z']);
    expect(match.state.entities.z.fields.seat).toBe('rust');
    expect(intents(turnOf(match, 'z'))).toEqual(['attach', 'drop', 'idle']);
    expect(match.violations()).toEqual([]);
  });

  it('offers only what its parts can do', () => {
    const scenario = bench([
      machine('a', 'rust', [1, 1], [part('eye', 'eye'), part('brain', 'brain'), part('legs', 'legs', { rate: 2 }), part('panel', 'generator')]),
      robot('z', 'chrome', [2, 1]),
      part('ram', 'striker') as unknown as Setup,
    ].map((setup) => ('entities' in setup ? setup : { entities: [setup as unknown as Entity], links: [] })));
    const match = new Match(registry, scenario, 1);
    expect(intents(turnOf(match, 'a'))).toEqual(['idle', 'move']);
    // The referee bolts a striker on. The same machine can now hit its neighbour.
    match.author('yardmaster', [{ link: { rel: 'mounts', from: 'a', to: 'ram' } }]);
    expect(intents(match.advance()!)).toEqual(['idle', 'move', 'strike']);
  });

  it('stays where it is when its legs cannot carry it', () => {
    const scenario = bench([machine('a', 'rust', [1, 1], [
      part('eye', 'eye'), part('brain', 'brain'), part('legs', 'legs'), part('grip', 'gripper'), part('panel', 'generator'),
    ])]);
    const match = new Match(registry, scenario, 1);
    // Five parts on one point of legs: awake, because it has a gripper, but not mobile.
    expect(intents(turnOf(match, 'a'))).toEqual(['drop', 'idle']);
    take(match, 'drop', { part: 'panel' });
    expect(intents(turnOf(match, 'a'))).toEqual(['attach', 'drop', 'idle', 'move']);
    const heap = Object.entries(match.state.entities).find(([, entity]) => entity.kind === 'pile')!;
    expect(heap[1].fields.pos).toEqual({ x: 1, y: 1 });
    expect(match.state.links.holds).toEqual([[heap[0], 'panel']]);
  });

  it('will not bolt on a part too big for the frame', () => {
    const scenario = bench([robot('a', 'rust', [1, 1]), pile('heap', [1, 2], [part('big', 'battery', { rate: 3 }), part('small', 'battery')])]);
    const match = new Match(registry, scenario, 1);
    const parts = turnOf(match, 'a').options.filter((option) => option.intent === 'attach').map((option) => option.params.part);
    expect(parts).toEqual(['small']);
  });
});

describe('machines make and unmake machines', () => {
  it('sets a frame down as a shell of its gauge', () => {
    const scenario = bench([robot('a', 'rust', [1, 1]), pile('heap', [1, 2], [part('rack', 'frame', { rate: 3 })])]);
    const match = new Match(registry, scenario, 1);
    turnOf(match, 'a');
    take(match, 'lay', { frame: 'rack', to: { x: 2, y: 1 } });
    const next = match.advance()!;
    const [built] = signals(match, 'machine.built');
    const id = built.args.machine as string;
    expect(match.state.entities[id]).toMatchObject({ kind: 'machine', fields: { seat: 'rust', pos: { x: 2, y: 1 }, gauge: 3, born: 1 } });
    expect(stat(scenario, match, id, 'sockets')).toBe(8);
    // The frame is the machine now, and the pile that held it is gone.
    expect(match.state.entities.rack).toBeUndefined();
    expect(match.state.entities.heap).toBeUndefined();
    // A shell is asked nothing.
    expect(next.options[0].params.bot).toBe('a');
    expect(match.state.entities.a.fields.charge).toBe(1);
  });

  it('breaks a part with each blow that lands, and collapses what has nothing left to break', () => {
    const scenario = bench([
      robot('a', 'chrome', [1, 1], [part('ram', 'striker', { rate: 2 })]),
      machine('z', 'rust', [2, 1], [part('lamp', 'eye')], 1),
    ]);
    const match = findSeed((seed) => {
      const attempt = new Match(registry, scenario, seed);
      for (let i = 0; i < 40 && attempt.state.entities.z; i++) {
        const turn = turnOf(attempt, 'a');
        attempt.submit(turn.options.findIndex((option) => option.intent === (turn.options.some((other) => other.intent === 'strike') ? 'strike' : 'idle')));
        attempt.advance();
      }
      return attempt.state.entities.z ? undefined : attempt;
    });
    expect(signals(match, 'part.broke').map((event) => event.args)).toEqual([{ part: 'lamp', on: 'z' }]);
    expect(signals(match, 'machine.collapsed')).toHaveLength(1);
    // What was a machine is a pile: its part, and its frame.
    const heap = Object.entries(match.state.entities).find(([, entity]) => entity.kind === 'pile')!;
    expect(heap[1].fields.pos).toEqual({ x: 2, y: 1 });
    const held = match.state.links.holds.map(([, to]) => match.state.entities[to]);
    expect(held).toHaveLength(2);
    expect(held.map((entity) => entity.fields)).toContainEqual(expect.objectContaining({ flow: 'matter', role: 'conduit', rate: 1 }));
    expect(held.map((entity) => entity.fields)).toContainEqual(expect.objectContaining({ flow: 'signal', role: 'sensor', broken: true }));
    expect(match.violations()).toEqual([]);
  });

  it('mends a broken part, and a shell woken that way changes seat', () => {
    const scenario = bench([
      robot('a', 'rust', [1, 1], [part('torch', 'welder')]),
      machine('z', 'chrome', [2, 1], [part('z-eye', 'eye'), part('z-brain', 'brain', { broken: true }), part('z-ram', 'striker'), part('z-panel', 'generator')], 1),
    ]);
    const match = new Match(registry, scenario, 1);
    expect(stat(scenario, match, 'z', 'awake')).toBe(false);
    turnOf(match, 'a');
    take(match, 'mend', { part: 'z-brain' });
    match.advance();
    expect(match.state.entities['z-brain'].fields.broken).toBe(false);
    expect(match.state.entities.z.fields.seat).toBe('rust');
    expect(signals(match, 'machine.woke').map((event) => event.args.machine)).toEqual(['z']);
  });

  it('burns a part for charge', () => {
    const scenario = bench([
      machine('a', 'rust', [1, 1], [
        part('eye', 'eye'), part('brain', 'brain'), part('legs', 'legs', { rate: 2 }), part('oven', 'furnace'), part('cell', 'battery'),
      ]),
      pile('heap', [1, 2], [part('lump', 'junk', { rate: 2 })]),
    ]);
    const match = new Match(registry, scenario, 1);
    expect(match.state.entities.a.fields.charge).toBe(2);
    turnOf(match, 'a');
    take(match, 'burn', { part: 'lump' });
    match.advance();
    expect(match.state.entities.lump).toBeUndefined();
    expect(match.state.entities.heap).toBeUndefined();
    // Four points from a part rated 2, kept to what the battery holds.
    expect(match.state.entities.a.fields.charge).toBe(4);
  });
});

describe('heat', () => {
  const heats = (match: Match) => match.log.filter((event) => event.t === 'set' && (event as any).field === 'heat').map((event) => (event as any).value);

  it('comes from work and is shed each tick', () => {
    const match = new Match(registry, bench([robot('a', 'rust', [1, 1])]), 1);
    turnOf(match, 'a');
    take(match, 'move', { to: { x: 2, y: 1 } });
    match.advance();
    expect(heats(match)).toEqual([1, 0]);
  });

  it('burns out a part of a machine run too hot', () => {
    // A second machine, so that someone is still awake whichever part goes.
    const match = new Match(registry, bench([robot('a', 'rust', [1, 1]), robot('b', 'rust', [4, 4])], { meltAt: 0 }), 1);
    turnOf(match, 'a');
    take(match, 'move', { to: { x: 2, y: 1 } });
    match.advance();
    const [burnt] = signals(match, 'part.broke');
    expect(burnt.args.on).toBe('a');
    expect(match.state.entities[burnt.args.part].fields.broken).toBe(true);
    expect(heats(match)).toEqual([1, 0]);
  });
});

describe('drives', () => {
  const setup = (drives: Record<string, number>) => bench([
    machine('a', 'rust', [1, 1], [
      part('eye', 'eye'), part('brain', 'brain', { drives }), part('legs', 'legs', { rate: 2 }),
      part('grip', 'gripper'), part('ram', 'striker'), part('panel', 'generator'),
    ], 3),
    robot('z', 'chrome', [2, 1]),
    pile('heap', [1, 2], [part('cell', 'battery')]),
  ], {}, 'wired');
  const first = (scenario: Loaded) => {
    const match = new Match(registry, scenario, 1);
    match.advance();
    match.step(bindSeats(scenario, behaviorsFor(registry)));
    return match.log.filter((event) => event.t === 'intent').at(-1) as any;
  };

  it('are the sum of the brains on a machine', () => {
    const scenario = bench([robot('a', 'rust', [1, 1], [part('second', 'brain', { drives: { hoard: 0, build: 1, fight: 3 } })])]);
    const match = new Match(registry, scenario, 1);
    match.author('yardmaster', [{ set: { id: 'a-brain', field: 'drives', value: { hoard: 3, build: 1, fight: 0 } } }]);
    expect(stat(scenario, match, 'a', 'drive')).toEqual({ hoard: 3, build: 2, fight: 3 });
  });

  it('decide what a machine left to itself does: the same machine hoards with one brain and fights with another', () => {
    expect(first(setup({ hoard: 3, build: 0, fight: 0 }))).toMatchObject({ seat: 'rust', intent: 'attach', params: { part: 'cell', onto: 'a' } });
    expect(first(setup({ hoard: 0, build: 0, fight: 3 }))).toMatchObject({ seat: 'rust', intent: 'strike', params: { target: 'z' } });
  });

  it('refuses a drive out of range', () => {
    expect(refusal(() => bench([robot('a', 'rust', [1, 1], [part('mad', 'brain', { drives: { hoard: 9, build: 0, fight: 0 } })])])))
      .toMatch(/a drive runs from 0 to 3/);
  });
});

describe('the yardmaster', () => {
  it('drops new scrap into a running match, and a machine picks it up', () => {
    const scenario = bench([robot('a', 'rust', [1, 1])]);
    const match = new Match(registry, scenario, 1);
    expect(intents(turnOf(match, 'a'))).toEqual(['drop', 'idle', 'move']);
    match.author('yardmaster', [
      { create: { id: 'crate', kind: 'pile', fields: { pos: [1, 2] } } },
      { create: { id: 'gift', kind: 'part', fields: { flow: 'motion', role: 'gate', rate: 2 } } },
      { link: { rel: 'holds', from: 'crate', to: 'gift' } },
    ]);
    take(match, 'attach', { part: 'gift', onto: 'a' });
    match.advance();
    expect(stat(scenario, match, 'a', "does['striker']")).toBe(2);
    expect(match.log.filter((event) => event.by === 'yardmaster')).toHaveLength(3);
  });

  it('cannot author what the ruleset does not declare', () => {
    const match = new Match(registry, bench([robot('a', 'rust', [1, 1])]), 1);
    match.advance();
    const before = match.state;
    expect(() => match.author('yardmaster', [{ create: { kind: 'part', fields: { flow: 'plasma', role: 'source' } } }])).toThrow(/"plasma" is not a valid flow/);
    expect(() => match.author('yardmaster', [{ create: { kind: 'part', fields: { flow: 'heat', role: 'sink', rate: 9 } } }])).toThrow(/a part is rated from 1 to 3/);
    expect(() => match.author('yardmaster', [{ create: { kind: 'machine', fields: { seat: 'rust', pos: [1, 1] } } }])).toThrow(/two machines cannot share a square/);
    expect(() => match.author('rust', [{ destroy: 'a' }])).toThrow(RuleError);
    expect(match.state).toBe(before);
  });

  it('sees a junk primitive do a job once a layer puts it in the library', () => {
    const extension = {
      format: 2, extension: { id: 'drills', version: '0.1.0' }, extends: { id: 'junkyard', version: '0.3.0' },
      enums: { job: ['drill'] },
      tables: { jobs: { 'matter/source': 'drill' } },
      intents: {
        dig: {
          doc: 'Dig a part out of the ground. Needs a drill.',
          params: { bot: 'machine' },
          gate: "bot.does['drill'] > 0 && bot.free > 0",
          effects: [
            { create: { kind: 'part', as: 'found', fields: { flow: "'energy'", role: "'store'" } } },
            { link: { rel: 'mounts', from: 'bot', to: 'found' } },
          ],
        },
      },
      menus: { act: ['dig'] },
    };
    const extended = compileWith(readYaml('rulesets/junkyard/ruleset.yaml'), [extension]);
    const doc = {
      format: 2, scenario: { id: 'dig' }, ruleset: { id: 'junkyard', version: '0.3.0' },
      seats: { rust: {}, yardmaster: { referee: true } }, space: { width: 4, height: 4 }, game: { dropEvery: 0 },
      ...((setup) => ({ entities: setup.entities, links: setup.links }))(machine('a', 'rust', [1, 1], [
        part('eye', 'eye'), part('brain', 'brain'), part('legs', 'legs', { rate: 2 }), part('bit', 'junk'),
      ])),
    };
    doc.entities.find((entity) => entity.id === 'bit')!.fields = { flow: 'matter', role: 'source' };
    // To the base ruleset the bit is junk.
    const plain = loadScenario(registry, doc);
    const base = new Match(registry, plain, 1);
    expect(jobOf(plain, base, 'bit')).toBe('none');
    expect(intents(base.advance()!)).toEqual(['idle', 'move']);
    // With the layer, the same part is a drill, and the machine can dig.
    const scenario = loadScenario(extended, doc);
    const match = new Match(extended, scenario, 1);
    expect(jobOf(scenario, match, 'bit', extended)).toBe('drill');
    take(match, 'dig');
    match.advance();
    expect(mountsOf(match, 'a')).toHaveLength(5);
  });
});

describe('the yard', () => {
  const runs = [1, 2, 3].map((seed) => play(registry, yard, seed));

  it.each([0, 1, 2])('runs for 80 ticks and ends in a census, not a win (run %i)', (run) => {
    const { outcome, state, match } = runs[run];
    expect(outcome.result).toBe('census');
    expect('winner' in outcome).toBe(false);
    expect(state.game.tick).toBe(81);
    expect(outcome.machines).toBe(Object.values(state.entities).filter((entity) => entity.kind === 'machine').length);
    const seats = ['rust', 'moss', 'chrome', 'scavenger', 'wild'].map((seat) => outcome[seat] as number);
    expect(seats.reduce((sum, count) => sum + count, 0)).toBe(outcome.awake);
    expect(match.violations()).toEqual([]);
  });

  it('has machines build machines, and wake them', () => {
    for (const { outcome, match } of runs) {
      expect(outcome.built as number).toBeGreaterThan(0);
      expect(signals(match, 'machine.built')).toHaveLength(outcome.built as number);
      expect(signals(match, 'machine.woke').length).toBeGreaterThan(0);
    }
  });

  it('grows and shrinks: scrap falls, frames become machines, and parts break', () => {
    const { log } = runs[0];
    expect(log.filter((event) => event.t === 'create' && event.kind === 'part').length).toBeGreaterThan(60);
    expect(log.some((event) => event.t === 'destroy')).toBe(true);
    expect(runs.some(({ match }) => signals(match, 'part.broke').length > 0)).toBe(true);
  });
});

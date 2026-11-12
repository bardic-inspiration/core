// The groundwork a host such as the studio stands on: behaviors as their own
// layer, causes in the log, explained enumeration, free-standing expressions,
// cell layers, seat streams in the state, and replay and forking with a
// referee's changes. Tested on the tiny ruleset, apart from any game.

import { describe, expect, it } from 'vitest';
import {
  bindSeats, compileBehaviors, compileExpression, createGridHost, fold, fork, hashLog, Match, playMatch, RandomSeat, replay,
  summarize, UtilitySeat, type GameEvent, type SpaceMap,
} from '../src/index.ts';
import { loadRuleset, loadScenarioFile, readYaml } from '../src/load.ts';
import { behaviorsFor, compileWith, loadScenario, play, refusal, tiny, tinyBehaviors, tinyScenario } from './helpers.ts';

const registry = compileWith(tiny());
const scenario = loadScenario(registry, tinyScenario());
const random = () => ({ a: new RandomSeat(), b: new RandomSeat() });

describe('behaviors as their own layer', () => {
  it('is no longer part of a ruleset', () => {
    expect(refusal(() => compileWith({ ...tiny(), behaviors: { eager: { scores: { bump: 1 } } } }))).toMatch(/unknown key "behaviors"/);
  });

  it('compiles a set against a registry, in the scope of the intents it scores', () => {
    const { byName, sets } = compileBehaviors(registry, tinyBehaviors({ picky: { scores: { bump: 'token.value * 2 + (seat == token.owner ? 1 : 0)' } } }));
    expect(sets).toEqual(['tiny']);
    const match = new Match(registry, scenario, 1);
    const decision = match.advance()!;
    expect(match.scores(byName.get('picky')!, decision.seat, decision.options)).toEqual([3]);
  });

  const refusals: [string, (doc: any) => void, RegExp][] = [
    ['a score for an unknown intent', (d) => { d.behaviors.eager.scores.pass = 1; }, /behaviors\.eager\.scores\.pass: unknown intent "pass"/],
    ['a score that is not a number', (d) => { d.behaviors.eager.scores.bump = "'high'"; }, /is string, but int or double is needed/],
    ['a score reading what the intent does not bind', (d) => { d.behaviors.eager.scores.bump = 'weapon.reach'; }, /behaviors\.eager\.scores\.bump/],
    ['a goal that is not a condition', (d) => { d.behaviors.eager.goals = [{ name: 'g', when: 'token.value', scale: { bump: 2 } }]; }, /is int, but bool is needed/],
    ['a set written for another ruleset', (d) => { d.ruleset.id = 'checkers'; }, /written for checkers@1\.0\.0, but the ruleset is tiny@1\.0\.0/],
    ['a set that needs an extension that is not loaded', (d) => { d.extensions = ['homebrew']; }, /needs the extension "homebrew"/],
    ['an unknown key', (d) => { d.behaviors.eager.weights = {}; }, /unknown key "weights"/],
    ['an unsupported format version', (d) => { d.format = 1; }, /format 1 is not supported/],
  ];
  it.each(refusals)('refuses %s', (_name, breakIt, reason) => {
    const doc = tinyBehaviors();
    breakIt(doc);
    expect(refusal(() => compileBehaviors(registry, doc))).toMatch(reason);
  });

  it('lays a later set over an earlier one', () => {
    const base = tinyBehaviors({ eager: { scores: { bump: 1 }, goals: [{ name: 'late', when: 'game.turns > 2', scale: { bump: 2 } }] } });
    const overlay = tinyBehaviors({
      eager: { scores: { bump: 5 }, goals: [{ name: 'late', when: 'true', scale: { bump: 10 } }] },
      lazy: { scores: { bump: -1 } },
    });
    const { byName, sets } = compileBehaviors(registry, [base, { ...overlay, behaviorSet: { id: 'variant' } }]);
    expect(sets).toEqual(['tiny', 'variant']);
    const match = new Match(registry, scenario, 1);
    const decision = match.advance()!;
    expect(match.scores(byName.get('eager')!, decision.seat, decision.options)).toEqual([50]);
    expect(match.scores(byName.get('lazy')!, decision.seat, decision.options)).toEqual([-1]);
  });

  it('binds seats by the scenario, and by the run over the scenario', () => {
    const behaviors = compileBehaviors(registry, tinyBehaviors());
    const named = loadScenario(registry, { ...tinyScenario(), seats: { a: { behavior: 'eager' }, b: {} } });
    const seats = bindSeats(named, behaviors);
    expect([seats.a.name, seats.b.name]).toEqual(['eager', 'random']);
    const rebound = bindSeats(named, behaviors, { b: 'eager', a: new RandomSeat() });
    expect([rebound.a.name, rebound.b.name]).toEqual(['random', 'eager']);
    expect(refusal(() => bindSeats(loadScenario(registry, { ...tinyScenario(), seats: { a: { behavior: 'lazy' }, b: {} } }), behaviors)))
      .toMatch(/scenario\.seats\.a\.behavior: unknown behavior "lazy"/);
    expect(refusal(() => bindSeats(named, behaviors, { b: 'lazy' }))).toMatch(/bind\.b: unknown behavior "lazy"/);
    expect(refusal(() => bindSeats(named, behaviors, { c: 'eager' }))).toMatch(/"c" is not a seat/);
  });

  it('will not score a match of another ruleset', () => {
    const other = compileWith(tiny());
    const eager = compileBehaviors(other, tinyBehaviors()).byName.get('eager')!;
    const match = new Match(registry, scenario, 1);
    const decision = match.advance()!;
    expect(() => match.scores(eager, decision.seat, decision.options)).toThrow(/compiled against another ruleset/);
  });

  it('changes how a shipped scenario plays without touching its ruleset', () => {
    const dnd = loadRuleset('dnd-5e-2024-slice');
    const fight = loadScenarioFile(dnd, 'dnd-5e-2024-slice', 'worg-vs-scout');
    const rooted = {
      format: 2, behaviorSet: { id: 'rooted' }, ruleset: { id: 'dnd-5e-2024-slice', version: '0.4.0' },
      behaviors: { hunter: { scores: { move: -1000, dash: -1000 } } },
    };
    const varied = compileBehaviors(dnd, [readYaml('rulesets/dnd-5e-2024-slice/behaviors/default.yaml'), rooted]);
    const moves = (log: GameEvent[]) => log.filter((event) => event.t === 'intent' && event.seat === 'wild' && event.intent === 'move').length;
    expect(moves(play(dnd, fight, 1).log)).toBeGreaterThan(0);
    expect(moves(play(dnd, fight, 1, varied).log)).toBe(0);
  });
});

describe('causes in the log', () => {
  it('records what each entry ran under, so the log reads as a tree', () => {
    const match = new Match(registry, scenario, 1);
    match.advance();
    match.submit(0);
    match.advance();
    const [intent, set, signal, reaction] = match.log.slice(-4);
    expect(intent).toMatchObject({ t: 'intent', intent: 'bump', of: 1 });
    expect(intent.cause).toBeUndefined();
    expect(set).toMatchObject({ t: 'set', cause: intent.seq });
    expect(signal).toMatchObject({ t: 'signal', name: 'bumped', cause: intent.seq });
    expect(reaction).toMatchObject({ t: 'global', field: 'turns', cause: signal.seq });
    for (const event of match.log.slice(0, intent.seq)) expect(event.cause).toBeUndefined();
  });

  it('nests a decision asked for during resolution under what asked for it', () => {
    const dnd = loadRuleset('dnd-5e-2024-slice');
    const { log } = play(dnd, loadScenarioFile(dnd, 'dnd-5e-2024-slice', 'mage-duel'), 1);
    const depth = (event: GameEvent): number => (event.cause === undefined ? 0 : 1 + depth(log[event.cause]));
    const reactions = log.filter((event) => event.t === 'intent' && event.cause !== undefined);
    expect(reactions.length).toBeGreaterThan(0);
    // A reaction to a spell sits under the signal that announced it, which sits under the cast.
    expect(Math.max(...reactions.map(depth))).toBeGreaterThanOrEqual(2);
    // The end is logged under the write that brought it about.
    expect(log[log.length - 1]).toMatchObject({ t: 'end' });
    expect(log[log.length - 1].cause).toBe(log[log.length - 2].cause);
  });

  it('leaves a referee\'s own changes without a cause, and puts what they set off under them', () => {
    const refereed = loadScenario(registry, { ...tinyScenario(), seats: { a: {}, b: {}, ref: { referee: true } } });
    const match = new Match(registry, refereed, 1);
    match.author('ref', [{ set: { id: 't1', field: 'value', value: 2 } }]);
    match.adjudicate('ref', 'b', 'bump', { token: 't2' });
    match.advance();
    const [authored, ruled, set] = match.log.slice(-5);
    expect(authored).toMatchObject({ t: 'set', by: 'ref' });
    expect(authored.cause).toBeUndefined();
    expect(ruled).toMatchObject({ t: 'intent', by: 'ref', seat: 'b' });
    expect('of' in ruled).toBe(false);
    expect(set.cause).toBe(ruled.seq);
  });
});

/** The tiny ruleset on a small grid: tokens stand on cells and may step to a neighbour that is not mud. */
const gridded = (change: (doc: any) => void = () => {}) => {
  const doc = tiny();
  doc.enums.terrain = ['open', 'wall', 'mud'];
  doc.space = {
    grid: 'square', adjacency: 4, unit: 5,
    layers: { terrain: { type: 'terrain', default: 'open' }, height: { type: 'int', default: 0 } },
    blocksMove: "cell.terrain == 'wall'",
    blocksSight: "cell.terrain == 'wall' || cell.height >= 2",
  };
  doc.kinds.token.fields.pos = 'cell';
  doc.kinds.token.derived.reach = { type: 'int', value: 'cellsWithin(self.pos, 5).size()' };
  doc.intents.step = {
    params: { token: { type: 'token', in: 'all.token.filter(t, t.owner == seat)' }, to: { type: 'cell', in: 'neighbors(token.pos)' } },
    gate: ["cellAt(to).terrain != 'mud'", '!all.token.exists(t, t.pos == to)', 'token.reach > 0 && distance(token.pos, to) == 5'],
    effects: [{ set: { 'token.pos': 'to' } }],
  };
  doc.flow[0].do[0].do[0].prompt.offer = ['step', 'bump'];
  change(doc);
  return doc;
};
const griddedScenario = (change: (doc: any) => void = () => {}) => {
  const doc = tinyScenario();
  doc.space = { width: 3, height: 3, cells: [{ at: [1, 0], terrain: 'wall' }, { at: [0, 1], terrain: 'mud', height: 2 }, { at: [2, 1], height: 1 }] };
  doc.entities[0].fields.pos = [0, 0];
  doc.entities[1].fields.pos = [2, 2];
  change(doc);
  return doc;
};

describe('cell layers', () => {
  const grid = compileWith(gridded());
  const board = loadScenario(grid, griddedScenario());

  it('works the map out from the ruleset\'s space rules and the scenario\'s cells', () => {
    expect(board.map).toEqual({
      grid: 'square', adjacency: 4, corners: 'open', unit: 5, width: 3, height: 3,
      defaults: { terrain: 'open', height: 0 },
      cells: [
        { x: 1, y: 0, values: { terrain: 'wall', height: 0 } },
        { x: 0, y: 1, values: { terrain: 'mud', height: 2 } },
        { x: 2, y: 1, values: { terrain: 'open', height: 1 } },
      ],
      blocksMove: [{ x: 1, y: 0 }],
      blocksSight: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
    } satisfies SpaceMap);
  });

  it('reads a cell\'s values in a rule through cellAt', () => {
    const match = new Match(grid, board, 1);
    const decision = match.advance()!;
    // From (0, 0): the wall is not a neighbour at all, and the mud is refused by the gate.
    expect(decision.options).toEqual([{ intent: 'bump', params: { token: 't1' } }]);
    const value = (source: string) => compileExpression(grid, source).evaluate(match.state, board);
    expect(value('cellAt(cell(0, 1)).height + cellAt(cell(2, 1)).height')).toBe(3);
    expect(value('cellAt(cell(1, 0)).terrain')).toBe('wall');
    expect(value('inBounds(cell(1, 0))')).toBe(false);
    expect(value('lineOfSight(cell(0, 0), cell(0, 2))')).toBe(false);
    expect(() => value('cellAt(cell(3, 0)).height')).toThrow(/cellAt: \(3, 0\) is off the map/);
  });

  it('hands the map to the engine\'s own host', () => {
    const asked: string[] = [];
    const custom = loadScenario(grid, griddedScenario(), {
      host: (map) => {
        const reference = createGridHost(map);
        return { ...reference, neighbors: (cell) => { asked.push(`${cell.x},${cell.y}`); return reference.neighbors(cell); } };
      },
    });
    new Match(grid, custom, 1).advance();
    expect(asked).toEqual(['0,0']);
  });

  const refusals: [string, (doc: any) => void, RegExp][] = [
    ['a layer of a type a cell cannot hold', (d) => { d.space.layers.height.type = 'list<int>'; }, /a cell layer holds an int, number, bool, string, or enum/],
    ['a layer default of the wrong type', (d) => { d.space.layers.terrain.default = 'lava'; }, /space\.layers\.terrain\.default: "lava" is not a valid terrain/],
    ['a layer with no default', (d) => { delete d.space.layers.height.default; }, /space\.layers\.height/],
    ['a layer named at', (d) => { d.space.layers.at = { type: 'int', default: 0 }; }, /name the layer something else/],
    ['a rule that reads a layer that is not declared', (d) => { d.intents.step.gate[0] = "cellAt(to).terain != 'mud'"; }, /intents\.step\.gate\.0/],
    ['a rule that compares a layer with the wrong type', (d) => { d.intents.step.gate[0] = 'cellAt(to).height == "low"'; }, /intents\.step\.gate\.0/],
    ['a space rule that is not a condition', (d) => { d.space.blocksMove = 'cell.height'; }, /space\.blocksMove: is int, but bool is needed/],
    ['a space rule that reads the match', (d) => { d.space.blocksSight = 'game.turns > 0'; }, /space\.blocksSight/],
    ['layers without a grid', (d) => { d.space = { grid: 'none', layers: {} }; }, /declares nothing else about space/],
  ];
  it.each(refusals)('refuses %s', (_name, breakIt, reason) => {
    expect(refusal(() => compileWith(gridded(breakIt)))).toMatch(reason);
  });

  const scenarioRefusals: [string, (doc: any) => void, RegExp][] = [
    ['a cell off the map', (d) => { d.space.cells[0].at = [3, 0]; }, /space\.cells\.0\.at: \(3, 0\) is off the map/],
    ['a cell given twice', (d) => { d.space.cells[1].at = [1, 0]; }, /\(1, 0\) is given twice/],
    ['a layer the ruleset does not declare', (d) => { d.space.cells[0].cover = 1; }, /space\.cells\.0\.cover: the ruleset declares no such cell layer/],
    ['a value of the wrong type', (d) => { d.space.cells[1].height = 'tall'; }, /space\.cells\.1\.height: "tall" is not a valid int/],
    ['the old list of blocked cells', (d) => { d.space.blocked = [[1, 1]]; }, /unknown key "blocked"/],
  ];
  it.each(scenarioRefusals)('refuses %s in a scenario', (_name, breakIt, reason) => {
    expect(refusal(() => loadScenario(grid, griddedScenario(breakIt)))).toMatch(reason);
  });
});

describe('explained enumeration', () => {
  const grid = compileWith(gridded());
  const board = loadScenario(grid, griddedScenario());

  it('returns every candidate, legal or not, with each gate and what it asked the host', () => {
    const match = new Match(grid, board, 1);
    const decision = match.advance()!;
    const before = JSON.stringify([match.log, match.state]);
    const explained = match.explain();
    expect(JSON.stringify([match.log, match.state])).toBe(before);
    expect(explained.seat).toBe('a');
    const [step, bump] = explained.intents;

    // The domain of `to` was one question to the host, asked with `token` bound.
    expect(step.domains).toEqual([
      { param: 'token', given: {}, size: 1, calls: [] },
      { param: 'to', given: { token: 't1' }, size: 1, calls: [{ fn: 'neighbors', args: [{ x: 0, y: 0 }], result: [{ x: 0, y: 1 }] }] },
    ]);
    // Its one candidate is the mud: the first gate fails, and the others are still reported.
    expect(step.candidates).toHaveLength(1);
    const [mud] = step.candidates;
    expect(mud).toMatchObject({ params: { token: 't1', to: { x: 0, y: 1 } }, legal: false });
    expect(mud.gates.map((gate) => gate.result)).toEqual(['fail', 'pass', 'pass']);
    expect(mud.gates[0].calls).toEqual([{ fn: 'cellAt', args: [{ x: 0, y: 1 }], result: { terrain: 'mud', height: 2 } }]);
    // A gate that reads a derived value is shown the host calls behind it.
    expect(mud.gates[2].calls.map((call) => call.fn)).toEqual(['cellsWithin', 'distance']);

    expect(bump.candidates).toEqual([{ params: { token: 't1' }, legal: true, option: 0, gates: [{ source: 'token.value < 3', result: 'pass', calls: [] }] }]);
    expect(decision.options[0]).toEqual({ intent: 'bump', params: bump.candidates[0].params });
  });

  it('has the decision\'s options as its legal candidates, in order', () => {
    for (const [ruleset, name] of [['dnd-5e-2024-slice', 'pack-ambush'], ['holdem', 'four-handed'], ['junkyard', 'yard']]) {
      const shipped = loadRuleset(ruleset);
      const loaded = loadScenarioFile(shipped, ruleset, name);
      const match = new Match(shipped, loaded, 3);
      const seats = bindSeats(loaded, behaviorsFor(shipped));
      for (let taken = 0; taken < 25; taken++) {
        const decision = match.advance();
        if (!decision) break;
        const candidates = match.explain().intents.flatMap((intent) => intent.candidates.map((candidate) => ({ intent: intent.intent, ...candidate })));
        const legal = candidates.filter((candidate) => candidate.legal);
        expect(legal.map(({ intent, params }) => ({ intent, params }))).toEqual(decision.options);
        expect(legal.map((candidate) => candidate.option)).toEqual(decision.options.map((_, index) => index));
        for (const candidate of candidates) expect(candidate.gates.every((gate) => gate.result === 'pass')).toBe(candidate.legal);
        match.step(seats);
      }
    }
  });

  it('needs a decision to explain', () => {
    expect(() => new Match(grid, board, 1).explain()).toThrow(/no pending decision/);
  });
});

describe('free-standing expressions', () => {
  const state = new Match(registry, scenario, 1).state;

  it('compiles against a registry and evaluates on any state', () => {
    const total = compileExpression(registry, 'all.token.map(t, t.double).sum()');
    expect(total.type).toBe('int');
    expect(total.evaluate(state, scenario)).toBe(4);
    const { log } = new Match(registry, scenario, 1).run(random());
    // On the state at any point of a log, as a batch metric is.
    expect(log.filter((event) => event.t === 'intent').map((event) => total.evaluate(fold(log.slice(0, event.seq)), scenario))).toEqual([4, 6, 8, 10]);
    expect(compileExpression(registry, 'all.token.filter(t, t.value > 5)').type).toBe('list<token>');
  });

  it('takes typed variables, such as a signal\'s arguments', () => {
    const owned = compileExpression(registry, 'token.owner == who && token.value >= least', { vars: { token: 'token', who: 'seat', least: 'int' }, expect: 'bool' });
    expect(owned.evaluate(state, scenario, { vars: { token: 't1', who: 'a', least: 1 } })).toBe(true);
    expect(owned.evaluate(state, scenario, { vars: { token: 't2', who: 'a', least: 1 } })).toBe(false);
    expect(() => owned.evaluate(state, scenario, { vars: { token: 't9', who: 'a', least: 1 } })).toThrow(/"t9" is not an existing token/);
    expect(() => owned.evaluate(state, scenario, { vars: { token: 't1', who: 'a' } })).toThrow(/expression\.vars\.least/);
  });

  it('evaluates through a seat\'s view, where a secret is an error', () => {
    const doc = tiny();
    doc.kinds.token.fields.secret = { type: 'int', default: 7, visible: 'viewer == self.owner' };
    const secretive = compileWith(doc);
    const table = loadScenario(secretive, { ...tinyScenario(), seats: { a: {}, b: {}, ref: { referee: true } } });
    const held = new Match(secretive, table, 1).state;
    const sum = compileExpression(secretive, 'all.token.map(t, t.secret).sum()');
    expect(sum.evaluate(held, table)).toBe(14);
    expect(sum.evaluate(held, table, { viewer: 'ref' })).toBe(14);
    expect(() => sum.evaluate(held, table, { viewer: 'a' })).toThrow(/token\.secret of "t2" is hidden from seat "a"/);
    expect(() => sum.evaluate(held, table, { viewer: 'nobody' })).toThrow(/not a seat/);
  });

  const refusals: [string, () => unknown, RegExp][] = [
    ['a bad address', () => compileExpression(registry, 'game.turn'), /expression: No such key: turn/],
    ['an unbound variable', () => compileExpression(registry, 'token.value'), /expression: /],
    ['a variable of an unknown type', () => compileExpression(registry, 'x', { vars: { x: 'coin' } }), /expression\.vars\.x: unknown type "coin"/],
    ['a result of the wrong type', () => compileExpression(registry, 'game.turns', { expect: 'bool' }), /is int, but bool is needed/],
  ];
  it.each(refusals)('refuses %s', (_name, attempt, reason) => {
    expect(refusal(attempt)).toMatch(reason);
  });
});

describe('seat streams', () => {
  it('are part of the state, written by the decisions that drew from them', () => {
    const two = loadScenario(registry, {
      ...tinyScenario(),
      entities: [...tinyScenario().entities, { id: 't3', kind: 'token', fields: { owner: 'a', color: 'red' } }],
    });
    const match = new Match(registry, two, 9);
    match.step(random());
    const first = match.log[match.log.length - 1] as Extract<GameEvent, { t: 'intent' }>;
    // Seat a chose between two tokens, so it drew; the position is in the entry and in the state.
    expect(first).toMatchObject({ t: 'intent', seat: 'a', of: 2 });
    expect(first.rng).toBeTypeOf('number');
    expect(match.state.streams).toEqual({ a: first.rng });
    expect(fold(match.log).streams).toEqual({ a: first.rng });
    expect(match.snapshot().state.streams).toEqual({ a: first.rng });
    // Seat b has one legal intent. It still asks its stream which, so it draws too.
    match.step(random());
    expect(Object.keys(match.state.streams)).toEqual(['a', 'b']);
  });

  it('are drawn from only while a decision is pending', () => {
    const match = new Match(registry, scenario, 1);
    expect(() => match.pick(2)).toThrow(/only while it has a decision/);
  });
});

describe('replay and forking with a referee', () => {
  const refereed = loadScenario(registry, { ...tinyScenario(), seats: { a: {}, b: {}, ref: { referee: true } } });
  const drivers = () => ({ ...random(), ref: new RandomSeat() });
  /** A match in which the referee authors before the start, between decisions, and rules an intent out of turn. */
  const refereedMatch = () => {
    const match = new Match(registry, refereed, 3);
    match.author('ref', [{ create: { kind: 'token', id: 'gift', fields: { owner: 'a', color: 'blue' } } }]);
    match.step(drivers());
    match.advance();
    match.author('ref', [{ set: { id: 't2', field: 'value', value: 0 } }, { create: { kind: 'token', fields: { owner: 'b', color: 'red' } } }]);
    match.step(drivers());
    match.adjudicate('ref', 'b', 'bump', { token: 't2' });
    match.step(drivers());
    match.author('ref', [{ destroy: 'gift' }]);
    match.run(drivers());
    return match;
  };

  it('re-applies the referee\'s changes and rulings where the log has them', () => {
    const original = refereedMatch();
    expect(original.log.filter((event) => event.by === 'ref').map((event) => event.t)).toEqual(['create', 'set', 'create', 'intent', 'destroy']);
    const replayed = replay(registry, refereed, original.log);
    expect(replayed.log).toEqual(original.log);
    expect(replayed.state).toEqual(original.state);
    expect(replayed.advance()).toBeNull();
  });

  it('refuses a log whose referee change the rules would not allow', () => {
    const { log } = refereedMatch();
    const tampered = log.map((event) => (event.t === 'set' && event.by ? { ...event, value: -5 } : event));
    expect(() => replay(registry, refereed, tampered)).toThrow(/value cannot be negative/);
  });

  it('forks a branch with edits at any of its decisions', () => {
    const original = refereedMatch();
    for (const decision of original.log.filter((event) => event.t === 'intent')) {
      const forked = fork(registry, refereed, original.log, decision.seq);
      expect(forked.log).toEqual(original.log.slice(0, decision.seq));
      expect(forked.state).toEqual(fold(forked.log));
    }
    // A fork takes another road from there.
    const last = original.log.filter((event) => event.t === 'intent' && !event.by).at(-1)!;
    const branch = fork(registry, refereed, original.log, last.seq);
    branch.author('ref', [{ set: { id: 't1', field: 'value', value: 0 } }]);
    branch.run(drivers());
    expect(branch.log.length).toBeGreaterThan(original.log.length);
    expect(replay(registry, refereed, branch.log).log).toEqual(branch.log);
  });

  it('starts from a snapshot of the same log when given one', () => {
    const match = new Match(registry, scenario, 2);
    match.step(random());
    match.advance();
    const snapshot = match.snapshot();
    const { log } = match.run(random());
    const last = log.filter((event) => event.t === 'intent').at(-1)!;
    const forked = fork(registry, scenario, log, last.seq, { from: snapshot });
    expect(forked.log).toEqual(log.slice(0, last.seq));
    forked.run(random());
    expect(forked.log).toEqual(log);
    const other = new Match(registry, scenario, 7);
    other.step(random());
    other.advance();
    expect(() => fork(registry, scenario, log, last.seq, { from: other.snapshot() })).toThrow(/parts from the log at entry 0/);
  });

  it('forks only at a decision', () => {
    const { log } = new Match(registry, scenario, 2).run(random());
    expect(() => fork(registry, scenario, log, 1)).toThrow(/entry 1 is not a decision/);
  });
});

describe('match records', () => {
  it('are worked out from the log alone', () => {
    const behaviors = compileBehaviors(registry, tinyBehaviors());
    const named = loadScenario(registry, { ...tinyScenario(), seats: { a: { behavior: 'eager' }, b: {} } });
    const { record, log } = playMatch(registry, named, 4, bindSeats(named, behaviors));
    expect(record).toEqual({
      ruleset: 'tiny', version: '1.0.0', scenario: 'pair', seed: '4',
      // The end condition holds at the fourth write, before that bump's signal.
      outcome: { result: 'done', turns: 3 },
      decisions: 4, forced: 4, options: { mean: 1, max: 1 },
      events: log.length,
      byType: { create: 2, end: 1, global: 4, intent: 4, seed: 1, set: 4, signal: 3 },
      signals: { bumped: 3 },
      entities: { start: 2, end: 2, created: 0, destroyed: 0 },
      seats: { a: { driver: 'eager', decisions: 2, intents: { bump: 2 } }, b: { driver: 'random', decisions: 2, intents: { bump: 2 } } },
      logHash: hashLog(log),
    });
    expect(summarize(registry, named, JSON.parse(JSON.stringify(log)), { a: 'eager', b: 'random' })).toEqual(record);
    expect(new UtilitySeat(behaviors.byName.get('eager')!).name).toBe('eager');
  });
});

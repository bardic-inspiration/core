// Maps: the playing environment as a document of its own, checked against the
// ruleset's `space`, and the 5e slice's square grid played on one.

import { describe, expect, it } from 'vitest';
import { compareHosts, compileExpression, createGridHost, emptyState, fold, fork, loadMap, Match, replay, type SpaceMap } from '../src/index.ts';
import { loadRuleset, loadScenarioFile, readMaps, readYaml } from '../src/load.ts';
import { compileWith, loadScenario, play, refusal, tiny, tinyScenario } from './helpers.ts';

/** The tiny ruleset on a square grid with two layers. */
const gridded = (change: (doc: any) => void = () => {}) => {
  const doc = tiny();
  doc.enums.terrain = ['open', 'wall', 'mud'];
  doc.space = {
    grid: 'square', adjacency: 8, unit: 5,
    layers: { terrain: { type: 'terrain', default: 'open' }, height: { type: 'int', default: 0 } },
    blocksMove: "cell.terrain == 'wall'",
    blocksSight: "cell.terrain == 'wall' || cell.height >= 2",
  };
  doc.kinds.token.fields.pos = 'cell';
  change(doc);
  return doc;
};
const yard = (change: (doc: any) => void = () => {}) => {
  const doc: any = {
    format: 2, map: { id: 'yard', title: 'Yard' }, ruleset: { id: 'tiny', version: '1.0.0' },
    legend: { '.': {}, '#': { terrain: 'wall' }, '~': { terrain: 'mud', height: 2 } },
    rows: ['.#.', '~..', '...'],
    cells: [{ at: [2, 1], height: 1 }],
  };
  change(doc);
  return doc;
};
const onMap = (change: (doc: any) => void = () => {}) => {
  const doc = tinyScenario();
  doc.map = 'yard';
  doc.entities[0].fields.pos = [0, 0];
  doc.entities[1].fields.pos = [2, 2];
  change(doc);
  return doc;
};

describe('map documents', () => {
  const grid = compileWith(gridded());
  const expected: SpaceMap = {
    id: 'yard', grid: 'square', adjacency: 8, corners: 'open', unit: 5, width: 3, height: 3,
    defaults: { terrain: 'open', height: 0 },
    cells: [
      { x: 1, y: 0, values: { terrain: 'wall', height: 0 } },
      { x: 0, y: 1, values: { terrain: 'mud', height: 2 } },
      { x: 2, y: 1, values: { terrain: 'open', height: 1 } },
    ],
    blocksMove: [{ x: 1, y: 0 }],
    blocksSight: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
    places: {},
  };

  it('reads a picture: the first row is y = 0, and a symbol holds what the legend says', () => {
    expect(loadMap(grid, yard())).toEqual(expected);
  });

  it('gives the same map from a size and a list of cells', () => {
    const listed = yard((d) => {
      delete d.legend;
      delete d.rows;
      Object.assign(d, { width: 3, height: 3 });
      d.cells = [{ at: [1, 0], terrain: 'wall' }, { at: [0, 1], terrain: 'mud', height: 2 }, { at: [2, 1], height: 1 }];
    });
    expect(loadMap(grid, listed)).toEqual(expected);
  });

  it('lets a listed cell override the picture', () => {
    const map = loadMap(grid, yard((d) => { d.cells = [{ at: [1, 0], terrain: 'mud' }]; }));
    expect(map.cells.find((cell) => cell.x === 1 && cell.y === 0)!.values).toEqual({ terrain: 'mud', height: 0 });
    expect(map.blocksMove).toEqual([]);
  });

  it('is the map of a scenario that names it', () => {
    const scenario = loadScenario(grid, onMap(), { maps: { yard: yard() } });
    expect(scenario.map).toEqual(expected);
    expect(scenario.world.space).toEqual({ width: 3, height: 3, unit: 5 });
    expect(scenario.world.host.inBounds({ x: 1, y: 0 })).toBe(false);
    expect(scenario.world.host.cellAt({ x: 0, y: 1 })).toEqual({ terrain: 'mud', height: 2 });
  });

  it('plays the same match as the same map written inline', () => {
    const stepping = compileWith(gridded((d) => {
      d.intents.step = {
        params: { token: { type: 'token', in: 'all.token.filter(t, t.owner == seat)' }, to: { type: 'cell', in: 'neighbors(token.pos)' } },
        gate: ["cellAt(to).terrain != 'mud'", '!all.token.exists(t, t.pos == to)'],
        effects: [{ set: { 'token.pos': 'to' } }],
      };
      d.flow[0].do[0].do[0].prompt.offer = ['step', 'bump'];
    }));
    const inline = onMap((d) => {
      delete d.map;
      d.space = { width: 3, height: 3, cells: [{ at: [1, 0], terrain: 'wall' }, { at: [0, 1], terrain: 'mud', height: 2 }, { at: [2, 1], height: 1 }] };
    });
    const log = (scenario: any, options = {}) => play(stepping, loadScenario(stepping, scenario, options), 7).log;
    expect(log(onMap(), { maps: { yard: yard() } })).toEqual(log(inline));
  });

  it.each<[string, (d: any) => void, RegExp]>([
    ['an unknown key', (d) => { d.blocked = [[1, 1]]; }, /unknown key "blocked"/],
    ['another ruleset', (d) => { d.ruleset.id = 'checkers'; }, /map\.ruleset: written for checkers@1\.0\.0/],
    ['neither rows nor a size', (d) => { delete d.rows; delete d.legend; }, /a map gives rows, or a width and a height/],
    ['rows without a legend', (d) => { delete d.legend; }, /rows need a legend/],
    ['a ragged row', (d) => { d.rows[1] = '~.'; }, /map\.rows\.1: is 2 cells wide, but the first row is 3/],
    ['a symbol not in the legend', (d) => { d.rows[2] = '..?'; }, /map\.rows\.2: "\?" at column 2 is not in the legend/],
    ['a symbol of two characters', (d) => { d.legend['##'] = {}; }, /map\.legend/],
    ['a size that disagrees with the rows', (d) => { d.width = 4; }, /the rows are 3 by 3, but width and height say 4 by 3/],
    ['a layer the ruleset does not declare', (d) => { d.legend['#'].cover = 1; }, /map\.legend\.#\.cover: the ruleset declares no such cell layer/],
    ['a value of the wrong type', (d) => { d.legend['~'].height = 'tall'; }, /map\.legend\.~\.height: "tall" is not a valid int/],
    ['a listed cell off the map', (d) => { d.cells[0].at = [3, 0]; }, /map\.cells\.0\.at: \(3, 0\) is off the map/],
    ['a listed cell given twice', (d) => { d.cells.push({ at: [2, 1], height: 3 }); }, /\(2, 1\) is given twice/],
  ])('refuses a map with %s', (_, breakIt, reason) => {
    expect(refusal(() => loadMap(grid, yard(breakIt)))).toMatch(reason);
  });

  it('reports a wrong legend entry once, however often its symbol is drawn', () => {
    const message = refusal(() => loadMap(grid, yard((d) => { d.legend['.'] = { terrain: 'lava' }; })));
    expect(message.match(/lava/g)).toHaveLength(1);
  });

  it('refuses a map for a ruleset with no space, or of a size the ruleset does not fix', () => {
    expect(refusal(() => loadMap(compileWith(tiny()), yard()))).toMatch(/the ruleset declares no space/);
    const fixed = compileWith(gridded((d) => { Object.assign(d.space, { width: 8, height: 8 }); }));
    expect(refusal(() => loadMap(fixed, yard()))).toMatch(/the ruleset fixes the grid size/);
  });

  it.each<[string, (d: any) => void, Record<string, unknown>, RegExp]>([
    ['names a map it was not given', () => {}, {}, /scenario\.map: no map "yard" was given/],
    ['names a map and gives a space too', (d) => { d.space = { width: 3, height: 3 }; }, { yard: yard() }, /names a map, so it gives no space of its own/],
    ['names a map filed under another id', () => {}, { yard: yard((d) => { d.map.id = 'field'; }) }, /calls itself "field"/],
    ['names a map that is refused', () => {}, { yard: yard((d) => { d.rows[2] = '..?'; }) }, /map\.rows\.2/],
    ['stands a token where the map blocks movement', (d) => { d.entities[0].fields.pos = [1, 0]; }, { yard: yard() }, /entities/],
  ])('refuses a scenario that %s', (_, breakIt, maps, reason) => {
    const checked = compileWith(gridded((d) => { d.kinds.token.checks.push({ that: 'inBounds(self.pos)', message: 'a token stands on the map' }); }));
    expect(refusal(() => loadScenario(checked, onMap(breakIt), { maps }))).toMatch(reason);
  });
});

describe('corners', () => {
  // The yard has a wall at (1, 0). The diagonal from (0, 0) to (1, 1) passes its corner.
  const at = (corners: 'open' | 'closed') => createGridHost(loadMap(compileWith(gridded((d) => { d.space.corners = corners; })), yard()));
  const origin = { x: 0, y: 0 };

  it('are open unless the ruleset closes them', () => {
    expect(loadMap(compileWith(gridded()), yard()).corners).toBe('open');
    expect(at('open').neighbors(origin)).toEqual([{ x: 0, y: 1 }, { x: 1, y: 1 }]);
  });

  it('when closed, cut off a diagonal step past a cell that blocks movement', () => {
    const host = at('closed');
    expect(host.neighbors(origin)).toEqual([{ x: 0, y: 1 }]);
    expect(host.neighbors({ x: 1, y: 1 })).toEqual([{ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }]);
    // Only steps change: distance and range still count squares by the shortest route.
    expect(host.distance(origin, { x: 1, y: 1 })).toBe(5);
    expect(host.cellsWithin(origin, 5)).toEqual([origin, { x: 0, y: 1 }, { x: 1, y: 1 }]);
  });

  it('are part of what a host is held to', () => {
    const map = loadMap(compileWith(gridded((d) => { d.space.corners = 'closed'; })), yard());
    const cutting = createGridHost({ ...map, corners: 'open' });
    expect(compareHosts(createGridHost(map), createGridHost(map), map)).toEqual([]);
    expect(compareHosts(cutting, createGridHost(map), map).some((line) => line.startsWith('neighbors('))).toBe(true);
  });
});

describe('the 5e square grid', () => {
  const registry = loadRuleset('dnd-5e-2024-slice');
  const maps = readMaps('dnd-5e-2024-slice');
  const pass = loadMap(registry, maps['rocky-pass']);

  it('is 5-foot squares, diagonals at the same cost, corners closed', () => {
    expect(pass).toMatchObject({ id: 'rocky-pass', grid: 'square', adjacency: 8, corners: 'closed', unit: 5, width: 26, height: 14 });
    expect(pass.blocksMove).toEqual([{ x: 11, y: 3 }, { x: 11, y: 4 }, { x: 16, y: 6 }, { x: 12, y: 9 }, { x: 12, y: 10 }]);
    expect(pass.blocksSight).toEqual(pass.blocksMove);
    expect(pass.cells.filter((cell) => cell.values.terrain === 'difficult')).toHaveLength(20);
  });

  it('is the map the pack ambush is played on', () => {
    expect(loadScenarioFile(registry, 'dnd-5e-2024-slice', 'pack-ambush').map).toEqual(pass);
  });

  /** The worg alone with the scout on a strip of the given terrain, at its first turn. */
  const strip = (row: string, worgAt: [number, number]) => {
    const doc = readYaml('rulesets/dnd-5e-2024-slice/scenarios/worg-vs-scout.yaml') as any;
    delete doc.space;
    doc.map = 'strip';
    for (const entity of doc.entities) {
      if (entity.id === 'worg') Object.assign(entity.fields, { pos: worgAt, initiative: 30 });
      if (entity.id === 'scout') Object.assign(entity.fields, { pos: [11, 0], initiative: 1 });
    }
    const map = {
      format: 2, map: { id: 'strip' }, ruleset: { id: 'dnd-5e-2024-slice', version: '0.4.0' },
      legend: { '.': {}, '"': { terrain: 'difficult' }, '#': { terrain: 'rock' } }, rows: [row, '............'],
    };
    const match = new Match(registry, loadScenario(registry, doc, { maps: { strip: map } }), 1);
    // Anyone before the worg ends their turn.
    for (let decision = match.advance(); decision && decision.seat !== 'wild'; decision = match.advance()) {
      match.submit(decision.options.findIndex((option) => option.intent === 'endTurn'));
    }
    return match;
  };
  const moves = (match: Match) => match.advance()!.options.filter((option) => option.intent === 'move').map((option) => option.params.to);
  const stepTo = (match: Match, x: number, y: number) => {
    const decision = match.advance()!;
    match.submit(decision.options.findIndex((option) => option.intent === 'move' && JSON.stringify(option.params.to) === JSON.stringify({ x, y })));
  };

  it('charges 10 feet of movement for a square of Difficult Terrain, and 5 for any other', () => {
    const match = strip('.."""""""...', [0, 0]);
    const movement = () => (match.advance(), match.state.entities.worg.fields.movement as number);
    const speed = movement();
    stepTo(match, 1, 0);
    expect(movement()).toBe(speed - 5);
    stepTo(match, 2, 0);
    expect(movement()).toBe(speed - 15);
    stepTo(match, 3, 1);
    expect(movement()).toBe(speed - 20);
  });

  it('refuses a square the mover cannot pay for', () => {
    const match = strip('..""""""""..', [0, 0]);
    const movement = () => (match.advance(), match.state.entities.worg.fields.movement as number);
    for (let x = 1; movement() >= 10; x++) stepTo(match, x, 0);
    expect(movement()).toBe(5);
    expect(moves(match).every((to: any) => to.y === 1)).toBe(true);
  });

  it('does not let a creature cut the corner of a boulder', () => {
    expect(moves(strip('.#..........', [0, 0]))).toEqual([{ x: 0, y: 1 }]);
    expect(moves(strip('.#..........', [0, 1]))).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
});

describe('map criteria', () => {
  it.each<[string, (d: any) => void, RegExp]>([
    ['a smallest map larger than the largest', (d) => { d.space.size = { min: [4, 4], max: [3, 3] }; }, /space\.size: the smallest map is larger than the largest/],
    ['a check that is not a condition', (d) => { d.space.checks = [{ that: 'cell.height', message: 'x' }]; }, /space\.checks\.0\.that: is int, but bool is needed/],
    ['a check that reads the match', (d) => { d.space.checks = [{ that: 'game.turns > 0', message: 'x' }]; }, /space\.checks\.0\.that/],
    ['a default cell that fails a check', (d) => { d.space.checks = [{ that: 'cell.height > 0', message: 'ground is raised' }]; }, /every layer at its default fails a check: ground is raised/],
    ['cell checks without a grid', (d) => { d.space = { grid: 'none', checks: [] }; }, /space\.checks: a ruleset with no grid declares nothing else about space/],
  ])('refuses a ruleset with %s', (_, breakIt, reason) => {
    expect(refusal(() => compileWith(gridded(breakIt)))).toMatch(reason);
  });

  const strict = compileWith(gridded((d) => {
    d.space.size = { min: [3, 3], max: [4, 3] };
    d.space.checks = [{ that: "cell.terrain != 'wall' || cell.height == 0", message: 'a wall has no height of its own' }];
    d.space.places = ['gate'];
  }));
  const gated = (change: (doc: any) => void = () => {}) => yard((d) => {
    d.places = { gate: { at: [2, 2] }, pen: { at: [0, 2], size: [2, 1] } };
    change(d);
  });

  it('accepts a map that meets them, and hands its places on', () => {
    expect(loadMap(strict, gated()).places).toEqual({ gate: { x: 2, y: 2 }, pen: { x: 0, y: 2, width: 2, height: 1 } });
  });

  it.each<[string, (d: any) => void, RegExp]>([
    ['too small', (d) => { d.rows = ['.#.', '~..']; d.cells = []; d.places = { gate: { at: [2, 1] } }; }, /at least 3 by 3; this one is 3 by 2/],
    ['too large', (d) => { d.rows = ['.#...', '~....', '.....']; }, /at most 4 by 3; this one is 5 by 3/],
    ['a cell that fails a check', (d) => { d.legend['#'].height = 2; }, /map\.legend\.#: a wall has no height of its own/],
    ['a listed cell that fails a check', (d) => { d.cells = [{ at: [1, 0], height: 1 }, { at: [2, 0], terrain: 'wall', height: 1 }]; }, /map\.cells\.1: a wall has no height of its own/],
    ['no place the ruleset needs', (d) => { delete d.places.gate; }, /map\.places: the ruleset needs every map to have a place called "gate"/],
    ['a place off the map', (d) => { d.places.gate.at = [3, 0]; }, /map\.places\.gate: is off the map/],
    ['an area that runs off the map', (d) => { d.places.pen.size = [4, 1]; }, /map\.places\.pen: is off the map/],
    ['a place between cells', (d) => { d.places.gate.at = [1.5, 2]; }, /map\.places\.gate: a place on a grid is given in whole cells/],
  ])('refuses a map that is %s', (_, breakIt, reason) => {
    expect(refusal(() => loadMap(strict, gated(breakIt)))).toMatch(reason);
  });

  it('lets a scenario stand an entity at a place by name', () => {
    const scenario = loadScenario(strict, onMap((d) => { d.entities[0].fields.pos = 'gate'; d.entities[1].fields.pos = [0, 0]; }), { maps: { yard: gated() } });
    expect(scenario.setup.find((event) => event.t === 'create')).toMatchObject({ fields: { pos: { x: 2, y: 2 } } });
    expect(refusal(() => loadScenario(strict, onMap((d) => { d.entities[0].fields.pos = 'well'; }), { maps: { yard: gated() } })))
      .toMatch(/entities\.0\.fields\.pos: the map has no place called "well"/);
  });

  it('holds an inline map to the same criteria', () => {
    const inline = onMap((d) => { delete d.map; d.space = { width: 3, height: 3, cells: [{ at: [1, 1], terrain: 'wall', height: 1 }] }; });
    const message = refusal(() => loadScenario(strict, inline));
    expect(message).toMatch(/space\.cells\.0: a wall has no height of its own/);
    expect(message).toMatch(/space\.places: the ruleset needs every map to have a place called "gate"/);
  });
});

describe('standard maps', () => {
  const standard = (only = false) => compileWith(gridded((d) => { d.space.map = { standard: 'yard', ...(only ? { only: true } : {}) }; }));
  const bare = (change: (doc: any) => void = () => {}) => onMap((d) => { delete d.map; change(d); });
  const field = yard((d) => { d.map.id = 'field'; });

  it('is the map of a scenario that names none', () => {
    expect(loadScenario(standard(), bare(), { maps: { yard: yard() } }).map!.id).toBe('yard');
    expect(refusal(() => loadScenario(standard(), bare(), { maps: {} }))).toMatch(/the ruleset's standard map, "yard", was not given/);
  });

  it('gives way to a map the scenario names or writes, unless the ruleset allows no other', () => {
    const maps = { yard: yard(), field };
    const inline = bare((d) => { d.space = { width: 3, height: 3 }; });
    expect(loadScenario(standard(), onMap((d) => { d.map = 'field'; }), { maps }).map!.id).toBe('field');
    expect(loadScenario(standard(), inline, { maps }).map!.id).toBeUndefined();
    expect(refusal(() => loadScenario(standard(true), onMap((d) => { d.map = 'field'; }), { maps }))).toMatch(/scenario\.map: the ruleset is played on its standard map, "yard", and no other/);
    expect(refusal(() => loadScenario(standard(true), inline, { maps }))).toMatch(/scenario\.space: the ruleset is played on its standard map/);
    expect(loadScenario(standard(true), onMap(), { maps }).map!.id).toBe('yard');
  });

  it('is the board every checkers scenario is played on', () => {
    const checkers = loadRuleset('checkers');
    const board = loadScenarioFile(checkers, 'checkers', 'standard').map!;
    expect(board).toMatchObject({ id: 'board', grid: 'square', width: 8, height: 8, cells: [] });
    const wide = { ...(readMaps('checkers').board as object), width: 10 };
    expect(refusal(() => loadMap(checkers, wide))).toMatch(/at most 8 by 8; this one is 10 by 8/);
  });
});

describe('a space with no grid', () => {
  const holdem = loadRuleset('holdem');
  const table = readMaps('holdem').table as any;

  it('has maps with a size and places, and no cells', () => {
    const map = loadMap(holdem, table);
    expect(map).toMatchObject({ id: 'table', grid: 'none', width: 12, height: 8, cells: [], blocksMove: [], blocksSight: [] });
    expect(map.places.board).toEqual({ x: 3.5, y: 3, width: 5, height: 1.5 });
    expect(map.places.pot).toEqual({ x: 6, y: 5.25 });
    expect(refusal(() => loadMap(holdem, { ...table, legend: { '.': {} }, rows: ['..'] }))).toMatch(/map\.rows: the ruleset has no grid, so its maps have no cells/);
    expect(refusal(() => loadMap(holdem, { ...table, places: { pot: { at: [6, 5] } } }))).toMatch(/a place called "board"/);
  });

  it('gives a scenario its table, and still answers no question about cells', () => {
    const scenario = loadScenarioFile(holdem, 'holdem', 'four-handed');
    expect(scenario.map!.id).toBe('table');
    expect(scenario.world.space).toEqual({ width: 12, height: 8, unit: 1 });
    const match = new Match(holdem, scenario, 1);
    expect(scenario.mapAt(match.state)).toBe(scenario.map);
    const plane = compileWith(gridded((d) => { d.space = { grid: 'none' }; delete d.kinds.token.fields.pos; }));
    expect(() => compileExpression(plane, 'distance(cell(0, 0), cell(1, 1))').evaluate(emptyState(), loadScenario(plane, { ...tinyScenario(), space: { width: 4, height: 4 } })))
      .toThrow(/space has no grid/);
  });
});

describe('mutable layers', () => {
  /** Tokens may raise a wall on a neighbouring cell, or flatten one; `height` stays the map's. */
  const digging = (change: (doc: any) => void = () => {}) => gridded((d) => {
    d.space.layers.terrain.mutable = true;
    d.space.checks = [{ that: "cell.terrain != 'mud' || cell.height > 0", message: 'mud lies on raised ground' }];
    d.intents.wall = {
      params: { token: { type: 'token', in: 'all.token.filter(t, t.owner == seat)' }, to: { type: 'cell', in: 'neighbors(token.pos)' } },
      gate: '!all.token.exists(t, t.pos == to)',
      effects: [{ at: 'to', set: { terrain: "'wall'" } }],
    };
    d.intents.clear = {
      params: { to: { type: 'cell', in: "range(3).map(x, cell(x, 0)).filter(c, cellAt(c).terrain == 'wall')" } },
      effects: [{ at: 'to', set: { terrain: "'open'" } }],
    };
    d.flow[0].do[0].do[0].prompt.offer = ['wall', 'clear', 'bump'];
    change(d);
  });
  const registry = compileWith(digging());
  const scenario = () => loadScenario(registry, onMap((d) => { d.seats.ref = { referee: true }; }), { maps: { yard: yard() } });
  const take = (match: Match, intent: string, to: { x: number; y: number }) => {
    const decision = match.advance()!;
    const index = decision.options.findIndex((option) => option.intent === intent && JSON.stringify(option.params.to) === JSON.stringify(to));
    if (index < 0) throw new Error(`cannot ${intent} ${JSON.stringify(to)}; legal: ${JSON.stringify(decision.options)}`);
    match.submit(index);
    match.advance();
  };

  it.each<[string, (d: any) => void, RegExp]>([
    ['a layer the ruleset keeps fixed', (d) => { d.intents.wall.effects = [{ at: 'to', set: { height: 1 } }]; }, /set\.height: the layer "height" is not mutable, so play cannot write it/],
    ['a layer the ruleset does not declare', (d) => { d.intents.wall.effects = [{ at: 'to', set: { cover: 1 } }]; }, /set\.cover: the ruleset declares no such cell layer/],
    ['a value of the wrong type', (d) => { d.intents.wall.effects = [{ at: 'to', set: { terrain: '3' } }]; }, /set\.terrain: is int, but string is needed/],
    ['somewhere that is not a cell', (d) => { d.intents.wall.effects = [{ at: 'token', set: { terrain: "'wall'" } }]; }, /\.at: is .*, but Cell is needed/],
  ])('refuses a rule that writes %s', (_, breakIt, reason) => {
    expect(refusal(() => compileWith(digging(breakIt)))).toMatch(reason);
  });

  it('writes a cell as one log event, held in the state as an overlay', () => {
    const on = scenario();
    const match = new Match(registry, on, 1);
    take(match, 'wall', { x: 1, y: 1 });
    const event = match.log.find((entry) => entry.t === 'ground')!;
    expect(event).toMatchObject({ t: 'ground', at: { x: 1, y: 1 }, layer: 'terrain', value: 'wall' });
    expect(match.log[event.cause!]).toMatchObject({ t: 'intent', intent: 'wall' });
    expect(match.state.ground).toEqual({ '1,1': { terrain: 'wall' } });
    expect(fold(match.log)).toEqual(match.state);
  });

  it('leaves the map as it was, and gives the ground of any state', () => {
    const on = scenario();
    const before = structuredClone(on.map);
    const match = new Match(registry, on, 1);
    const start = match.state;
    take(match, 'wall', { x: 1, y: 1 });
    expect(on.map).toEqual(before);
    expect(on.mapAt(start)).toBe(on.map);
    const now = on.mapAt(match.state)!;
    expect(now.cells.find((cell) => cell.x === 1 && cell.y === 1)!.values).toEqual({ terrain: 'wall', height: 0 });
    expect(now.blocksMove).toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(now.blocksSight).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
    // A second match on the same scenario starts from the map, not from the first match's ground.
    expect(on.mapAt(new Match(registry, on, 2).state)).toBe(on.map);
  });

  it('answers the rules from the ground as it now stands', () => {
    const on = scenario();
    const match = new Match(registry, on, 1);
    const ask = (source: string) => compileExpression(registry, source).evaluate(match.state, on);
    expect(ask('inBounds(cell(1, 1))')).toBe(true);
    take(match, 'wall', { x: 1, y: 1 });
    expect(ask("cellAt(cell(1, 1)).terrain")).toBe('wall');
    expect(ask('inBounds(cell(1, 1))')).toBe(false);
    expect(ask('lineOfSight(cell(0, 0), cell(2, 2))')).toBe(false);
    // The wall the map began with can be taken down, and the cell opens.
    take(match, 'clear', { x: 1, y: 0 });
    expect(ask('inBounds(cell(1, 0))')).toBe(true);
    expect(on.mapAt(match.state)!.blocksMove).toEqual([{ x: 1, y: 1 }]);
  });

  it('does not log a write that changes nothing, and refuses one that breaks a check or leaves the map', () => {
    const stay = compileWith(digging((d) => {
      d.intents.wall.effects = [{ at: 'cell(1, 0)', set: { terrain: "'wall'" } }];
      d.intents.clear.effects = [{ at: 'cell(2, 2)', set: { terrain: "'mud'" } }];
      d.intents.bump.effects = [{ at: 'cell(9, 9)', set: { terrain: "'wall'" } }];
    }));
    const play = (intent: string) => {
      const match = new Match(stay, loadScenario(stay, onMap(), { maps: { yard: yard() } }), 1);
      match.submit(match.advance()!.options.findIndex((option) => option.intent === intent));
      match.advance();
      return match;
    };
    expect(play('wall').log.some((entry) => entry.t === 'ground')).toBe(false);
    expect(() => play('clear')).toThrow(/\(2, 2\): mud lies on raised ground/);
    expect(() => play('bump')).toThrow(/\(9, 9\) is off the map/);
  });

  it('replays to the same log, and forks to the same ground', () => {
    const on = scenario();
    const match = new Match(registry, on, 1);
    take(match, 'wall', { x: 1, y: 1 });
    take(match, 'wall', { x: 1, y: 2 });
    match.author('ref', [{ ground: { at: [2, 1], layer: 'terrain', value: 'mud' } }]);
    const again = replay(registry, on, match.log);
    expect(again.log).toEqual(match.log);
    expect(on.mapAt(again.state)).toEqual(on.mapAt(match.state));
    const second = match.log.filter((entry) => entry.t === 'intent')[1];
    const branch = fork(registry, on, match.log, second.seq);
    expect(branch.state.ground).toEqual({ '1,1': { terrain: 'wall' } });
  });

  it('lets a referee write a mutable layer, under the same rules', () => {
    const on = scenario();
    const match = new Match(registry, on, 1);
    match.advance();
    match.author('ref', [{ ground: { at: { x: 2, y: 1 }, layer: 'terrain', value: 'mud' } }]);
    expect(match.log.at(-1)).toMatchObject({ t: 'ground', at: { x: 2, y: 1 }, layer: 'terrain', value: 'mud', by: 'ref' });
    expect(() => match.author('ref', [{ ground: { at: [2, 2], layer: 'height', value: 3 } }])).toThrow(/"height" is not mutable/);
    expect(() => match.author('ref', [{ ground: { at: [2, 2], layer: 'terrain', value: 'lava' } }])).toThrow(/not a valid terrain/);
    expect(() => match.author('ref', [{ ground: { at: [2, 2], layer: 'terrain', value: 'mud' } }])).toThrow(/mud lies on raised ground/);
    expect(() => match.author('ref', [{ ground: { at: [5, 5], layer: 'terrain', value: 'wall' } }])).toThrow(/off the map/);
  });
});

describe('a 5e spell that changes the ground', () => {
  const registry = loadRuleset('dnd-5e-2024-slice');
  const duel = loadScenarioFile(registry, 'dnd-5e-2024-slice', 'mage-duel');

  it('turns the open squares around its target into the terrain it leaves', () => {
    const doc = readYaml('rulesets/dnd-5e-2024-slice/scenarios/mage-duel.yaml') as any;
    delete doc.space;
    doc.map = 'lane';
    for (const entity of doc.entities) {
      if (entity.id === 'ember') Object.assign(entity.fields, { pos: [6, 1], initiative: 1 });
      if (entity.id === 'rime') Object.assign(entity.fields, { pos: [1, 1] });
    }
    const lane = {
      format: 2, map: { id: 'lane' }, ruleset: { id: 'dnd-5e-2024-slice', version: '0.4.0' },
      legend: { '.': {}, '#': { terrain: 'rock' } }, rows: ['.......#', '........', '......#.'],
    };
    const on = loadScenario(registry, doc, { maps: { lane } });
    const match = new Match(registry, on, 1);
    for (let decision = match.advance(); decision; decision = match.advance()) {
      const cast = decision.options.findIndex((option) => option.intent === 'castGround');
      if (cast >= 0) {
        expect(decision.options[cast].params).toMatchObject({ actor: 'rime', spell: 'grease', slot: 1, at: { x: 6, y: 1 } });
        match.submit(cast);
        break;
      }
      match.submit(decision.options.findIndex((option) => ['endTurn', 'holdReaction'].includes(option.intent)));
    }
    // Ember may counter it; either way the match is consistent, and when it works the ground changes.
    for (let decision = match.advance(); decision && decision.seat !== 'rime'; decision = match.advance()) {
      match.submit(decision.options.findIndex((option) => option.intent === 'holdReaction'));
    }
    const terrain = (x: number, y: number) => on.world.ground!(match.state.ground).host.cellAt({ x, y }).terrain;
    expect([5, 6, 7].flatMap((x) => [0, 1, 2].map((y) => terrain(x, y)))).toEqual(
      ['difficult', 'difficult', 'difficult', 'difficult', 'difficult', 'rock', 'rock', 'difficult', 'difficult']);
    expect(terrain(4, 1)).toBe('open');
    expect(match.log.filter((entry) => entry.t === 'ground')).toHaveLength(7);
    expect(on.map!.cells).toHaveLength(2);
  });

  it('is cast in recorded play, and those matches replay', () => {
    const seed = [1, 2, 3, 4, 5, 6, 7, 8].find((candidate) => play(registry, duel, candidate).log.some((entry) => entry.t === 'ground'))!;
    expect(seed).toBeDefined();
    const { log, match } = play(registry, duel, seed);
    expect(replay(registry, duel, log).log).toEqual(log);
    expect(fold(log)).toEqual(match.state);
    expect(Object.keys(match.state.ground).length).toBeGreaterThan(0);
  });
});

// Maps: the playing environment as a document of its own, checked against the
// ruleset's `space`, and the 5e slice's square grid played on one.

import { describe, expect, it } from 'vitest';
import { compareHosts, createGridHost, loadMap, Match, type SpaceMap } from '../src/index.ts';
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

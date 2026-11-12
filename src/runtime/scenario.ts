// Scenarios: who sits where, what exists at the start, and when the match
// ends. A scenario is checked against its ruleset as strictly as the ruleset
// is checked against the format, and refused with every reason found.

import { versionSatisfies } from '../compile/layers.ts';
import { CompileError, RuleError, type Compiled, type Registry } from '../compile/program.ts';
import { FORMAT_VERSION, type ScenarioDoc } from '../format.ts';
import { createGridHost, noSpace } from '../host/grid.ts';
import type { CellValues, Point, SpaceHost, SpaceMap } from '../lib/functions.ts';
import { schemaIssues, validators, type Issue } from '../schemas.ts';
import { instantiate } from './instantiate.ts';
import { Session, invalid, normalize, type World } from './session.ts';
import { apply, emptyState, type State, type Value, type Write } from './state.ts';

export interface Scenario {
  doc: ScenarioDoc;
  world: World;
  /** The map the host was given; absent when the ruleset has no space. */
  map?: SpaceMap;
  /** The writes that build the starting state, in order. */
  setup: Write[];
  end: { when: Compiled; outcome: { name: string; value: Compiled }[] }[];
  maxDecisions: number;
}

export interface ScenarioOptions {
  /** The engine's space host, built from the map core works out. Absent: the reference grid host. */
  host?: (map: SpaceMap) => SpaceHost;
}

/** The map of a scenario: its cells' layer values, and where the ruleset's space rules say movement and sight are blocked. */
function buildMap(
  registry: Registry, world: World, space: ScenarioDoc['space'], width: number, height: number, issue: (path: string, message: string) => void,
): SpaceMap {
  const defaults = Object.fromEntries([...registry.cellLayers.values()].map((layer) => [layer.name, layer.default])) as CellValues;
  const cells = new Map<string, { x: number; y: number; values: CellValues }>();
  (space?.cells ?? []).forEach((cell, index) => {
    const { at: [x, y], ...given } = cell;
    const path = `space.cells.${index}`;
    if (x < 0 || y < 0 || x >= width || y >= height) return issue(`${path}.at`, `(${x}, ${y}) is off the map`);
    if (cells.has(`${x},${y}`)) return issue(`${path}.at`, `(${x}, ${y}) is given twice`);
    for (const [name, value] of Object.entries(given)) {
      const layer = registry.cellLayers.get(name);
      const reason = layer ? invalid(registry, world, emptyState(), layer.type, value) : 'the ruleset declares no such cell layer';
      if (reason) issue(`${path}.${name}`, reason);
    }
    cells.set(`${x},${y}`, { x, y, values: { ...defaults, ...given } as CellValues });
  });

  const where = (rule: 'blocksMove' | 'blocksSight'): Point[] => {
    const compiled = registry[rule];
    if (!compiled) return [];
    const holds = (values: CellValues) => compiled.run({ cell: registry.cellData(values), tables: registry.tables }) === true;
    const found: Point[] = [];
    try {
      const everywhere = holds(defaults);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const cell = cells.get(`${x},${y}`);
          if (cell ? holds(cell.values) : everywhere) found.push({ x, y });
        }
      }
    } catch (error) {
      issue('space', `${compiled.path}: ${(error as Error).message.split('\n')[0]}`);
    }
    return found;
  };
  return {
    grid: 'square', adjacency: registry.space.adjacency ?? 8, unit: registry.space.unit ?? 1, width, height,
    defaults, cells: [...cells.values()], blocksMove: where('blocksMove'), blocksSight: where('blocksSight'),
  };
}

export function loadScenario(registry: Registry, raw: unknown, options: ScenarioOptions = {}): Scenario {
  const issues: Issue[] = [];
  const issue = (path: string, message: string) => issues.push({ path: `scenario.${path}`, message });
  const validate = validators.scenario;
  if (!validate(raw)) throw new CompileError(schemaIssues('scenario', validate.errors));
  const doc = raw as ScenarioDoc;
  if (doc.format !== FORMAT_VERSION) issue('format', `format ${doc.format} is not supported; this core reads format ${FORMAT_VERSION}`);
  if (doc.ruleset.id !== registry.id || !versionSatisfies(registry.version, doc.ruleset.version)) {
    issue('ruleset', `written for ${doc.ruleset.id}@${doc.ruleset.version}, but the ruleset is ${registry.id}@${registry.version}`);
  }

  const seats = Object.keys(doc.seats);
  if (registry.seats && (seats.length !== registry.seats.length || registry.seats.some((seat) => !seats.includes(seat)))) {
    issue('seats', `the ruleset fixes the seats as ${registry.seats.join(', ')}`);
  }

  let map: SpaceMap | undefined;
  let world: World = { host: noSpace, space: { width: 0, height: 0, unit: 1 }, seats };
  if (registry.space.grid === 'square') {
    const width = doc.space?.width ?? registry.space.width;
    const height = doc.space?.height ?? registry.space.height;
    if (width === undefined || height === undefined) issue('space', 'the ruleset has a grid, so the scenario must give its width and height');
    else if ((registry.space.width ?? width) !== width || (registry.space.height ?? height) !== height) issue('space', 'the ruleset fixes the grid size');
    else {
      const before = issues.length;
      map = buildMap(registry, world, doc.space, width, height, issue);
      // A refused map is never handed to a host.
      const host = issues.length > before ? noSpace : (options.host ?? createGridHost)(map);
      world = { host, space: { width, height, unit: map.unit }, seats };
    }
  } else if (doc.space) issue('space', 'the ruleset declares no space');

  const setup: Write[] = [];
  let state: State = emptyState();
  const write = (event: Write) => {
    setup.push(event);
    state = apply(state, event);
  };

  for (const name of Object.keys(doc.game ?? {})) {
    if (!registry.globals.has(name)) issue(`game.${name}`, 'the ruleset declares no such global');
  }
  for (const spec of registry.globals.values()) {
    const value = doc.game && spec.name in doc.game ? normalize(spec.type, doc.game[spec.name]) : spec.default;
    if (value === undefined) issue(`game.${spec.name}`, 'the ruleset gives no default, so the scenario must set it');
    else {
      const reason = invalid(registry, world, state, spec.type, value);
      if (reason) issue(`game.${spec.name}`, reason);
      else write({ t: 'global', field: spec.name, value: value as Value });
    }
  }

  (doc.entities ?? []).forEach((entity, index) => {
    const id = entity.id ?? `${entity.kind}#${state.nextId}`;
    try {
      write({ t: 'create', id, kind: entity.kind, fields: instantiate(registry, world, state, entity.kind, id, entity.fields ?? {}) });
    } catch (error) {
      if (!(error instanceof RuleError)) throw error;
      issue(`entities.${index}`, error.message);
    }
  });

  (doc.links ?? []).forEach((link, index) => {
    const relation = registry.relations.get(link.rel);
    if (!relation) return issue(`links.${index}.rel`, `unknown relation "${link.rel}"`);
    if (state.entities[link.from]?.kind !== relation.from) return issue(`links.${index}.from`, `"${link.from}" is not an existing ${relation.from}`);
    if (state.entities[link.to]?.kind !== relation.to) return issue(`links.${index}.to`, `"${link.to}" is not an existing ${relation.to}`);
    write({ t: 'link', rel: link.rel, from: link.from, to: link.to });
  });

  if (issues.length === 0) {
    const session = new Session(registry, state, world);
    for (const id of Object.keys(state.entities)) {
      try {
        for (const message of session.failedChecks(id)) issue(`entities.${id}`, message);
      } catch (error) {
        issue(`entities.${id}`, (error as Error).message);
      }
    }
  }

  const end = (doc.end ?? []).map((condition, index) => {
    const report: Issue[] = [];
    const when = registry.compileExpr(condition.when, new Map(), `scenario.end.${index}.when`, report, ['bool']);
    const outcome = Object.entries(condition.outcome).map(([name, source]) => ({
      name, value: registry.compileExpr(source, new Map(), `scenario.end.${index}.outcome.${name}`, report),
    }));
    issues.push(...report);
    return { when, outcome };
  });

  if (issues.length > 0) throw new CompileError(issues);
  return { doc, world, map, end, setup, maxDecisions: doc.limits?.maxDecisions ?? 10000 };
}

// Maps: the playing environment. A ruleset's `space` declares what a map is
// (the grid, what each cell holds, what blocks, what a map must be); a map is
// one such place, with a size, a value for every cell, and named places. It
// is written as a document of its own or inline in a scenario, and either way
// it is checked against the ruleset and worked out into the plain data a host
// is given. A map is never changed: what play writes is laid over it.

import { versionSatisfies } from '../compile/layers.ts';
import { CompileError, type Registry } from '../compile/program.ts';
import { FORMAT_VERSION, type MapDoc, type MapPlaces } from '../format.ts';
import type { CellValues, Point, SpaceMap } from '../lib/functions.ts';
import { schemaIssues, validators, type Issue } from '../schemas.ts';
import { invalid, type World } from './session.ts';
import { emptyState } from './state.ts';

/** One cell's given layer values, and where in its document they were written. */
export interface GivenCell {
  x: number;
  y: number;
  values: Record<string, unknown>;
  path: string;
}

type Report = (path: string, message: string) => void;

// Layer values are checked as literals: no state, no host, no seats.
const nowhere: World = { host: undefined as never, space: { width: 0, height: 0, unit: 1 }, seats: [] };

const key = (cell: Point) => `${cell.x},${cell.y}`;
const rowOrder = (a: Point, b: Point) => a.y - b.y || a.x - b.x;

/** Whether one of the ruleset's two space rules holds for a cell with these values. */
const blocks = (registry: Registry, rule: 'blocksMove' | 'blocksSight', values: CellValues): boolean =>
  registry[rule]?.run({ cell: registry.cellData(values), tables: registry.tables }) === true;

/** What a map is given, beyond its size: the cells' values and the named places. */
export interface MapContent {
  cells?: GivenCell[];
  places?: MapPlaces;
  /** Where `places` was written, for a refusal. */
  placesPath?: string;
}

/**
 * Checks a map against the ruleset's `space` and works it out as the plain
 * data a host is given: the size against the ruleset's bounds, each cell
 * against its layers and checks, the places, and where the ruleset's two
 * rules say movement and sight are blocked.
 */
export function buildMap(registry: Registry, width: number, height: number, content: MapContent, issue: Report, id?: string): SpaceMap {
  const gridded = registry.space.grid === 'square';
  const defaults = Object.fromEntries([...registry.cellLayers.values()].map((layer) => [layer.name, layer.default])) as CellValues;
  const cells = new Map<string, { x: number; y: number; values: CellValues }>();
  for (const { x, y, values, path } of content.cells ?? []) {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      issue(`${path}.at`, `(${x}, ${y}) is off the map`);
      continue;
    }
    if (cells.has(`${x},${y}`)) {
      issue(`${path}.at`, `(${x}, ${y}) is given twice`);
      continue;
    }
    let sound = true;
    for (const [name, value] of Object.entries(values)) {
      const layer = registry.cellLayers.get(name);
      const reason = layer ? invalid(registry, nowhere, emptyState(), layer.type, value) : 'the ruleset declares no such cell layer';
      if (reason) issue(`${path}.${name}`, reason);
      sound &&= !reason;
    }
    const whole = { ...defaults, ...values } as CellValues;
    // A check reads typed values, so a cell that is already refused is not checked.
    if (sound) {
      try {
        for (const message of registry.cellFails(whole)) issue(path, message);
      } catch (error) {
        issue(path, (error as Error).message.split('\n')[0]);
      }
    }
    cells.set(`${x},${y}`, { x, y, values: whole });
  }

  const places: SpaceMap['places'] = {};
  const at = content.placesPath ?? 'places';
  for (const [name, place] of Object.entries(content.places ?? {})) {
    const [x, y] = place.at;
    const [w, h] = place.size ?? [0, 0];
    // On a grid a place is a cell, or a block of cells; on a plane it is a point, or a rectangle.
    if (gridded && ![x, y, w, h].every(Number.isInteger)) issue(`${at}.${name}`, 'a place on a grid is given in whole cells');
    else if (x < 0 || y < 0 || x + w > width || y + h > height || (gridded && !place.size && (x >= width || y >= height))) {
      issue(`${at}.${name}`, 'is off the map');
    } else places[name] = place.size ? { x, y, width: w, height: h } : { x, y };
  }
  for (const name of registry.space.places ?? []) {
    if (!(name in (content.places ?? {}))) issue(at, `the ruleset needs every map to have a place called "${name}"`);
  }

  const where = (rule: 'blocksMove' | 'blocksSight'): Point[] => {
    if (!registry[rule]) return [];
    const found: Point[] = [];
    try {
      const everywhere = blocks(registry, rule, defaults);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const cell = cells.get(`${x},${y}`);
          if (cell ? blocks(registry, rule, cell.values) : everywhere) found.push({ x, y });
        }
      }
    } catch (error) {
      issue('space', `${registry[rule]!.path}: ${(error as Error).message.split('\n')[0]}`);
    }
    return found;
  };
  return {
    ...(id === undefined ? {} : { id }),
    grid: registry.space.grid, adjacency: registry.space.adjacency ?? 8, corners: registry.space.corners ?? 'open', unit: registry.space.unit ?? 1,
    width, height, defaults, cells: [...cells.values()], blocksMove: where('blocksMove'), blocksSight: where('blocksSight'), places,
  };
}

/**
 * A map with what play has changed laid over it: the overlay's layer values
 * replace the map's, cell by cell, and the two blocking rules are worked out
 * again for the cells that changed. The map given is left as it was.
 */
export function patchMap(registry: Registry, map: SpaceMap, overlay: Record<string, Record<string, unknown>>): SpaceMap {
  const cells = new Map(map.cells.map((cell) => [key(cell), cell]));
  const moves = new Map(map.blocksMove.map((cell) => [key(cell), cell]));
  const sights = new Map(map.blocksSight.map((cell) => [key(cell), cell]));
  for (const [name, written] of Object.entries(overlay)) {
    const [x, y] = name.split(',').map(Number);
    const cell = { x, y, values: { ...(cells.get(name)?.values ?? map.defaults), ...written } as CellValues };
    cells.set(name, cell);
    for (const [rule, held] of [['blocksMove', moves], ['blocksSight', sights]] as const) {
      if (blocks(registry, rule, cell.values)) held.set(name, { x, y });
      else held.delete(name);
    }
  }
  return {
    ...map, cells: [...cells.values()],
    blocksMove: [...moves.values()].sort(rowOrder), blocksSight: [...sights.values()].sort(rowOrder),
  };
}

/** A `cells` list as given cells. Each entry is `{ at: [x, y], <layer>: <value>, ... }`. */
export const listedCells = (cells: ({ at: [number, number] } & Record<string, unknown>)[] | undefined, path: string): GivenCell[] =>
  (cells ?? []).map((cell, index) => {
    const { at: [x, y], ...values } = cell;
    return { x, y, values, path: `${path}.${index}` };
  });

/** Whether a map of this size is one the ruleset can be played on; reports why not. */
export function fitsRuleset(registry: Registry, width: number, height: number, issue: Report, path: string): boolean {
  const { size } = registry.space;
  const [least, most] = [size?.min ?? [1, 1], size?.max ?? [Infinity, Infinity]];
  if (!registry.hasSpace) issue(path, 'the ruleset declares no space');
  else if ((registry.space.width ?? width) !== width || (registry.space.height ?? height) !== height) issue(path, 'the ruleset fixes the grid size');
  else if (width < least[0] || height < least[1]) issue(path, `a map of this ruleset is at least ${least[0]} by ${least[1]}; this one is ${width} by ${height}`);
  else if (width > most[0] || height > most[1]) issue(path, `a map of this ruleset is at most ${most[0]} by ${most[1]}; this one is ${width} by ${height}`);
  else return true;
  return false;
}

/**
 * Loads a map document against a compiled ruleset: the map as the plain data
 * a host is given, or a `CompileError` with every reason it was refused.
 */
export function loadMap(registry: Registry, raw: unknown): SpaceMap {
  const validate = validators.map;
  if (!validate(raw)) throw new CompileError(schemaIssues('map', validate.errors));
  const doc = raw as MapDoc;
  const issues: Issue[] = [];
  const issue: Report = (path, message) => issues.push({ path: `map.${path}`, message });
  if (doc.format !== FORMAT_VERSION) issue('format', `format ${doc.format} is not supported; this core reads format ${FORMAT_VERSION}`);
  if (doc.ruleset.id !== registry.id || !versionSatisfies(registry.version, doc.ruleset.version)) {
    issue('ruleset', `written for ${doc.ruleset.id}@${doc.ruleset.version}, but the ruleset is ${registry.id}@${registry.version}`);
  }

  // The picture: one string per row, top row first, one symbol per cell.
  const given: GivenCell[] = [];
  const rows = doc.rows ?? [];
  if (registry.hasSpace && registry.space.grid === 'none') {
    for (const part of ['rows', 'legend', 'cells'] as const) {
      if (doc[part]) issue(part, 'the ruleset has no grid, so its maps have no cells: give a width, a height, and places');
    }
  }
  if (doc.rows && !doc.legend) issue('legend', 'rows need a legend that says what each symbol holds');
  if (doc.legend && !doc.rows) issue('rows', 'a legend is for rows, and there are none');
  rows.forEach((row, y) => {
    const symbols = [...row];
    if (symbols.length !== [...rows[0]].length) issue(`rows.${y}`, `is ${symbols.length} cells wide, but the first row is ${[...rows[0]].length}`);
    symbols.forEach((symbol, x) => {
      const values = doc.legend?.[symbol];
      if (!values) {
        if (doc.legend) issue(`rows.${y}`, `"${symbol}" at column ${x} is not in the legend`);
      } else if (Object.keys(values).length > 0) given.push({ x, y, values, path: `legend.${symbol}` });
    });
  });

  const width = doc.width ?? (doc.rows ? [...rows[0]].length : undefined);
  const height = doc.height ?? (doc.rows ? rows.length : undefined);
  if (width === undefined || height === undefined) issue('rows', 'a map gives rows, or a width and a height');
  else if (doc.rows && (width !== [...rows[0]].length || height !== rows.length)) {
    issue('rows', `the rows are ${[...rows[0]].length} by ${rows.length}, but width and height say ${width} by ${height}`);
  } else if (fitsRuleset(registry, width, height, issue, 'ruleset') && issues.length === 0) {
    // A symbol used many times is one mistake, not many: report each legend entry once.
    const seen = new Set<string>();
    const once: Report = (path, message) => {
      if (!seen.has(`${path}: ${message}`)) issue(path.replace(/^(legend\.[^.]+)\.at$/, '$1'), message);
      seen.add(`${path}: ${message}`);
    };
    // A listed cell overrides the picture, so the picture's value for that cell is dropped first.
    const listed = listedCells(doc.cells, 'cells');
    const over = new Set(listed.map((cell) => `${cell.x},${cell.y}`));
    const cells = [...given.filter((cell) => !over.has(`${cell.x},${cell.y}`)), ...listed];
    const map = buildMap(registry, width, height, { cells, places: doc.places }, once, doc.map.id);
    if (issues.length === 0) return map;
  }
  throw new CompileError(issues);
}

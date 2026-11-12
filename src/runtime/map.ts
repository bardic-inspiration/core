// Maps: the playing environment. A ruleset's `space` declares what a map is
// (the grid, what each cell holds, what blocks); a map is one such place,
// with a size and a value for every cell. It is written as a document of its
// own or inline in a scenario, and either way it is checked against the
// ruleset and worked out into the plain data a host is given.

import { versionSatisfies } from '../compile/layers.ts';
import { CompileError, type Registry } from '../compile/program.ts';
import { FORMAT_VERSION, type MapDoc } from '../format.ts';
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

/** Checks the given cells against the ruleset's layers and works out where its space rules say movement and sight are blocked. */
export function buildMap(registry: Registry, width: number, height: number, given: GivenCell[], issue: Report, id?: string): SpaceMap {
  const defaults = Object.fromEntries([...registry.cellLayers.values()].map((layer) => [layer.name, layer.default])) as CellValues;
  const cells = new Map<string, { x: number; y: number; values: CellValues }>();
  for (const { x, y, values, path } of given) {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      issue(`${path}.at`, `(${x}, ${y}) is off the map`);
      continue;
    }
    if (cells.has(`${x},${y}`)) {
      issue(`${path}.at`, `(${x}, ${y}) is given twice`);
      continue;
    }
    for (const [name, value] of Object.entries(values)) {
      const layer = registry.cellLayers.get(name);
      const reason = layer ? invalid(registry, nowhere, emptyState(), layer.type, value) : 'the ruleset declares no such cell layer';
      if (reason) issue(`${path}.${name}`, reason);
    }
    cells.set(`${x},${y}`, { x, y, values: { ...defaults, ...values } as CellValues });
  }

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
    ...(id === undefined ? {} : { id }),
    grid: 'square', adjacency: registry.space.adjacency ?? 8, corners: registry.space.corners ?? 'open', unit: registry.space.unit ?? 1,
    width, height, defaults, cells: [...cells.values()], blocksMove: where('blocksMove'), blocksSight: where('blocksSight'),
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
  if (registry.space.grid !== 'square') issue(path, 'the ruleset declares no space');
  else if ((registry.space.width ?? width) !== width || (registry.space.height ?? height) !== height) issue(path, 'the ruleset fixes the grid size');
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
    const map = buildMap(registry, width, height, [...given.filter((cell) => !over.has(`${cell.x},${cell.y}`)), ...listed], once, doc.map.id);
    if (issues.length === 0) return map;
  }
  throw new CompileError(issues);
}

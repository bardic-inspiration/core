// Level one of the kit: the standard function library every expression can
// call. Pure math and list helpers, cell arithmetic, and the named host
// functions through which expressions reach spatial facts.
//
// CEL integers are BigInt, and `/` truncates toward zero. Rulesets that round
// down, as 5e does, say so with `floorDiv` (DECISIONS.md D7).

import type { Environment } from '@marcbachmann/cel-js';

/** A grid cell as expressions see it. State stores the same thing as `{ x, y }` numbers. */
export class Cell {
  readonly x: bigint;
  readonly y: bigint;
  constructor(x: bigint, y: bigint) {
    this.x = x;
    this.y = y;
  }
}

export type Point = { x: number; y: number };

/** One cell's layer values: plain numbers, booleans, and strings, one per declared layer. */
export type CellValues = Record<string, number | boolean | string>;

/**
 * The map a host answers about. Core works it out from the ruleset's `space`
 * and the scenario's, and hands it to the host as plain data: the host never
 * evaluates a rule.
 */
export interface SpaceMap {
  /** The map document's id; absent when the map was written inline in a scenario. */
  id?: string;
  grid: 'square';
  /** Whether diagonal neighbours are adjacent (8) or not (4). */
  adjacency: 4 | 8;
  /** `closed`: a diagonal step past the corner of a cell that blocks movement is not a step to a neighbour. */
  corners: 'open' | 'closed';
  /** Game units per cell. Distances and ranges are in these units. */
  unit: number;
  width: number;
  height: number;
  /** The layer values of every cell not listed in `cells`. */
  defaults: CellValues;
  /** The cells the scenario gives values to, each with every layer filled in. */
  cells: { x: number; y: number; values: CellValues }[];
  /** The cells the ruleset's `space.blocksMove` holds for. */
  blocksMove: Point[];
  /** The cells the ruleset's `space.blocksSight` holds for. */
  blocksSight: Point[];
}

/**
 * What the engine must answer about space. Core specifies these; the engine
 * (or `host/grid.ts`, for headless play) implements them. The contract, with
 * units, ordering, and edge cases, is `docs/host.md`. Every function is pure:
 * the same map and arguments always give the same answer, in the same order.
 */
export interface SpaceHost {
  /** True when the cell is on the map and does not block movement: a place something can be. */
  inBounds(cell: Point): boolean;
  /** The distance between two cells in game units, by the grid's adjacency. Ignores what lies between. */
  distance(a: Point, b: Point): number;
  /** The in-bounds cells adjacent to `cell`, without `cell` itself, in row order. With closed corners, a diagonal past a blocking cell is left out. */
  neighbors(cell: Point): Point[];
  /** The in-bounds cells at most `range` game units from `cell`, itself included when in bounds, in row order. */
  cellsWithin(cell: Point, range: number): Point[];
  /** False when a cell that blocks sight lies strictly between the two cells. */
  lineOfSight(a: Point, b: Point): boolean;
  /** The layer values of a cell on the map, every layer present. Core never asks about a cell off the map. */
  cellAt(cell: Point): CellValues;
}

/** One question an expression put to the host, and its answer. */
export interface HostCall {
  fn: keyof SpaceHost;
  args: (Point | number)[];
  result: boolean | number | Point[] | CellValues;
}

/** A host that answers as `host` does and notes every call in `into`. */
export function tracedHost(host: SpaceHost, into: HostCall[]): SpaceHost {
  const wrap = <K extends keyof SpaceHost>(fn: K): SpaceHost[K] =>
    ((...args: (Point | number)[]) => {
      const result = (host[fn] as (...given: (Point | number)[]) => HostCall['result'])(...args);
      into.push({ fn, args, result });
      return result;
    }) as SpaceHost[K];
  return {
    inBounds: wrap('inBounds'), distance: wrap('distance'), neighbors: wrap('neighbors'),
    cellsWithin: wrap('cellsWithin'), lineOfSight: wrap('lineOfSight'), cellAt: wrap('cellAt'),
  };
}

export const plain = (cell: Cell): Point => ({ x: Number(cell.x), y: Number(cell.y) });
const lift = (cell: Point) => new Cell(BigInt(cell.x), BigInt(cell.y));
const abs = (n: bigint) => (n < 0n ? -n : n);

export function floorDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b !== 0n && (a < 0n) !== (b < 0n) ? quotient - 1n : quotient;
}

function extreme<T extends bigint | number>(list: T[], pick: (a: T, b: T) => boolean, name: string): T {
  if (list.length === 0) throw new Error(`${name}() of an empty list`);
  return list.reduce((best, item) => (pick(item, best) ? item : best));
}

/** Stable sort of `items` by the parallel list of integer keys, ascending. */
function sortBy<T>(items: T[], keys: bigint[]): T[] {
  if (items.length !== keys.length) throw new Error('sortBy() needs one key per item');
  return items
    .map((item, index) => ({ item, key: keys[index], index }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
    .map((entry) => entry.item);
}

/**
 * Registers the library. `host` returns the space host of the evaluation in
 * progress. `cellAt` is registered by the compiler, which generates its
 * return type from the ruleset's cell layers.
 */
export function registerFunctions(env: Environment, host: () => SpaceHost): void {
  const fn = (signature: string, handler: (...args: any[]) => unknown) => env.registerFunction(signature, handler as never);
  env.registerType('Cell', { ctor: Cell, fields: { x: 'int', y: 'int' } } as never);

  // Integer and decimal math.
  fn('floorDiv(int, int): int', floorDiv);
  fn('ceilDiv(int, int): int', (a: bigint, b: bigint) => -floorDiv(-a, b));
  fn('abs(int): int', abs);
  fn('abs(double): double', Math.abs);
  fn('sign(int): int', (a: bigint) => (a > 0n ? 1n : a < 0n ? -1n : 0n));
  fn('min(int, int): int', (a: bigint, b: bigint) => (a < b ? a : b));
  fn('max(int, int): int', (a: bigint, b: bigint) => (a > b ? a : b));
  fn('min(double, double): double', Math.min);
  fn('max(double, double): double', Math.max);
  fn('clamp(int, int, int): int', (n: bigint, low: bigint, high: bigint) => (n < low ? low : n > high ? high : n));
  fn('floor(double): int', (a: number) => BigInt(Math.floor(a)));
  fn('ceil(double): int', (a: number) => BigInt(Math.ceil(a)));
  fn('round(double): int', (a: number) => BigInt(Math.floor(a + 0.5)));

  // Lists.
  fn('list<int>.sum(): int', (list: bigint[]) => list.reduce((a, b) => a + b, 0n));
  fn('list<double>.sum(): double', (list: number[]) => list.reduce((a, b) => a + b, 0));
  fn('list<int>.min(): int', (list: bigint[]) => extreme(list, (a, b) => a < b, 'min'));
  fn('list<int>.max(): int', (list: bigint[]) => extreme(list, (a, b) => a > b, 'max'));
  fn('list<double>.min(): double', (list: number[]) => extreme(list, (a, b) => a < b, 'min'));
  fn('list<double>.max(): double', (list: number[]) => extreme(list, (a, b) => a > b, 'max'));
  fn('list<A>.first(): A', (list: unknown[]) => {
    if (list.length === 0) throw new Error('first() of an empty list');
    return list[0];
  });
  fn('sortBy(list<A>, list<int>): list<A>', sortBy);
  fn('list<int>.distinct(): list<int>', (list: bigint[]) => [...new Set(list)]);
  fn('list<string>.distinct(): list<string>', (list: string[]) => [...new Set(list)]);
  fn('range(int): list<int>', (n: bigint) => Array.from({ length: Number(n) }, (_, i) => BigInt(i)));

  // Cell arithmetic: core's own, no host needed.
  env.registerOperator('Cell == Cell', ((a: Cell, b: Cell) => a.x === b.x && a.y === b.y) as never);
  fn('cell(int, int): Cell', (x: bigint, y: bigint) => new Cell(x, y));
  fn('Cell.offset(int, int): Cell', (c: Cell, dx: bigint, dy: bigint) => new Cell(c.x + dx, c.y + dy));
  fn('Cell.mid(Cell): Cell', (a: Cell, b: Cell) => new Cell((a.x + b.x) / 2n, (a.y + b.y) / 2n));

  // Host functions: spatial facts the engine answers.
  fn('inBounds(Cell): bool', (c: Cell) => host().inBounds(plain(c)));
  fn('distance(Cell, Cell): int', (a: Cell, b: Cell) => BigInt(host().distance(plain(a), plain(b))));
  fn('neighbors(Cell): list<Cell>', (c: Cell) => host().neighbors(plain(c)).map(lift));
  fn('cellsWithin(Cell, int): list<Cell>', (c: Cell, range: bigint) => host().cellsWithin(plain(c), Number(range)).map(lift));
  fn('lineOfSight(Cell, Cell): bool', (a: Cell, b: Cell) => host().lineOfSight(plain(a), plain(b)));
}

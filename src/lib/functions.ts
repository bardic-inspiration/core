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

/**
 * What the engine must answer about space. Core specifies these; the engine
 * (or `host/grid.ts`, for headless play) implements them. Cells and distances
 * are plain numbers here; distances are in the ruleset's units.
 */
export interface SpaceHost {
  inBounds(cell: { x: number; y: number }): boolean;
  distance(a: { x: number; y: number }, b: { x: number; y: number }): number;
  neighbors(cell: { x: number; y: number }): { x: number; y: number }[];
  cellsWithin(cell: { x: number; y: number }, range: number): { x: number; y: number }[];
  lineOfSight(a: { x: number; y: number }, b: { x: number; y: number }): boolean;
}

const plain = (cell: Cell) => ({ x: Number(cell.x), y: Number(cell.y) });
const lift = (cell: { x: number; y: number }) => new Cell(BigInt(cell.x), BigInt(cell.y));
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

/** Registers the library. `host` returns the space host of the evaluation in progress. */
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

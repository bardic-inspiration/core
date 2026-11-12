// The reference space host: a bounded square grid. The engine brings its own
// host with real geometry; this one exists so core can play headless, and as
// the worked example of the contract in docs/host.md.

import type { CellValues, Point, SpaceHost, SpaceMap } from '../lib/functions.ts';

const key = (cell: Point) => `${cell.x},${cell.y}`;

export function createGridHost(map: SpaceMap): SpaceHost {
  const { unit, width, height } = map;
  const diagonal = map.adjacency === 8;
  const blocksMove = new Set(map.blocksMove.map(key));
  const blocksSight = new Set(map.blocksSight.map(key));
  const values = new Map(map.cells.map((cell) => [key(cell), cell.values]));
  const open = (cell: Point) =>
    cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height && !blocksMove.has(key(cell));
  const steps = (a: Point, b: Point) => {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return diagonal ? Math.max(dx, dy) : dx + dy;
  };
  const cellsWithin = (cell: Point, range: number): Point[] => {
    const reach = Math.floor(range / unit);
    const cells: Point[] = [];
    for (let y = cell.y - reach; y <= cell.y + reach; y++) {
      for (let x = cell.x - reach; x <= cell.x + reach; x++) {
        const candidate = { x, y };
        if (open(candidate) && steps(cell, candidate) <= reach) cells.push(candidate);
      }
    }
    return cells;
  };

  return {
    inBounds: open,
    distance: (a, b) => steps(a, b) * unit,
    neighbors: (cell) => cellsWithin(cell, unit).filter((other) => other.x !== cell.x || other.y !== cell.y),
    cellsWithin,
    // Walks the line between the two cells; a sight-blocking cell strictly between them breaks it.
    lineOfSight: (a, b) => {
      const count = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      for (let i = 1; i < count; i++) {
        const x = Math.round(a.x + ((b.x - a.x) * i) / count);
        const y = Math.round(a.y + ((b.y - a.y) * i) / count);
        if (blocksSight.has(`${x},${y}`)) return false;
      }
      return true;
    },
    cellAt: (cell): CellValues => values.get(key(cell)) ?? map.defaults,
  };
}

/** The host of a ruleset with no space: every question is an error upstream, so this is never asked. */
export const noSpace: SpaceHost = {
  inBounds: () => false, distance: () => 0, neighbors: () => [], cellsWithin: () => [], lineOfSight: () => false,
  cellAt: () => ({}),
};

/**
 * Every answer on which `host` differs from `reference`, asked over the whole
 * map and a margin around it. Empty when the host implements the contract as
 * the reference does. An engine runs its own host through this.
 */
export function compareHosts(host: SpaceHost, reference: SpaceHost, map: SpaceMap, ranges: number[] = [0, map.unit, map.unit * 3]): string[] {
  const differences: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const ask = <K extends keyof SpaceHost>(fn: K, ...args: Parameters<SpaceHost[K]>) => {
    const call = (from: SpaceHost) => (from[fn] as (...given: unknown[]) => unknown)(...args);
    const [got, want] = [call(host), call(reference)];
    if (!same(got, want)) differences.push(`${fn}(${args.map((arg) => JSON.stringify(arg)).join(', ')}): ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
  };
  const cells: Point[] = [];
  for (let y = -1; y <= map.height; y++) for (let x = -1; x <= map.width; x++) cells.push({ x, y });
  const onMap = (cell: Point) => cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height;
  for (const a of cells) {
    ask('inBounds', a);
    ask('neighbors', a);
    if (onMap(a)) ask('cellAt', a);
    for (const range of ranges) ask('cellsWithin', a, range);
    for (const b of cells) {
      ask('distance', a, b);
      ask('lineOfSight', a, b);
    }
  }
  return differences;
}

// The reference space host: a bounded square grid. The engine will bring its
// own host with real geometry; this one exists so core can play headless.

import type { SpaceDoc } from '../format.ts';
import type { SpaceHost } from '../lib/functions.ts';

type Point = { x: number; y: number };

export interface GridMap {
  width: number;
  height: number;
  /** Cells nothing can enter or see through. */
  blocked?: [number, number][];
}

export function createGridHost(space: SpaceDoc, map: GridMap): SpaceHost {
  const unit = space.unit ?? 1;
  const diagonal = (space.adjacency ?? 8) === 8;
  const blocked = new Set((map.blocked ?? []).map(([x, y]) => `${x},${y}`));
  const open = (cell: Point) =>
    cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height && !blocked.has(`${cell.x},${cell.y}`);
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
    // Walks the line between the two cells; a blocked cell strictly between them breaks it.
    lineOfSight: (a, b) => {
      const count = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      for (let i = 1; i < count; i++) {
        const x = Math.round(a.x + ((b.x - a.x) * i) / count);
        const y = Math.round(a.y + ((b.y - a.y) * i) / count);
        if (blocked.has(`${x},${y}`)) return false;
      }
      return true;
    },
  };
}

/** The host of a ruleset with no space: every question is an error upstream, so this is never asked. */
export const noSpace: SpaceHost = {
  inBounds: () => false, distance: () => 0, neighbors: () => [], cellsWithin: () => [], lineOfSight: () => false,
};

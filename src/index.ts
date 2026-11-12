// rpg-core: rulesets as data, one generic runtime. See README.md.

export { FORMAT_VERSION } from './format.ts';
export type * from './format.ts';
export { compile } from './compile/resolve.ts';
export { CompileError, RuleError } from './compile/program.ts';
export type { Registry, AddressInfo } from './compile/program.ts';
export { loadScenario } from './runtime/scenario.ts';
export type { Scenario } from './runtime/scenario.ts';
export { Match } from './runtime/match.ts';
export type { Authored, Decision, Option, Seat, SeatRequest, Snapshot } from './runtime/match.ts';
export { RandomSeat, ReplaySeat, UtilitySeat } from './runtime/seats.ts';
export { apply, emptyState, fold } from './runtime/state.ts';
export type { Entity, GameEvent, State, Value } from './runtime/state.ts';
export { hashSeed, nextRandom, rollDice } from './runtime/rng.ts';
export { createGridHost } from './host/grid.ts';
export type { SpaceHost } from './lib/functions.ts';

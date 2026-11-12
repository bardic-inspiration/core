// core: rulesets as data, one generic runtime. See README.md.
//
// Nothing reachable from here touches Node: it runs as it is in a browser or
// a Web Worker. Reading files is `load.ts`, which is not part of this entry.

export { FORMAT_VERSION } from './format.ts';
export type * from './format.ts';
export { compile } from './compile/resolve.ts';
export { compileBehaviors } from './compile/behaviors.ts';
export type { Behaviors } from './compile/behaviors.ts';
export { CompileError, RuleError } from './compile/program.ts';
export type { Registry, AddressInfo, BehaviorSpec, CellLayerSpec } from './compile/program.ts';
export { compileExpression } from './expression.ts';
export type { Expression, ExpressionOptions, EvaluateOptions } from './expression.ts';
export { loadScenario } from './runtime/scenario.ts';
export type { Scenario, ScenarioOptions } from './runtime/scenario.ts';
export { Match } from './runtime/match.ts';
export type {
  Authored, Candidate, Decision, DomainTrace, Explanation, GateResult, IntentExplanation, Option, Seat, SeatRequest, Snapshot,
} from './runtime/match.ts';
export { RandomSeat, UtilitySeat, bindSeats } from './runtime/seats.ts';
export { replay, fork } from './runtime/replay.ts';
export type { ReplayOptions } from './runtime/replay.ts';
export { apply, emptyState, fold } from './runtime/state.ts';
export type { Entity, GameEvent, State, Value } from './runtime/state.ts';
export { hashSeed, nextRandom, rollDice } from './runtime/rng.ts';
export { hashLog, playMatch, summarize } from './record.ts';
export type { MatchRecord, SeatRecord } from './record.ts';
export { createGridHost, compareHosts } from './host/grid.ts';
export type { CellValues, HostCall, Point, SpaceHost, SpaceMap } from './lib/functions.ts';

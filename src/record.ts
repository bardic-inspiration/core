// A match record: the fixed measurements of one match, worked out from its
// log alone. It is plain data and holds nothing that varies between runs of
// the same seed (no clock, no machine), so a file of records is itself a
// regression check: if a rule or the runtime changes how a match plays, its
// `logHash` changes.

import type { Registry } from './compile/program.ts';
import { Match, type Seat } from './runtime/match.ts';
import { hashSeed } from './runtime/rng.ts';
import type { Scenario } from './runtime/scenario.ts';
import { fold, type GameEvent, type Value } from './runtime/state.ts';

export interface SeatRecord {
  /** What drove the seat: a behavior's name, or `random`. */
  driver: string;
  decisions: number;
  /** How often it chose each intent. */
  intents: Record<string, number>;
}

export interface MatchRecord {
  ruleset: string;
  version: string;
  scenario: string;
  seed: string;
  outcome: Record<string, Value>;
  decisions: number;
  /** Decisions with only one legal intent. */
  forced: number;
  /** Legal intents on offer per decision. */
  options: { mean: number; max: number };
  events: number;
  /** Log entries by type. */
  byType: Record<string, number>;
  signals: Record<string, number>;
  entities: { start: number; end: number; created: number; destroyed: number };
  seats: Record<string, SeatRecord>;
  /** A hash of the whole event log. */
  logHash: string;
}

const count = (into: Record<string, number>, key: string) => {
  into[key] = (into[key] ?? 0) + 1;
};
const sorted = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

/** The hash a record carries for a log. */
export const hashLog = (log: readonly GameEvent[]): string => hashSeed(JSON.stringify(log)).toString(16).padStart(8, '0');

/** The record of a finished match, from its log. `drivers` names what drove each seat. */
export function summarize(registry: Registry, scenario: Scenario, log: readonly GameEvent[], drivers: Record<string, string> = {}): MatchRecord {
  const state = fold(log);
  if (!state.ended) throw new Error('a record is of a match that has ended');
  const first = log[0];
  const setup = scenario.setup.length + 1;
  const seats: Record<string, SeatRecord> = {};
  for (const [id, spec] of Object.entries(scenario.doc.seats)) {
    if (!spec.referee) seats[id] = { driver: drivers[id] ?? 'unknown', decisions: 0, intents: {} };
  }
  const byType: Record<string, number> = {};
  const signals: Record<string, number> = {};
  let created = 0;
  let destroyed = 0;
  let decisions = 0;
  let offered = 0;
  let most = 0;
  let forced = 0;
  log.forEach((event, index) => {
    count(byType, event.t);
    if (event.t === 'signal') count(signals, event.name);
    if (index >= setup && event.t === 'create') created += 1;
    if (event.t === 'destroy') destroyed += 1;
    // A seat's own decision says how many options it had; a referee's ruling does not.
    if (event.t === 'intent' && event.of !== undefined) {
      decisions += 1;
      offered += event.of;
      most = Math.max(most, event.of);
      if (event.of === 1) forced += 1;
      const seat = (seats[event.seat] ??= { driver: drivers[event.seat] ?? 'unknown', decisions: 0, intents: {} });
      seat.decisions += 1;
      count(seat.intents, event.intent);
    }
  });
  return {
    ruleset: registry.id, version: registry.version, scenario: scenario.doc.scenario.id,
    seed: first?.t === 'seed' ? first.seed : '',
    outcome: state.ended,
    decisions, forced,
    options: { mean: decisions === 0 ? 0 : Math.round((offered / decisions) * 100) / 100, max: most },
    events: log.length,
    byType: sorted(byType), signals: sorted(signals),
    entities: { start: log.slice(0, setup).filter((event) => event.t === 'create').length, end: Object.keys(state.entities).length, created, destroyed },
    seats: Object.fromEntries(Object.entries(seats).map(([id, seat]) => [id, { ...seat, intents: sorted(seat.intents) }])),
    logHash: hashLog(log),
  };
}

/** Plays one match to its end with the given drivers, and records it. */
export function playMatch(
  registry: Registry, scenario: Scenario, seed: string | number, seats: Record<string, Seat>,
): { record: MatchRecord; log: GameEvent[]; match: Match } {
  const match = new Match(registry, scenario, seed);
  const { log } = match.run(seats);
  const drivers = Object.fromEntries(Object.entries(seats).map(([id, seat]) => [id, seat.name ?? 'unknown']));
  return { record: summarize(registry, scenario, log, drivers), log, match };
}

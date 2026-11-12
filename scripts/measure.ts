// Plays one match with AI seats and measures it. The record is plain data
// and holds nothing that varies between runs of the same seed (no clock, no
// machine), so a file of records is itself a regression check: if a rule or
// the runtime changes how a match plays, its `logHash` changes.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fold, hashSeed, Match, RandomSeat, UtilitySeat,
  type GameEvent, type Registry, type Scenario, type Seat, type Value,
} from '../src/index.ts';
import { loadRuleset, loadScenarioFile } from '../src/load.ts';

export interface SeatRecord {
  /** The behavior that drove the seat, or `random`. */
  driver: string;
  decisions: number;
  /** How often it chose each intent. */
  intents: Record<string, number>;
}

export interface MatchRecord {
  ruleset: string;
  version: string;
  scenario: string;
  seed: number;
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

export function measure(registry: Registry, scenario: Scenario, seed: number): { record: MatchRecord; log: GameEvent[]; ms: number } {
  const started = performance.now();
  const match = new Match(registry, scenario, seed);
  const drivers: Record<string, Seat> = {};
  const seats: Record<string, SeatRecord> = {};
  for (const [id, spec] of Object.entries(scenario.doc.seats)) {
    if (spec.referee) continue;
    drivers[id] = spec.behavior ? new UtilitySeat(spec.behavior, seed, id) : new RandomSeat(seed, id);
    seats[id] = { driver: spec.behavior ?? 'random', decisions: 0, intents: {} };
  }
  const setup = match.log.length;
  let offered = 0;
  let most = 0;
  let forced = 0;
  for (let decision = match.advance(); decision; decision = match.advance()) {
    const { seat, options } = decision;
    const index = drivers[seat].choose({
      seat, options, state: match.view(seat), scores: (behavior) => match.scores(behavior, seat, options),
    });
    offered += options.length;
    most = Math.max(most, options.length);
    if (options.length === 1) forced += 1;
    seats[seat].decisions += 1;
    count(seats[seat].intents, options[index].intent);
    match.submit(index);
  }
  const { log, state } = match;
  if (JSON.stringify(fold(log)) !== JSON.stringify(state)) throw new Error('folding the log did not give the final state');

  const byType: Record<string, number> = {};
  const signals: Record<string, number> = {};
  let created = 0;
  let destroyed = 0;
  log.forEach((event, index) => {
    count(byType, event.t);
    if (event.t === 'signal') count(signals, event.name);
    if (index >= setup && event.t === 'create') created += 1;
    if (event.t === 'destroy') destroyed += 1;
  });
  const decisions = byType.intent ?? 0;
  const start = log.slice(0, setup).filter((event) => event.t === 'create').length;
  const record: MatchRecord = {
    ruleset: registry.id, version: registry.version, scenario: scenario.doc.scenario.id, seed,
    outcome: state.ended!,
    decisions, forced,
    options: { mean: decisions === 0 ? 0 : Math.round((offered / decisions) * 100) / 100, max: most },
    events: log.length,
    byType: sorted(byType), signals: sorted(signals),
    entities: { start, end: Object.keys(state.entities).length, created, destroyed },
    seats: Object.fromEntries(Object.entries(seats).map(([id, seat]) => [id, { ...seat, intents: sorted(seat.intents) }])),
    logHash: hashSeed(JSON.stringify(log)).toString(16).padStart(8, '0'),
  };
  return { record, log, ms: performance.now() - started };
}

export interface Shipped {
  ruleset: string;
  scenario: string;
  registry: Registry;
  loaded: Scenario;
}

/** Every scenario under `rulesets/`, compiled and loaded. Throws a CompileError if any is refused. */
export function shipped(): Shipped[] {
  const root = fileURLToPath(new URL('../rulesets/', import.meta.url));
  const out: Shipped[] = [];
  for (const ruleset of readdirSync(root).sort()) {
    const registry = loadRuleset(ruleset);
    for (const file of readdirSync(`${root}${ruleset}/scenarios`).sort()) {
      const scenario = file.replace(/\.yaml$/, '');
      out.push({ ruleset, scenario, registry, loaded: loadScenarioFile(registry, ruleset, scenario) });
    }
  }
  return out;
}

/** The extension files of a ruleset, by name. */
export function extensionsOf(ruleset: string): string[] {
  const dir = fileURLToPath(new URL(`../rulesets/${ruleset}/extensions`, import.meta.url));
  try {
    return readdirSync(dir).sort().map((file) => file.replace(/\.yaml$/, ''));
  } catch {
    return [];
  }
}

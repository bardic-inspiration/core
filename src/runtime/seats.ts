// Seat drivers for headless play. A driver keeps no state of its own: when
// it needs chance it draws from its seat's stream, which the match holds
// (`request.pick`), keyed by the match seed and the seat. So the game's dice
// are untouched by how a seat decides, the same seed always gives the same
// match, and a match resumed from a snapshot or forked from a log plays on
// with the streams where they stood.

import { CompileError, type BehaviorSpec } from '../compile/program.ts';
import type { Behaviors } from '../compile/behaviors.ts';
import type { Seat, SeatRequest } from './match.ts';
import type { Scenario } from './scenario.ts';

/** Picks uniformly among the legal intents. */
export class RandomSeat implements Seat {
  readonly name = 'random';
  choose(request: SeatRequest): number {
    return request.pick(request.options.length);
  }
}

/** Utility scoring: takes the option a behavior scores highest, breaking ties at random. */
export class UtilitySeat implements Seat {
  readonly behavior: BehaviorSpec;
  readonly name: string;
  constructor(behavior: BehaviorSpec) {
    this.behavior = behavior;
    this.name = behavior.name;
  }
  choose(request: SeatRequest): number {
    const scores = request.scores(this.behavior);
    const best = Math.max(...scores);
    const top = scores.flatMap((score, index) => (score === best ? [index] : []));
    return top.length === 1 ? top[0] : top[request.pick(top.length)];
  }
}

/**
 * A driver for every seat of a scenario. A seat plays the behavior `bind`
 * gives it, else the one the scenario names, else at random. `bind` is the
 * run's own choice: it is how one scenario is played by different behaviors
 * without editing it. An unknown behavior is refused.
 */
export function bindSeats(scenario: Scenario, behaviors: Behaviors, bind: Record<string, string | Seat> = {}): Record<string, Seat> {
  const issues: { path: string; message: string }[] = [];
  for (const seat of Object.keys(bind)) {
    if (!(seat in scenario.doc.seats)) issues.push({ path: `bind.${seat}`, message: `"${seat}" is not a seat in this scenario` });
  }
  const seats = Object.fromEntries(Object.entries(scenario.doc.seats).map(([id, spec]): [string, Seat] => {
    const chosen = bind[id] ?? spec.behavior;
    if (chosen === undefined) return [id, new RandomSeat()];
    if (typeof chosen !== 'string') return [id, chosen];
    const behavior = behaviors.byName.get(chosen);
    if (!behavior) issues.push({ path: id in bind ? `bind.${id}` : `scenario.seats.${id}.behavior`, message: `unknown behavior "${chosen}"` });
    return [id, behavior ? new UtilitySeat(behavior) : new RandomSeat()];
  }));
  if (issues.length > 0) throw new CompileError(issues);
  return seats;
}

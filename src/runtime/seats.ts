// Seat drivers for headless play. Each has its own random stream, keyed by
// the match seed and the seat, so the game's stream is untouched by how a
// seat decides and the same seed always gives the same match.

import { RuleError } from '../compile/program.ts';
import type { Option, Seat, SeatRequest } from './match.ts';
import { hashSeed, nextRandom } from './rng.ts';
import type { GameEvent } from './state.ts';

class Stream {
  position: number;
  constructor(position: number) {
    this.position = position;
  }
  pick(count: number): number {
    const step = nextRandom(this.position);
    this.position = step.position;
    return Math.floor(step.value * count);
  }
}

const streamFor = (seed: string | number, seat: string) => new Stream(hashSeed(`${seed}|seat|${seat}`));

/** Picks uniformly among the legal intents. */
export class RandomSeat implements Seat {
  private readonly stream: Stream;
  constructor(seed: string | number, seat: string) {
    this.stream = streamFor(seed, seat);
  }
  choose(request: SeatRequest): number {
    return this.stream.pick(request.options.length);
  }
  /** The stream position, to carry across a save. */
  get position(): number {
    return this.stream.position;
  }
  set position(value: number) {
    this.stream.position = value;
  }
}

/** Utility scoring: takes the option a ruleset behavior scores highest, breaking ties at random. */
export class UtilitySeat implements Seat {
  private readonly stream: Stream;
  readonly behavior: string;
  constructor(behavior: string, seed: string | number, seat: string) {
    this.behavior = behavior;
    this.stream = streamFor(seed, seat);
  }
  choose(request: SeatRequest): number {
    const scores = request.scores(this.behavior);
    const best = Math.max(...scores);
    const top = scores.flatMap((score, index) => (score === best ? [index] : []));
    return top.length === 1 ? top[0] : top[this.stream.pick(top.length)];
  }
  get position(): number {
    return this.stream.position;
  }
  set position(value: number) {
    this.stream.position = value;
  }
}

const sameOption = (option: Option, event: { intent: string; params: unknown }) =>
  option.intent === event.intent && JSON.stringify(option.params) === JSON.stringify(event.params);

/**
 * Replays the decisions recorded in a log, in order. One instance drives
 * every seat, since the log interleaves them. A recorded decision that is no
 * longer legal means the rules or the log changed, and is an error.
 */
export class ReplaySeat implements Seat {
  private readonly decisions: Extract<GameEvent, { t: 'intent' }>[];
  private next = 0;
  constructor(log: readonly GameEvent[]) {
    this.decisions = log.filter((event): event is Extract<GameEvent, { t: 'intent' }> => event.t === 'intent' && !event.by);
  }
  choose(request: SeatRequest): number {
    const recorded = this.decisions[this.next++];
    if (!recorded) throw new RuleError('the log has no more decisions to replay');
    const index = recorded.seat === request.seat ? request.options.findIndex((option) => sameOption(option, recorded)) : -1;
    if (index < 0) throw new RuleError(`decision ${this.next - 1} in the log (${recorded.intent}) is not legal here`);
    return index;
  }
}

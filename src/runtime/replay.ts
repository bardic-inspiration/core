// Replay and forking. A log holds everything that came from outside the
// rules: each seat's decisions, and a referee's changes. Replaying puts
// those back through the rules and checks that the rules answer as the log
// says they did, entry for entry. A fork is a replay that stops at a
// decision and hands the match back there, so a different choice can be
// made.

import { RuleError, type Registry } from '../compile/program.ts';
import { Match, type Authored, type Option, type Snapshot } from './match.ts';
import type { Scenario } from './scenario.ts';
import type { GameEvent } from './state.ts';

export interface ReplayOptions {
  /** Stop once the match's log holds this many entries: the `seq` of the entry that would come next. Absent: replay the whole log. */
  until?: number;
  /** A snapshot taken earlier in this same log, to start from instead of the beginning. */
  from?: Snapshot;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameOption = (option: Option, event: { intent: string; params: unknown }) =>
  option.intent === event.intent && same(option.params, event.params);

/** The change a referee authored, read back from the entry it left in the log. */
function authored(event: GameEvent): Authored {
  switch (event.t) {
    case 'create': return { create: { kind: event.kind, id: event.id, fields: event.fields } };
    case 'set': return { set: { id: event.id, field: event.field, key: event.key, value: event.value } };
    case 'destroy': return { destroy: event.id };
    case 'link': return { link: { rel: event.rel, from: event.from, to: event.to } };
    case 'unlink': return { unlink: { rel: event.rel, from: event.from, to: event.to } };
    default: throw new RuleError(`entry ${event.seq} (${event.t}) is not a change a referee can author`);
  }
}

/**
 * Replays a log through the rules: every decision is chosen again, and every
 * referee change and ruling is made again, each where the log has it. The
 * match that comes back has that log. If the rules would now write anything
 * else, or a recorded decision is no longer legal, it is an error naming the
 * entry: the rules or the log changed.
 */
export function replay(registry: Registry, scenario: Scenario, log: readonly GameEvent[], options: ReplayOptions = {}): Match {
  const until = options.until ?? log.length;
  if (until < 0 || until > log.length) throw new RuleError(`the log has no entry ${until}`);
  const first = log[0];
  if (first?.t !== 'seed') throw new RuleError('a log starts with its seed');
  const match = options.from ? Match.restore(registry, scenario, options.from) : new Match(registry, scenario, first.seed);
  if (match.log.length > until) throw new RuleError(`the snapshot is already past entry ${until}`);

  let checked = 0;
  /** Everything the match has logged so far must be what the log holds. */
  const check = () => {
    for (; checked < match.log.length; checked++) {
      if (checked >= log.length || !same(match.log[checked], log[checked])) {
        throw new RuleError(`the replay parts from the log at entry ${checked}: the rules wrote ${JSON.stringify(match.log[checked])}, the log has ${JSON.stringify(log[checked] ?? null)}`);
      }
    }
  };
  check();

  let decision = null as ReturnType<Match['advance']>;
  while (match.log.length < until) {
    const at = match.log.length;
    const next = log[at];
    if (next.by && next.t === 'intent') {
      match.adjudicate(next.by, next.seat, next.intent, next.params);
      decision = null;
    } else if (next.by) {
      // One call to `author` is one run of entries by the same referee.
      let end = at;
      while (end < until && log[end].by === next.by && log[end].t !== 'intent') end++;
      match.author(next.by, log.slice(at, end).map(authored));
      decision = null;
    } else if (decision) {
      if (next.t !== 'intent') throw new RuleError(`the replay parts from the log at entry ${at}: seat "${decision.seat}" is to decide, the log has ${JSON.stringify(next)}`);
      const index = next.seat === decision.seat ? decision.options.findIndex((option) => sameOption(option, next)) : -1;
      if (index < 0) throw new RuleError(`decision ${at} in the log (${next.intent}) is not legal here`);
      match.submit(index, next.rng);
      decision = null;
    } else {
      decision = match.advance();
      if (!decision && match.log.length === at) throw new RuleError(`the match ended, but the log goes on at entry ${at}`);
    }
    check();
  }
  return match;
}

/**
 * The match as it stood when the decision at `seq` was about to be made:
 * call `advance` for the decision, and choose differently. Every seat's
 * stream stands where it stood then, so choosing the same again plays out
 * the same match. `options.from` starts from a snapshot of the same log.
 */
export function fork(registry: Registry, scenario: Scenario, log: readonly GameEvent[], seq: number, options: { from?: Snapshot } = {}): Match {
  if (log[seq]?.t !== 'intent') throw new RuleError(`entry ${seq} is not a decision; a match forks only where a seat or a referee chose`);
  return replay(registry, scenario, log, { until: seq, from: options.from });
}

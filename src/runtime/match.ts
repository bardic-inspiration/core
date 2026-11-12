// The one generic machinery. A match is a state, a log, and a stack of
// frames; the ruleset's `flow` is the bottom frame. `advance` executes
// effects until a prompt needs a seat's decision or the match ends, so a
// seat's turn and a mid-resolution reaction are the same thing: a prompt
// frame on the stack. The stack is plain data, so a match can be saved at any
// decision and resumed.

import { RuleError, type Compiled, type Fx, type IntentSpec, type Registry, type SetTarget } from '../compile/program.ts';
import type { ValueType } from '../types.ts';
import { instantiate } from './instantiate.ts';
import { hashSeed, rollDice } from './rng.ts';
import type { Scenario } from './scenario.ts';
import { Session, dehydrate, invalid, viewOf } from './session.ts';
import { apply, emptyState, type GameEvent, type Marker, type State, type Value, type Write } from './state.ts';

interface Var {
  t: ValueType;
  v: Value;
}
type Vars = Record<string, Var>;
/** Where an effect sits: its block and index. */
type At = [block: string, index: number];

type Frame =
  | { f: 'block'; block: string; pc: number; vars: Vars; boundary: boolean; returns?: { local: string; returned: string }[] }
  | { f: 'each'; at: At; items: Value[]; i: number }
  | { f: 'while'; at: At }
  | { f: 'emit'; signal: string; args: Vars; i: number }
  | { f: 'prompt'; at: At; seat: string; given: Vars; asked: boolean; finished: boolean };

/** One legal intent a seat may choose: every param bound, every gate passed. */
export interface Option {
  intent: string;
  params: Record<string, Value>;
}

export interface Decision {
  seat: string;
  options: Option[];
}

export interface Snapshot {
  seed: string;
  state: State;
  stack: Frame[];
  log: GameEvent[];
  decisions: number;
}

/** A change a referee seat authors directly. Each must still be an instance of what the ruleset declares. */
export type Authored =
  | { create: { kind: string; id?: string; fields?: Record<string, unknown> } }
  | { set: { id: string; field: string; key?: string; value: unknown } }
  | { destroy: string }
  | { link: { rel: string; from: string; to: string } }
  | { unlink: { rel: string; from: string; to: string } };

const SEAT: ValueType = { k: 'seat' };
const MAX_STEPS = 1_000_000;

export class Match {
  state: State = emptyState();
  readonly log: GameEvent[] = [];
  private stack: Frame[] = [];
  private session: Session | null = null;
  private readonly views = new Map<string, Session>();
  private pending: Decision | null = null;
  private decisions = 0;
  readonly seed: string;
  readonly registry: Registry;
  readonly scenario: Scenario;

  constructor(registry: Registry, scenario: Scenario, seed: string | number, snapshot?: Snapshot) {
    this.registry = registry;
    this.scenario = scenario;
    this.seed = String(seed);
    if (snapshot) {
      this.state = snapshot.state;
      this.log.push(...snapshot.log);
      this.stack = structuredClone(snapshot.stack);
      this.decisions = snapshot.decisions;
      return;
    }
    this.record({ t: 'seed', rng: hashSeed(this.seed) });
    for (const event of scenario.setup) this.record(event);
    this.stack.push({ f: 'block', block: 'flow', pc: 0, vars: {}, boundary: true });
    this.checkEnd();
  }

  /** The match as plain data. Take it while a decision is pending, restore it with `Match.restore`. */
  snapshot(): Snapshot {
    return structuredClone({ seed: this.seed, state: this.state, stack: this.stack, log: this.log, decisions: this.decisions });
  }

  static restore(registry: Registry, scenario: Scenario, snapshot: Snapshot): Match {
    return new Match(registry, scenario, snapshot.seed, structuredClone(snapshot));
  }

  get outcome(): Record<string, Value> | null {
    return this.state.ended;
  }

  /** Every kind check that fails in the current state, as `id: message`. Empty in a sound match. */
  violations(): string[] {
    const session = this.sessionNow();
    return Object.keys(this.state.entities).flatMap((id) => session.failedChecks(id).map((message) => `${id}: ${message}`));
  }

  /** What `seat` may know: the state without the fields and globals hidden from it. A referee sees everything. */
  view(seat: string): State {
    if (this.scenario.doc.seats[seat]?.referee) return this.state;
    return viewOf(this.registry, this.state, this.scenario.world, seat);
  }

  /**
   * The session a seat's choices are worked out in. When the ruleset hides
   * anything, legal intents and behavior scores are evaluated through the
   * seat's own view, so reading what it cannot see is an error, not a leak.
   */
  private sessionFor(seat: string): Session {
    if (!this.registry.secrets || this.scenario.doc.seats[seat]?.referee) return this.sessionNow();
    let session = this.views.get(seat);
    if (!session) {
      session = new Session(this.registry, this.state, this.scenario.world, seat);
      this.views.set(seat, session);
    }
    return session;
  }

  // ── Running ─────────────────────────────────────────────────────────────

  /** Runs until a seat must decide, and returns that decision; returns null once the match has ended. */
  advance(): Decision | null {
    if (this.pending) return this.pending;
    for (let steps = 0; !this.state.ended; steps++) {
      if (steps > MAX_STEPS) throw new RuleError('the flow ran a million steps without reaching a decision');
      const top = this.stack[this.stack.length - 1];
      if (!top) {
        this.record({ t: 'end', outcome: { result: 'complete' } });
        break;
      }
      switch (top.f) {
        case 'block': {
          const effects = this.registry.blocks.get(top.block)!;
          if (top.pc < effects.length) this.execute(effects[top.pc++], top);
          else this.leave(top);
          break;
        }
        case 'each': {
          const fx = this.effect(top.at) as Extract<Fx, { op: 'each' }>;
          if (top.i >= top.items.length) {
            this.stack.pop();
            break;
          }
          const item = top.items[top.i++];
          // An entity destroyed since the list was taken is skipped.
          if (fx.type.k === 'ref' && !this.state.entities[item as string]) break;
          this.stack.push({ f: 'block', block: fx.do, pc: 0, vars: { [fx.as]: { t: fx.type, v: item } }, boundary: false });
          break;
        }
        case 'while': {
          const fx = this.effect(top.at) as Extract<Fx, { op: 'while' }>;
          if (this.evaluate(fx.when) === true) this.stack.push({ f: 'block', block: fx.do, pc: 0, vars: {}, boundary: false });
          else this.stack.pop();
          break;
        }
        case 'emit': {
          const reactions = this.registry.signals.get(top.signal)!.reactions;
          if (top.i >= reactions.length) {
            this.stack.pop();
            break;
          }
          const reaction = reactions[top.i++];
          if (reaction.when && this.sessionNow().eval(reaction.when, this.hydrated(top.args)) !== true) break;
          this.stack.push({ f: 'block', block: reaction.do, pc: 0, vars: structuredClone(top.args), boundary: true });
          break;
        }
        case 'prompt': {
          const fx = this.effect(top.at) as Extract<Fx, { op: 'prompt' }>;
          if (top.finished || (top.asked && !fx.repeat)) {
            this.stack.pop();
            break;
          }
          const options = this.enumerate(top, fx);
          if (options.length === 0) {
            this.stack.pop();
            if (!top.asked && fx.ifNone) this.stack.push({ f: 'block', block: fx.ifNone, pc: 0, vars: {}, boundary: false });
            break;
          }
          if (this.decisions >= this.scenario.maxDecisions) {
            this.record({ t: 'end', outcome: { result: 'limit' } });
            break;
          }
          this.pending = { seat: top.seat, options };
          return this.pending;
        }
      }
    }
    this.stack = [];
    return null;
  }

  /** Takes the pending decision: option `index` of the ones `advance` returned. */
  submit(index: number): void {
    const decision = this.pending;
    const option = decision?.options[index];
    if (!decision || !option) throw new RuleError(`there is no option ${index} to choose`);
    const frame = this.stack[this.stack.length - 1] as Extract<Frame, { f: 'prompt' }>;
    this.pending = null;
    this.decisions += 1;
    frame.asked = true;
    this.record({ t: 'intent', seat: decision.seat, intent: option.intent, params: option.params });
    this.enter(this.registry.intents.get(option.intent)!, decision.seat, option.params);
  }

  /** Plays to the end with a driver for every seat. */
  run(seats: Record<string, Seat>): { outcome: Record<string, Value>; state: State; log: GameEvent[] } {
    for (let decision = this.advance(); decision; decision = this.advance()) {
      const seat = seats[decision.seat];
      if (!seat) throw new RuleError(`no driver for seat "${decision.seat}"`);
      this.submit(seat.choose({
        seat: decision.seat, options: decision.options, state: this.view(decision.seat),
        scores: (behavior) => this.scores(behavior, decision.seat, decision.options),
      }));
    }
    return { outcome: this.state.ended!, state: this.state, log: this.log };
  }

  /** A behavior's utility for each option: its score expression, scaled by every goal that holds. */
  scores(behaviorName: string, seat: string, options: Option[]): number[] {
    const behavior = this.registry.behaviors.get(behaviorName);
    if (!behavior) throw new RuleError(`the ruleset declares no behavior "${behaviorName}"`);
    const session = this.sessionFor(seat);
    return options.map((option) => {
      const score = behavior.scores.get(option.intent);
      if (!score) return 0;
      const vars = this.hydrated(this.intentVars(this.registry.intents.get(option.intent)!, seat, option.params), session);
      let value = Number(session.eval(score, vars));
      for (const goal of behavior.goals) {
        const scale = goal.scale.get(option.intent);
        if (scale && session.eval(scale.when, vars) === true) value *= scale.factor;
      }
      return value;
    });
  }

  // ── Referee authoring ───────────────────────────────────────────────────

  /** A referee seat writes state directly. Refused unless every change is an instance of what the ruleset declares. */
  author(seat: string, changes: Authored[]): void {
    this.requireReferee(seat);
    const { registry } = this;
    const world = this.scenario.world;
    // Validate against a scratch copy first, so a refused batch changes nothing.
    let scratch = this.state;
    const events: Write[] = [];
    const stage = (event: Write) => {
      events.push(event);
      scratch = apply(scratch, event);
    };
    const touched = new Set<string>();
    for (const change of changes) {
      if ('create' in change) {
        const id = change.create.id ?? `${change.create.kind}#${scratch.nextId}`;
        stage({ t: 'create', id, kind: change.create.kind, fields: instantiate(registry, world, scratch, change.create.kind, id, change.create.fields ?? {}) });
        touched.add(id);
      } else if ('set' in change) {
        const { id, field, key, value } = change.set;
        const entity = scratch.entities[id];
        const spec = entity && registry.kinds.get(entity.kind)!.fields.get(field);
        if (!spec) throw new RuleError(`no such address "${id}.${field}"`);
        const type = key === undefined ? spec.type : spec.type.k === 'map' ? spec.type.val : undefined;
        if (!type || (key !== undefined && invalid(registry, world, scratch, (spec.type as { key: ValueType }).key, key))) {
          throw new RuleError(`no such address "${id}.${field}.${key}"`);
        }
        const reason = invalid(registry, world, scratch, type, value);
        if (reason) throw new RuleError(`${id}.${field}: ${reason}`);
        stage({ t: 'set', id, field, ...(key === undefined ? {} : { key }), value: value as Value });
        touched.add(id);
      } else if ('destroy' in change) {
        if (!scratch.entities[change.destroy]) throw new RuleError(`no entity "${change.destroy}"`);
        stage({ t: 'destroy', id: change.destroy });
        touched.delete(change.destroy);
      } else {
        const op = 'link' in change ? 'link' : 'unlink';
        const link = 'link' in change ? change.link : change.unlink;
        const relation = registry.relations.get(link.rel);
        if (!relation) throw new RuleError(`the ruleset declares no relation "${link.rel}"`);
        if (scratch.entities[link.from]?.kind !== relation.from || scratch.entities[link.to]?.kind !== relation.to) {
          throw new RuleError(`${link.rel} joins a ${relation.from} to a ${relation.to}`);
        }
        stage({ t: op, ...link });
        touched.add(link.from).add(link.to);
      }
    }
    const session = new Session(registry, scratch, world);
    for (const id of touched) {
      const failed = scratch.entities[id] ? session.failedChecks(id) : [];
      if (failed.length > 0) throw new RuleError(`${id}: ${failed.join('; ')}`);
    }
    this.pending = null;
    for (const event of events) this.record(event, seat);
    this.checkEnd();
  }

  /**
   * A referee seat rules that an intent happens now, for `actor`, whatever
   * the prompt on offer: how an unplanned action is mapped onto the ruleset.
   * Params are type-checked; gates are the referee's to waive.
   */
  adjudicate(seat: string, actor: string, intentName: string, params: Record<string, unknown>): void {
    this.requireReferee(seat);
    const intent = this.registry.intents.get(intentName);
    if (!intent) throw new RuleError(`the ruleset declares no intent "${intentName}"`);
    if (!this.scenario.world.seats.includes(actor)) throw new RuleError(`"${actor}" is not a seat in this match`);
    for (const param of intent.params) {
      const reason = invalid(this.registry, this.scenario.world, this.state, param.type, params[param.name]);
      if (reason) throw new RuleError(`${intentName}.${param.name}: ${reason}`);
    }
    this.pending = null;
    this.record({ t: 'intent', seat: actor, intent: intentName, params: params as Record<string, Value> }, seat);
    this.enter(intent, actor, params as Record<string, Value>);
  }

  private requireReferee(seat: string): void {
    if (!this.scenario.doc.seats[seat]?.referee) throw new RuleError(`seat "${seat}" is not a referee`);
    if (this.state.ended) throw new RuleError('the match has ended');
  }

  // ── The machine ─────────────────────────────────────────────────────────

  private record(event: Write | Marker, by?: string): void {
    const entry = { ...event, seq: this.log.length, ...(by ? { by } : {}) } as GameEvent;
    this.state = apply(this.state, entry);
    this.log.push(entry);
    this.session = null;
    this.views.clear();
  }

  /** A rule's write: recorded, then the scenario's end conditions are checked. */
  private write(event: Write): void {
    this.record(event);
    this.checkEnd();
  }

  private checkEnd(): void {
    if (this.state.ended) return;
    const session = this.sessionNow();
    for (const condition of this.scenario.end) {
      if (session.eval(condition.when) !== true) continue;
      const outcome = Object.fromEntries(condition.outcome.map(({ name, value }) => [name, dehydrate(session.eval(value))]));
      this.record({ t: 'end', outcome });
      return;
    }
  }

  private sessionNow(): Session {
    this.session ??= new Session(this.registry, this.state, this.scenario.world);
    return this.session;
  }

  private effect([block, index]: At): Fx {
    return this.registry.blocks.get(block)![index];
  }

  /** The variables visible from the top of the stack, out to the nearest scope boundary. */
  private scope(): Vars {
    const vars: Vars = {};
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      if (frame.f !== 'block') continue;
      for (const [name, value] of Object.entries(frame.vars)) vars[name] ??= value;
      if (frame.boundary) break;
    }
    return vars;
  }

  private hydrated(vars: Vars, session = this.sessionNow()): Record<string, unknown> {
    return Object.fromEntries(Object.entries(vars).map(([name, { t, v }]) => [name, session.hydrate(v, t)]));
  }

  private evaluate(compiled: Compiled): unknown {
    return this.sessionNow().eval(compiled, this.hydrated(this.scope()));
  }

  /** Assigns to the nearest frame that already binds `name`, else declares it in `home`. */
  private bind(home: Extract<Frame, { f: 'block' }>, name: string, value: Var): void {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      if (frame.f !== 'block') continue;
      if (name in frame.vars) {
        frame.vars[name] = value;
        return;
      }
      if (frame.boundary) break;
    }
    home.vars[name] = value;
  }

  /** A finished block leaves the stack; a procedure's block hands its returns to the caller. */
  private leave(frame: Extract<Frame, { f: 'block' }>): void {
    this.stack.pop();
    if (!frame.returns) return;
    const caller = this.stack[this.stack.length - 1] as Extract<Frame, { f: 'block' }>;
    for (const { local, returned } of frame.returns) this.bind(caller, local, frame.vars[returned]);
  }

  private intentVars(intent: IntentSpec, seat: string, params: Record<string, Value>): Vars {
    const vars: Vars = { seat: { t: SEAT, v: seat } };
    for (const param of intent.params) vars[param.name] = { t: param.type, v: params[param.name] };
    return vars;
  }

  private enter(intent: IntentSpec, seat: string, params: Record<string, Value>): void {
    this.stack.push({ f: 'block', block: intent.effects, pc: 0, vars: this.intentVars(intent, seat, params), boundary: true });
  }

  /** Every way to bind an offered intent's params so that all its gates pass. */
  private enumerate(frame: Extract<Frame, { f: 'prompt' }>, fx: Extract<Fx, { op: 'prompt' }>): Option[] {
    const session = this.sessionFor(frame.seat);
    const options: Option[] = [];
    for (const name of fx.offer) {
      const intent = this.registry.intents.get(name)!;
      const context: Record<string, unknown> = { seat: frame.seat };
      for (const param of intent.params) {
        if (!param.in) context[param.name] = session.hydrate(frame.given[param.name].v, param.type);
      }
      const open = intent.params.filter((param) => param.in);
      const fill = (index: number) => {
        if (index === open.length) {
          if (intent.gates.every((gate) => session.eval(gate, context) === true)) {
            options.push({ intent: name, params: Object.fromEntries(intent.params.map((param) => [param.name, dehydrate(context[param.name])])) });
          }
          return;
        }
        const param = open[index];
        for (const candidate of session.eval(param.in!, context) as unknown[]) {
          context[param.name] = candidate;
          fill(index + 1);
        }
        delete context[param.name];
      };
      fill(0);
    }
    return options;
  }

  private entityId(compiled: Compiled): string {
    return dehydrate(this.evaluate(compiled)) as string;
  }

  private checked(type: ValueType, value: Value, where: string): Value {
    const reason = invalid(this.registry, this.scenario.world, this.state, type, value);
    if (reason) throw new RuleError(`${where}: ${reason}`);
    return value;
  }

  /** The key of an indexed write, checked against the map's key type. */
  private mapKey(target: SetTarget, where: string): string {
    const key = dehydrate(this.evaluate(target.index!));
    const spec = target.owner === 'game'
      ? this.registry.globals.get(target.field)!
      : this.registry.kinds.get(this.state.entities[this.scope()[target.owner].v as string]?.kind ?? '')?.fields.get(target.field);
    if (spec?.type.k === 'map') this.checked(spec.type.key, key, where);
    return key as string;
  }

  private bound(bindings: { name: string; type: ValueType; value: Compiled }[]): Vars {
    return Object.fromEntries(bindings.map(({ name, type, value }) => [name, { t: type, v: dehydrate(this.evaluate(value)) }]));
  }

  private execute(fx: Fx, frame: Extract<Frame, { f: 'block' }>): void {
    const at: At = [frame.block, frame.pc - 1];
    switch (fx.op) {
      case 'let':
        for (const { name, type, value } of fx.vars) this.bind(frame, name, { t: type, v: dehydrate(this.evaluate(value)) });
        break;
      case 'roll': {
        const n = fx.n ? Number(this.evaluate(fx.n)) : 1;
        const d = Number(this.evaluate(fx.d));
        if (n < 0 || d < 1) throw new RuleError(`${fx.d.path}: cannot roll ${n}d${d}`);
        const { position, values } = rollDice(this.state.rng, n, d);
        frame.vars[fx.as] = { t: { k: 'int' }, v: values.reduce((sum, value) => sum + value, 0) };
        this.write({ t: 'roll', n, d, values, rng: position });
        break;
      }
      case 'set':
        for (const { target, value } of fx.writes) {
          if (this.state.ended) break;
          const next = this.checked(target.type, dehydrate(this.evaluate(value)), value.path);
          const key = target.index ? this.mapKey(target, value.path) : target.key;
          // A write that changes nothing is not an event.
          const same = (held: Value | undefined) =>
            JSON.stringify(key === undefined ? held : (held as Record<string, Value>)[key]) === JSON.stringify(next);
          if (target.owner === 'game') {
            if (same(this.state.game[target.field])) continue;
            // A global is logged whole, so a keyed write records the map with that entry changed.
            const whole = key === undefined ? next : { ...(this.state.game[target.field] as Record<string, Value>), [key]: next };
            this.write({ t: 'global', field: target.field, value: whole });
          } else {
            const id = this.scope()[target.owner].v as string;
            const entity = this.state.entities[id];
            if (!entity) throw new RuleError(`${value.path}: "${id}" no longer exists`);
            if (same(entity.fields[target.field])) continue;
            this.write({ t: 'set', id, field: target.field, ...(key === undefined ? {} : { key }), value: next });
          }
        }
        break;
      case 'create': {
        const given = Object.fromEntries(fx.fields.map(({ name, value }) => [name, dehydrate(this.evaluate(value))]));
        const id = `${fx.kind}#${this.state.nextId}`;
        const event: Write = { t: 'create', id, kind: fx.kind, fields: instantiate(this.registry, this.scenario.world, this.state, fx.kind, id, given) };
        const failed = new Session(this.registry, apply(this.state, event), this.scenario.world).failedChecks(id);
        if (failed.length > 0) throw new RuleError(`cannot create ${fx.kind}: ${failed.join('; ')}`);
        if (fx.as) frame.vars[fx.as] = { t: { k: 'ref', kind: fx.kind }, v: id };
        this.write(event);
        break;
      }
      case 'destroy': {
        const id = this.entityId(fx.target);
        if (this.state.entities[id]) this.write({ t: 'destroy', id });
        break;
      }
      case 'link':
      case 'unlink': {
        const from = this.entityId(fx.from);
        const to = this.entityId(fx.to);
        const exists = (this.state.links[fx.rel] ?? []).some(([a, b]) => a === from && b === to);
        if (exists !== (fx.op === 'link')) this.write({ t: fx.op, rel: fx.rel, from, to });
        break;
      }
      case 'if': {
        const next = this.evaluate(fx.when) === true ? fx.then : fx.else;
        if (next) this.stack.push({ f: 'block', block: next, pc: 0, vars: {}, boundary: false });
        break;
      }
      case 'each':
        this.stack.push({ f: 'each', at, items: dehydrate(this.evaluate(fx.in)) as Value[], i: 0 });
        break;
      case 'while':
        this.stack.push({ f: 'while', at });
        break;
      case 'prompt': {
        const seat = this.checked(SEAT, dehydrate(this.evaluate(fx.seat)), fx.seat.path) as string;
        this.stack.push({ f: 'prompt', at, seat, given: this.bound(fx.with), asked: false, finished: false });
        break;
      }
      case 'done': {
        const prompt = this.stack.findLast((candidate) => candidate.f === 'prompt') as Extract<Frame, { f: 'prompt' }> | undefined;
        if (!prompt) throw new RuleError(`${frame.block}: done outside any prompt`);
        prompt.finished = true;
        break;
      }
      case 'emit': {
        const args = this.bound(fx.args);
        this.record({ t: 'signal', name: fx.signal, args: Object.fromEntries(Object.entries(args).map(([name, { v }]) => [name, v])) });
        this.stack.push({ f: 'emit', signal: fx.signal, args, i: 0 });
        break;
      }
      case 'call': {
        const procedure = this.registry.procedures.get(fx.procedure)!;
        this.stack.push({
          f: 'block', block: procedure.do, pc: 0, vars: this.bound(fx.args), boundary: true,
          returns: fx.as.map(({ local, returned }) => ({ local, returned })),
        });
        break;
      }
    }
  }
}

/** What a seat is shown when it must decide. */
export interface SeatRequest {
  seat: string;
  options: Option[];
  state: State;
  /** The utility a ruleset behavior gives each option. */
  scores(behavior: string): number[];
}

/** Anything that can fill a seat: a player, a scripted AI, an agent. It takes the legal intents and returns one. */
export interface Seat {
  choose(request: SeatRequest): number;
}

// A session evaluates expressions against one state. It turns stored values
// into what CEL expects (and back), reads fields, computes derived values on
// demand, and follows relations. State never changes under a session: every
// write produces a new state and a new session.

import { Cell, type HostCall, type SpaceHost, type SpaceMap } from '../lib/functions.ts';
import { RuleError, type Compiled, type FieldSpec, type KindSpec, type Registry } from '../compile/program.ts';
import type { ValueType } from '../types.ts';
import { showType } from '../types.ts';
import { produce } from 'immer';
import type { State, Value } from './state.ts';

/** What stays fixed for a whole match: the space, its host, and the seats. */
export interface World {
  /** The host of the map as the scenario gives it. */
  host: SpaceHost;
  /** The map with what play has changed laid over it, and its host. Absent when the ruleset has no grid. */
  ground?: (overlay: State['ground']) => { map: SpaceMap; host: SpaceHost };
  space: { width: number; height: number; unit: number };
  seats: string[];
}

interface Handle {
  id: string;
}

/** Converts a CEL result into a stored value. Needs no type: the shapes are distinct. */
export function dehydrate(value: unknown): Value {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Cell) return { x: Number(value.x), y: Number(value.y) };
  if (Array.isArray(value)) return value.map(dehydrate);
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [String(key), dehydrate(item)]));
  if (typeof value === 'object' && value !== null) return (value as Handle).id;
  return value as Value;
}

/** Scenario files write a cell as `[x, y]`; state holds `{ x, y }`. */
export function normalize(type: ValueType, value: unknown): unknown {
  if (type.k === 'cell' && Array.isArray(value) && value.length === 2) return { x: value[0], y: value[1] };
  if (type.k === 'list' && Array.isArray(value)) return value.map((item) => normalize(type.of, item));
  if (type.k === 'map' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(type.val, item)]));
  }
  return value;
}

/** Why `value` is not a valid `type`, or null when it is. Strict: nothing is coerced. */
export function invalid(registry: Registry, world: World, state: State, type: ValueType, value: unknown): string | null {
  const wrong = () => `${JSON.stringify(value)} is not a valid ${showType(type)}`;
  switch (type.k) {
    case 'int': return Number.isSafeInteger(value) ? null : wrong();
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? null : wrong();
    case 'bool': return typeof value === 'boolean' ? null : wrong();
    case 'string': return typeof value === 'string' ? null : wrong();
    case 'seat': return typeof value === 'string' && world.seats.includes(value) ? null : `${JSON.stringify(value)} is not a seat in this match`;
    case 'enum': return typeof value === 'string' && registry.enums.get(type.name)!.includes(value) ? null : wrong();
    case 'cell': {
      const cell = value as { x?: unknown; y?: unknown } | null;
      const ok = typeof cell === 'object' && cell !== null && Number.isSafeInteger(cell.x) && Number.isSafeInteger(cell.y) && Object.keys(cell).length === 2;
      return ok ? null : wrong();
    }
    case 'ref': {
      const entity = typeof value === 'string' ? state.entities[value] : undefined;
      return entity && entity.kind === type.kind ? null : `${JSON.stringify(value)} is not an existing ${type.kind}`;
    }
    case 'list':
      if (!Array.isArray(value)) return wrong();
      for (const item of value) {
        const reason = invalid(registry, world, state, type.of, item);
        if (reason) return reason;
      }
      return null;
    case 'map': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return wrong();
      for (const [key, item] of Object.entries(value)) {
        const reason = invalid(registry, world, state, type.key, key) ?? invalid(registry, world, state, type.val, item);
        if (reason) return reason;
      }
      if (type.key.k === 'enum') {
        const missing = registry.enums.get(type.key.name)!.filter((key) => !(key in value));
        if (missing.length > 0) return `map is missing ${missing.join(', ')}`;
      }
      return null;
    }
  }
}

export class Session {
  private readonly derived = new Map<string, unknown>();
  private readonly derivedCalls = new Map<string, HostCall[]>();
  private readonly computing = new Set<string>();
  private readonly handles = new Map<string, Handle>();
  private readonly globals: Record<string, unknown>;
  readonly registry: Registry;
  readonly state: State;
  readonly world: World;
  /** The seat whose view this is. Absent: the session sees everything, as the rules do. */
  readonly viewer?: string;
  private unfiltered: Session | null = null;

  constructor(registry: Registry, state: State, world: World, viewer?: string) {
    this.registry = registry;
    this.state = state;
    this.world = world;
    this.viewer = viewer;
    this.globals = registry.globalsFor(this);
  }

  /** The host of the ground as it stands in this state. */
  get host(): SpaceHost {
    return this.world.ground ? this.world.ground(this.state.ground ?? {}).host : this.world.host;
  }

  /**
   * Whether `viewer` may see a field (of entity `id`) or a global (no id).
   * The visibility expression itself is evaluated with everything in sight.
   */
  visibleTo(viewer: string, spec: FieldSpec, id?: string, kind?: string): boolean {
    if (!spec.visible) return true;
    if (this.viewer !== undefined) return (this.unfiltered ??= new Session(this.registry, this.state, this.world)).visibleTo(viewer, spec, id, kind);
    return this.eval(spec.visible, { viewer, ...(id === undefined ? {} : { self: this.handle(id, kind!) }) }) === true;
  }

  /** Evaluates an expression with the given (already hydrated) variables. */
  eval(compiled: Compiled, vars: Record<string, unknown> = {}): unknown {
    const previous = this.registry.active;
    this.registry.active = this;
    try {
      return compiled.run({ ...this.globals, ...vars });
    } catch (error) {
      if (error instanceof RuleError) throw error;
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      throw new RuleError(`${compiled.path}: ${reason} (in \`${compiled.source}\`)`);
    } finally {
      this.registry.active = previous;
    }
  }

  /** Converts a stored value into what CEL expects for its type. */
  hydrate(value: Value, type: ValueType): unknown {
    switch (type.k) {
      case 'int': return BigInt(value as number);
      case 'cell': {
        const cell = value as { x: number; y: number };
        return new Cell(BigInt(cell.x), BigInt(cell.y));
      }
      case 'ref': return this.handle(value as string, type.kind);
      case 'list': return (value as Value[]).map((item) => this.hydrate(item, type.of));
      case 'map':
        return new Map(Object.entries(value as Record<string, Value>).map(([key, item]) => [key, this.hydrate(item, type.val)]));
      default: return value;
    }
  }

  handle(id: string, kind: string): Handle {
    let handle = this.handles.get(id);
    if (!handle) {
      handle = new (this.kind(kind).handle)(this, id);
      this.handles.set(id, handle);
    }
    return handle;
  }

  entitiesOf(kind: string): Handle[] {
    return Object.entries(this.state.entities)
      .filter(([, entity]) => entity.kind === kind)
      .map(([id]) => this.handle(id, kind));
  }

  readGlobal(name: string): unknown {
    const spec = this.registry.globals.get(name)!;
    if (this.viewer !== undefined && !this.visibleTo(this.viewer, spec)) {
      throw new RuleError(`game.${name} is hidden from seat "${this.viewer}"`);
    }
    return this.hydrate(this.state.game[name], spec.type);
  }

  readField(id: string, kind: KindSpec, name: string): unknown {
    const entity = this.state.entities[id];
    if (!entity) throw new RuleError(`${kind.name} "${id}" no longer exists`);
    const spec = kind.fields.get(name)!;
    if (this.viewer !== undefined && !this.visibleTo(this.viewer, spec, id, kind.name)) {
      throw new RuleError(`${kind.name}.${name} of "${id}" is hidden from seat "${this.viewer}"`);
    }
    return this.hydrate(entity.fields[name], spec.type);
  }

  readDerived(id: string, kind: KindSpec, name: string): unknown {
    const key = `${id}\u0000${name}`;
    const outer = this.registry.trace;
    if (this.derived.has(key)) {
      // A traced reader is shown the host calls the value was computed from, cached or not.
      outer?.push(...(this.derivedCalls.get(key) ?? []));
      return this.derived.get(key);
    }
    if (this.computing.has(key)) throw new RuleError(`derived value ${kind.name}.${name} depends on itself`);
    if (!this.state.entities[id]) throw new RuleError(`${kind.name} "${id}" no longer exists`);
    this.computing.add(key);
    const calls: HostCall[] = [];
    if (outer) this.registry.trace = calls;
    try {
      const spec = kind.derived.get(name)!;
      const self = this.handle(id, kind.name);
      const value = spec.each
        ? new Map(spec.each.keys.map((item) => [item, this.eval(spec.value, { self, [spec.each!.variable]: item })]))
        : this.eval(spec.value, { self });
      this.derived.set(key, value);
      if (outer) this.derivedCalls.set(key, calls);
      return value;
    } finally {
      this.computing.delete(key);
      if (outer) {
        this.registry.trace = outer;
        outer.push(...calls);
      }
    }
  }

  readRelation(id: string, kind: KindSpec, name: string): Handle[] {
    const { rel, side, other } = kind.traversals.get(name)!;
    const links = this.state.links[rel] ?? [];
    return side === 'from'
      ? links.filter(([from]) => from === id).map(([, to]) => this.handle(to, other))
      : links.filter(([, to]) => to === id).map(([from]) => this.handle(from, other));
  }

  /** The messages of every kind check the entity fails. */
  failedChecks(id: string): string[] {
    const entity = this.state.entities[id];
    const kind = this.kind(entity.kind);
    const self = this.handle(id, kind.name);
    return kind.checks.filter((check) => this.eval(check.that, { self }) !== true).map((check) => check.message);
  }

  private kind(name: string): KindSpec {
    return this.registry.kinds.get(name)!;
  }
}

/** The state as `viewer` may know it: every field and global hidden from that seat is left out. */
export function viewOf(registry: Registry, state: State, world: World, viewer: string): State {
  if (!registry.secrets) return state;
  const session = new Session(registry, state, world);
  return (produce as (base: State, recipe: (draft: State) => void) => State)(state, (draft) => {
    for (const spec of registry.globals.values()) {
      if (!session.visibleTo(viewer, spec)) delete draft.game[spec.name];
    }
    for (const [id, entity] of Object.entries(state.entities)) {
      for (const spec of registry.kinds.get(entity.kind)!.fields.values()) {
        if (!session.visibleTo(viewer, spec, id, entity.kind)) delete draft.entities[id].fields[spec.name];
      }
    }
  });
}

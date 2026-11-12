// Resolution: turns the merged document into a Registry. Every name is
// resolved and every expression parsed and type-checked here, against CEL
// types generated from the ruleset's own declarations, so a ruleset that
// compiles cannot name a fact that does not exist. Issues are collected and
// reported together; any issue refuses the whole ruleset.

import { Environment } from '@marcbachmann/cel-js';
import type { EffectDoc, Expr, FieldDoc, RulesetDoc } from '../format.ts';
import { plain, registerFunctions, tracedHost, type Cell } from '../lib/functions.ts';
import { emptyState, type Value } from '../runtime/state.ts';
import { invalid, normalize, type Session } from '../runtime/session.ts';
import type { Issue } from '../schemas.ts';
import { RESERVED_TYPE_NAMES, celAssignable, celType, parseType, showType, type ValueType } from '../types.ts';
import { layer, type LayerInput, type Layered } from './layers.ts';
import {
  CompileError, RuleError,
  type Binding, type CellLayerSpec, type Compiled, type FieldSpec, type Fx, type IntentSpec, type KindSpec,
  type ProcedureSpec, type Registry, type SetTarget, type SignalSpec,
} from './program.ts';

/** Names an effect may not bind: the globals every expression sees. */
const RESERVED_VARS = new Set(['game', 'all', 'space', 'tables', 'seats', 'cel', 'self', 'seat', 'viewer']);

type Vars = Map<string, ValueType>;
interface Scope {
  vars: Vars;
  parent?: Scope;
}

const STRING: ValueType = { k: 'string' };
const INT: ValueType = { k: 'int' };

function visible(scope: Scope | undefined): Vars {
  if (!scope) return new Map();
  const vars = visible(scope.parent);
  for (const [name, type] of scope.vars) vars.set(name, type);
  return vars;
}

/** The value type of a CEL type the checker inferred, or undefined when it has none. */
export function fromCelType(text: string): ValueType | undefined {
  const source = text.replace(/\s+/g, '');
  if (source === 'int') return INT;
  if (source === 'double') return { k: 'number' };
  if (source === 'bool') return { k: 'bool' };
  if (source === 'string') return STRING;
  if (source === 'Cell') return { k: 'cell' };
  if (source.startsWith('kind.')) return { k: 'ref', kind: source.slice(5) };
  const list = /^list<(.+)>$/.exec(source);
  if (list) {
    const of = fromCelType(list[1]);
    return of && { k: 'list', of };
  }
  const map = /^map<string,(.+)>$/.exec(source);
  if (map) {
    const val = fromCelType(map[1]);
    return val && { k: 'map', key: STRING, val };
  }
  return undefined;
}

/** Infers a table's CEL type from its data and converts the data to match. Rows must be homogeneous. */
function inferTable(value: unknown, path: string, issues: Issue[]): { type: string; value: unknown } {
  const container = (items: unknown[], paths: string[]) => {
    let parts = items.map((item, index) => inferTable(item, paths[index], issues));
    const types = new Set(parts.map((part) => part.type));
    if (types.size === 2 && types.has('int') && types.has('double')) {
      parts = parts.map((part) => ({ type: 'double', value: Number(part.value) }));
    } else if (types.size !== 1) {
      issues.push({ path, message: items.length === 0 ? 'a table may not be empty' : `table entries must share one type; found ${[...types].join(', ')}` });
    }
    return parts;
  };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'int', value: BigInt(value) } : { type: 'double', value };
  }
  if (typeof value === 'string') return { type: 'string', value };
  if (typeof value === 'boolean') return { type: 'bool', value };
  if (Array.isArray(value)) {
    const parts = container(value, value.map((_, index) => `${path}.${index}`));
    return { type: `list<${parts[0]?.type ?? 'dyn'}>`, value: parts.map((part) => part.value) };
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    const parts = container(Object.values(value), keys.map((key) => `${path}.${key}`));
    return { type: `map<string, ${parts[0]?.type ?? 'dyn'}>`, value: new Map(keys.map((key, index) => [key, parts[index].value])) };
  }
  issues.push({ path, message: 'tables hold numbers, strings, booleans, lists, and maps' });
  return { type: 'dyn', value: null };
}

/** Compiles the layers into a registry, or throws a CompileError listing every reason it was refused. */
export function compile(input: LayerInput): Registry {
  const issues: Issue[] = [];
  const layered = layer(input, issues);
  if (!layered || issues.length > 0) throw new CompileError(issues);
  const registry = resolve(layered, issues);
  if (issues.length > 0) throw new CompileError(issues);
  return registry;
}

function resolve({ doc, layers }: Layered, issues: Issue[]): Registry {
  const issue = (path: string, message: string) => issues.push({ path: `ruleset.${path}`, message });

  // ── Names and types ──────────────────────────────────────────────────────
  const enums = new Map(Object.entries(doc.enums ?? {}));
  const kindDocs = doc.kinds ?? {};
  const names = { enums: new Set(enums.keys()), kinds: new Set(Object.keys(kindDocs)) };
  for (const name of [...names.enums, ...names.kinds]) {
    const where = names.kinds.has(name) ? `kinds.${name}` : `enums.${name}`;
    if (RESERVED_TYPE_NAMES.has(name)) issue(where, `"${name}" is a reserved type name`);
    if (names.kinds.has(name) && names.enums.has(name)) issue(where, `"${name}" is both a kind and an enum`);
  }
  const type = (text: string, path: string): ValueType => {
    try {
      return parseType(text, names);
    } catch (error) {
      issue(path, (error as Error).message);
      return STRING;
    }
  };
  const types = (map: Record<string, string> | undefined, path: string): Vars =>
    new Map(Object.entries(map ?? {}).map(([name, text]) => {
      if (RESERVED_VARS.has(name)) issue(`${path}.${name}`, `"${name}" is a reserved name`);
      return [name, type(text, `${path}.${name}`)];
    }));

  const staticWorld = { host: undefined as never, space: { width: 0, height: 0, unit: 1 }, seats: doc.seats ?? [] };
  const fieldSpec = (name: string, raw: string | FieldDoc, path: string): FieldSpec => {
    const fieldDoc = typeof raw === 'string' ? { type: raw } : raw;
    const spec: FieldSpec = { name, type: type(fieldDoc.type, `${path}.type`) };
    if (fieldDoc.default !== undefined) {
      const value = normalize(spec.type, fieldDoc.default);
      const reason = invalid(registry, staticWorld, emptyState(), spec.type, value);
      if (reason) issue(`${path}.default`, reason);
      spec.default = value as Value;
    }
    if (fieldDoc.default !== undefined && fieldDoc.init !== undefined) issue(path, 'give a default or an init, not both');
    return spec;
  };

  const kinds = new Map<string, KindSpec>();
  const relations = new Map<string, { from: string; to: string }>();
  const globals = new Map<string, FieldSpec>();
  const registry = {
    doc, id: doc.ruleset.id, version: doc.ruleset.version, layers, seats: doc.seats, enums,
    space: doc.space ?? { grid: 'none' as const },
    globals, kinds, relations,
    signals: new Map<string, SignalSpec>(), procedures: new Map<string, ProcedureSpec>(),
    intents: new Map<string, IntentSpec>(), cellLayers: new Map<string, CellLayerSpec>(),
    blocks: new Map<string, Fx[]>(), addresses: new Map(), tables: {}, secrets: false, active: null, trace: null,
  } as unknown as Registry;

  if (registry.space.vertical) issue('space.vertical', 'vertical movement is not supported by this core yet');
  if (registry.space.grid === 'none' && Object.keys(doc.space ?? {}).length > 1) issue('space', 'a ruleset with no grid declares nothing else about space');

  for (const [name, layerDoc] of Object.entries(registry.space.layers ?? {})) {
    const path = `space.layers.${name}`;
    const layerType = type(layerDoc.type, `${path}.type`);
    if (name === 'at') issue(path, '"at" is where a scenario says which cell it means; name the layer something else');
    if (!['int', 'number', 'bool', 'string', 'enum'].includes(layerType.k)) {
      issue(`${path}.type`, `a cell layer holds an int, number, bool, string, or enum, not a ${showType(layerType)}`);
      continue;
    }
    const reason = invalid(registry, staticWorld, emptyState(), layerType, layerDoc.default);
    if (reason) issue(`${path}.default`, reason);
    registry.cellLayers.set(name, { name, type: layerType, default: layerDoc.default as Value });
  }

  for (const [name, raw] of Object.entries(doc.globals ?? {})) {
    globals.set(name, fieldSpec(name, raw, `globals.${name}`));
    if (typeof raw !== 'string' && raw.init !== undefined) issue(`globals.${name}.init`, 'a global takes a default, not an init');
  }

  const memberNames = new Map<string, Set<string>>();
  const claim = (kind: string, member: string, path: string) => {
    const taken = memberNames.get(kind) ?? new Set(['id']);
    memberNames.set(kind, taken);
    if (taken.has(member)) issue(path, `"${member}" is already a member of ${kind}`);
    taken.add(member);
  };

  for (const [name, kindDoc] of Object.entries(kindDocs)) {
    const spec: KindSpec = {
      name, fields: new Map(), derived: new Map(), traversals: new Map(), checks: [],
      handle: undefined as never,
    };
    for (const [field, raw] of Object.entries(kindDoc.fields ?? {})) {
      claim(name, field, `kinds.${name}.fields.${field}`);
      spec.fields.set(field, fieldSpec(field, raw, `kinds.${name}.fields.${field}`));
    }
    for (const [derived, derivedDoc] of Object.entries(kindDoc.derived ?? {})) {
      const path = `kinds.${name}.derived.${derived}`;
      claim(name, derived, path);
      const derivedType = type(derivedDoc.type, `${path}.type`);
      let each: { variable: string; keys: string[] } | undefined;
      if (derivedDoc.each !== undefined) {
        if (derivedType.k === 'map' && derivedType.key.k === 'enum') {
          each = { variable: derivedDoc.each, keys: enums.get(derivedType.key.name)! };
        } else issue(`${path}.each`, 'each needs a map type keyed by an enum');
      }
      spec.derived.set(derived, { name: derived, type: derivedType, each, value: undefined as never });
    }
    kinds.set(name, spec);
  }

  for (const [name, relation] of Object.entries(doc.relations ?? {})) {
    const path = `relations.${name}`;
    const from = kinds.get(relation.from);
    const to = kinds.get(relation.to);
    if (!from) issue(`${path}.from`, `unknown kind "${relation.from}"`);
    if (!to) issue(`${path}.to`, `unknown kind "${relation.to}"`);
    if (!from || !to) continue;
    relations.set(name, { from: relation.from, to: relation.to });
    claim(from.name, name, path);
    from.traversals.set(name, { rel: name, side: 'from', other: to.name });
    if (relation.inverse) {
      claim(to.name, relation.inverse, `${path}.inverse`);
      to.traversals.set(relation.inverse, { rel: name, side: 'to', other: from.name });
    }
  }

  // ── The CEL environment: one type per kind, generated from the declarations ──
  const env = new Environment();
  const hostNow = () => {
    const session = registry.active;
    if (!session) throw new RuleError('spatial functions need a running match');
    if (registry.space.grid === 'none') throw new RuleError('this ruleset declares no space');
    return registry.trace ? tracedHost(session.world.host, registry.trace) : session.world.host;
  };
  registerFunctions(env, hostNow);

  // A cell's layer values, typed from the declarations, so `cellAt(c).terain` fails the build.
  class CellData {
    constructor(values: Record<string, unknown>) {
      Object.assign(this, values);
    }
  }
  env.registerType('CellData', {
    ctor: CellData, fields: Object.fromEntries([...registry.cellLayers.values()].map((layer) => [layer.name, celType(layer.type)])),
  } as never);
  registry.cellData = (values) => new CellData(Object.fromEntries([...registry.cellLayers.values()].map((layer) =>
    [layer.name, layer.type.k === 'int' ? BigInt(values[layer.name] as number) : values[layer.name]])));
  env.registerFunction('cellAt(Cell): CellData', ((cell: Cell) => {
    const host = hostNow();
    const at = plain(cell);
    const { width, height } = registry.active!.world.space;
    if (at.x < 0 || at.y < 0 || at.x >= width || at.y >= height) throw new RuleError(`cellAt: (${at.x}, ${at.y}) is off the map`);
    return registry.cellData(host.cellAt(at));
  }) as never);

  /** A class whose getters read through the session it was made for. */
  const reader = (members: Record<string, (self: { $s: Session; id: string }) => unknown>) => {
    const Reader = class {
      declare $s: Session;
      id: string;
      constructor(session: Session, id: string) {
        Object.defineProperty(this, '$s', { value: session, enumerable: false });
        this.id = id;
      }
    };
    for (const [member, read] of Object.entries(members)) {
      Object.defineProperty(Reader.prototype, member, { get(this: { $s: Session; id: string }) { return read(this); }, enumerable: true });
    }
    return Reader;
  };

  for (const spec of kinds.values()) {
    const members: Record<string, (self: { $s: Session; id: string }) => unknown> = {};
    const fields: Record<string, string> = { id: 'string' };
    for (const field of spec.fields.values()) {
      members[field.name] = (self) => self.$s.readField(self.id, spec, field.name);
      fields[field.name] = celType(field.type);
    }
    for (const derived of spec.derived.values()) {
      members[derived.name] = (self) => self.$s.readDerived(self.id, spec, derived.name);
      fields[derived.name] = celType(derived.type);
    }
    for (const [name, traversal] of spec.traversals) {
      members[name] = (self) => self.$s.readRelation(self.id, spec, name);
      fields[name] = `list<kind.${traversal.other}>`;
    }
    spec.handle = reader(members);
    env.registerType(`kind.${spec.name}`, { ctor: spec.handle, fields } as never);
    env.registerOperator(`kind.${spec.name} == kind.${spec.name}`, ((a: { id: string }, b: { id: string }) => a.id === b.id) as never);
  }

  const Game = reader(Object.fromEntries([...globals.keys()].map((name) => [name, (self) => self.$s.readGlobal(name)])));
  const All = reader(Object.fromEntries([...kinds.keys()].map((name) => [name, (self) => self.$s.entitiesOf(name)])));
  const Space = reader({
    width: (self) => BigInt(self.$s.world.space.width),
    height: (self) => BigInt(self.$s.world.space.height),
    unit: (self) => BigInt(self.$s.world.space.unit),
  });
  class Tables {}
  const tables = new Tables() as Record<string, unknown>;
  const tableTypes: Record<string, string> = {};
  for (const [name, data] of Object.entries(doc.tables ?? {})) {
    const inferred = inferTable(data, `ruleset.tables.${name}`, issues);
    tables[name] = inferred.value;
    tableTypes[name] = inferred.type;
  }
  env.registerType('Game', { ctor: Game, fields: Object.fromEntries([...globals].map(([name, spec]) => [name, celType(spec.type)])) } as never);
  env.registerType('All', { ctor: All, fields: Object.fromEntries([...kinds.keys()].map((name) => [name, `list<kind.${name}>`])) } as never);
  env.registerType('Space', { ctor: Space, fields: { width: 'int', height: 'int', unit: 'int' } } as never);
  env.registerType('Tables', { ctor: Tables, fields: tableTypes } as never);
  // The space rules are worked out once per map, before any match: they see a cell and the tables, and no state.
  // Cloning closes an environment to new entries, so both scopes are clones of the bare one.
  const staticEnv = env.clone();
  staticEnv.registerVariable('tables', 'Tables');
  const full = env.clone();
  full.registerVariable('game', 'Game').registerVariable('all', 'All').registerVariable('space', 'Space')
    .registerVariable('tables', 'Tables').registerVariable('seats', 'list<string>');
  registry.tables = tables;
  registry.globalsFor = (session) => ({
    game: new Game(session, 'game'), all: new All(session, 'all'), space: new Space(session, 'space'),
    tables, seats: session.world.seats,
  });

  const environments = new Map<string, Environment>();
  const envFor = (vars: ReadonlyMap<string, ValueType | 'CellData'>, root: Environment): Environment => {
    const entries = [...vars].map(([name, varType]) => [name, varType === 'CellData' ? varType : celType(varType)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    const key = `${root === full ? '' : 'static;'}${entries.map(([name, cel]) => `${name}:${cel}`).join(';')}`;
    let scoped = environments.get(key);
    if (!scoped) {
      scoped = root.clone();
      for (const [name, cel] of entries) scoped.registerVariable(name, cel);
      environments.set(key, scoped);
    }
    return scoped;
  };

  const FAILED: Compiled = { source: '', path: '', type: 'dyn', run: () => { throw new RuleError('expression did not compile'); } };

  /** Parses and type-checks one expression. `expected` lists the CEL types it may have. */
  const expr = (
    source: Expr, vars: ReadonlyMap<string, ValueType | 'CellData'>, path: string, expected?: string[],
    report = issue, prefix = 'ruleset.', root = full,
  ): Compiled => {
    const text = String(source);
    const fail = (message: string) => {
      report(path, `${message} (in \`${text}\`)`);
      return FAILED;
    };
    try {
      const scoped = envFor(vars, root);
      const checked = scoped.check(text);
      if (!checked.valid) return fail(String(checked.error?.message ?? 'invalid expression').split('\n')[0]);
      const actual = String(checked.type);
      if (actual.includes('dyn')) return fail('its type cannot be determined');
      if (expected && !expected.some((want) => celAssignable(actual, want))) {
        return fail(`is ${actual}, but ${expected.join(' or ')} is needed`);
      }
      const parsed = scoped.parse(text);
      return { source: text, path: `${prefix}${path}`, type: actual, run: (context) => parsed(context) };
    } catch (error) {
      return fail((error as Error).message.split('\n')[0]);
    }
  };
  registry.compileExpr = (source, vars, path, into, expected) =>
    expr(source, vars, path, expected, (at, message) => into.push({ path: at, message }), '');

  for (const rule of ['blocksMove', 'blocksSight'] as const) {
    const source = registry.space[rule];
    if (source !== undefined) registry[rule] = expr(source, new Map([['cell', 'CellData']]), `space.${rule}`, ['bool'], issue, 'ruleset.', staticEnv);
  }

  // ── Visibility, then kinds: inits, derived values, checks ────────────────
  const SEAT: ValueType = { k: 'seat' };
  for (const [name, raw] of Object.entries(doc.globals ?? {})) {
    if (typeof raw === 'string' || raw.visible === undefined) continue;
    globals.get(name)!.visible = expr(raw.visible, new Map([['viewer', SEAT]]), `globals.${name}.visible`, ['bool']);
    registry.secrets = true;
  }
  for (const [name, kindDoc] of Object.entries(kindDocs)) {
    const spec = kinds.get(name)!;
    const self: Vars = new Map([['self', { k: 'ref', kind: name }]]);
    for (const [field, raw] of Object.entries(kindDoc.fields ?? {})) {
      if (typeof raw !== 'string' && raw.visible !== undefined) {
        spec.fields.get(field)!.visible = expr(raw.visible, new Map([...self, ['viewer', SEAT]]), `kinds.${name}.fields.${field}.visible`, ['bool']);
        registry.secrets = true;
      }
      if (typeof raw !== 'string' && raw.init !== undefined) {
        const fieldType = spec.fields.get(field)!.type;
        spec.fields.get(field)!.init = expr(raw.init, self, `kinds.${name}.fields.${field}.init`, [celType(fieldType)]);
      }
    }
    for (const [derived, derivedDoc] of Object.entries(kindDoc.derived ?? {})) {
      const derivedSpec = spec.derived.get(derived)!;
      const vars = new Map(self);
      let want = derivedSpec.type;
      if (derivedSpec.each) {
        if (RESERVED_VARS.has(derivedSpec.each.variable)) issue(`kinds.${name}.derived.${derived}.each`, `"${derivedSpec.each.variable}" is a reserved name`);
        vars.set(derivedSpec.each.variable, STRING);
        want = (derivedSpec.type as { val: ValueType }).val;
      }
      derivedSpec.value = expr(derivedDoc.value, vars, `kinds.${name}.derived.${derived}.value`, [celType(want)]);
    }
    (kindDoc.checks ?? []).forEach((check, index) => {
      spec.checks.push({ that: expr(check.that, self, `kinds.${name}.checks.${index}.that`, ['bool']), message: check.message });
    });
  }

  // ── Signatures first, so bodies may refer to anything declared ──────────
  for (const [name, signal] of Object.entries(doc.signals ?? {})) {
    registry.signals.set(name, { name, params: types(signal.params, `signals.${name}.params`), reactions: [] });
  }
  for (const [name, procedure] of Object.entries(doc.procedures ?? {})) {
    registry.procedures.set(name, {
      name, params: types(procedure.params, `procedures.${name}.params`),
      returns: types(procedure.returns, `procedures.${name}.returns`), do: `procedures.${name}.do`,
    });
  }
  const intentScopes = new Map<string, Vars>();
  for (const [name, intent] of Object.entries(doc.intents ?? {})) {
    const params = Object.entries(intent.params ?? {}).map(([param, raw]) => {
      if (RESERVED_VARS.has(param)) issue(`intents.${name}.params.${param}`, `"${param}" is a reserved name`);
      const paramDoc = typeof raw === 'string' ? { type: raw } : raw;
      return { name: param, type: type(paramDoc.type, `intents.${name}.params.${param}.type`), source: paramDoc.in };
    });
    const vars: Vars = new Map([['seat', { k: 'seat' }]]);
    for (const param of params) if (param.source === undefined) vars.set(param.name, param.type);
    const spec: IntentSpec = { name, params: [], gates: [], effects: `intents.${name}.effects` };
    for (const param of params) {
      if (param.source === undefined) spec.params.push({ name: param.name, type: param.type });
      else {
        const domain = expr(param.source, vars, `intents.${name}.params.${param.name}.in`, [`list<${celType(param.type)}>`]);
        spec.params.push({ name: param.name, type: param.type, in: domain });
        vars.set(param.name, param.type);
      }
    }
    const gates = intent.gate === undefined ? [] : Array.isArray(intent.gate) ? intent.gate : [intent.gate];
    gates.forEach((gate, index) => spec.gates.push(expr(gate, vars, `intents.${name}.gate.${index}`, ['bool'])));
    registry.intents.set(name, spec);
    intentScopes.set(name, vars);
  }

  for (const [name, entries] of Object.entries(doc.menus ?? {})) {
    if (registry.intents.has(name)) issue(`menus.${name}`, `"${name}" is already an intent`);
    for (const entry of entries) {
      if (!registry.intents.has(entry)) issue(`menus.${name}`, `unknown intent "${entry}"`);
    }
  }

  // ── Effects ─────────────────────────────────────────────────────────────
  const bindings = (
    given: Record<string, Expr> | undefined, wanted: Vars, scope: Scope, path: string, what: string,
  ): (Binding & { type: ValueType })[] => {
    const out: (Binding & { type: ValueType })[] = [];
    for (const [name, wantedType] of wanted) {
      if (given?.[name] === undefined) issue(path, `${what} needs "${name}"`);
      else out.push({ name, type: wantedType, value: expr(given[name], visible(scope), `${path}.with.${name}`, [celType(wantedType)]) });
    }
    for (const name of Object.keys(given ?? {})) {
      if (!wanted.has(name)) issue(`${path}.with.${name}`, `${what} takes no "${name}"`);
    }
    return out;
  };

  const block = (effects: EffectDoc[], parent: Scope | undefined, id: string, preset?: Vars): Scope => {
    const scope: Scope = { vars: new Map(preset), parent };
    const out: Fx[] = [];
    registry.blocks.set(id, out);
    const declare = (name: string, varType: ValueType, path: string) => {
      if (RESERVED_VARS.has(name)) issue(path, `"${name}" is a reserved name`);
      else if (visible(scope).has(name)) issue(path, `"${name}" is already bound here`);
      scope.vars.set(name, varType);
    };
    /** Binds `name` to a value of CEL type `actual`: assigns when it is visible, declares otherwise. */
    const bind = (name: string, actual: string, path: string): ValueType => {
      const existing = visible(scope).get(name);
      if (existing) {
        if (actual !== 'dyn' && !celAssignable(actual, celType(existing))) issue(path, `"${name}" is ${showType(existing)}; it cannot take a ${actual}`);
        return existing;
      }
      const inferred = fromCelType(actual);
      if (!inferred && actual !== 'dyn') issue(path, `cannot bind "${name}" to a value of type ${actual}`);
      declare(name, inferred ?? STRING, path);
      return inferred ?? STRING;
    };

    effects.forEach((raw, index) => {
      const path = `${id}.${index}`;
      const fx = raw as Record<string, any>;
      const here = () => visible(scope);
      if ('let' in fx) {
        const vars = Object.entries(fx.let as Record<string, Expr>).map(([name, source]) => {
          const value = expr(source, here(), `${path}.let.${name}`);
          return { name, value, type: bind(name, value.type, `${path}.let.${name}`) };
        });
        out.push({ op: 'let', vars });
      } else if ('roll' in fx) {
        const n = fx.roll.n === undefined ? undefined : expr(fx.roll.n, here(), `${path}.roll.n`, ['int']);
        const d = expr(fx.roll.d, here(), `${path}.roll.d`, ['int']);
        declare(fx.roll.as, INT, `${path}.roll.as`);
        out.push({ op: 'roll', as: fx.roll.as, n, d });
      } else if ('set' in fx) {
        const writes = Object.entries(fx.set as Record<string, Expr>).flatMap(([address, source]): { target: SetTarget; value: Compiled }[] => {
          const at = `${path}.set.${address}`;
          // `owner.field[expr]` writes a map entry whose key is computed when the write runs.
          const indexed = /^([^.[\]]+)\.([^.[\]]+)\[(.+)\]$/.exec(address);
          const [owner, field, key, ...rest] = indexed ? [indexed[1], indexed[2]] : address.split('.');
          let spec: FieldSpec | undefined;
          if (owner === 'game') spec = globals.get(field);
          else {
            const ownerType = here().get(owner);
            if (!ownerType || ownerType.k !== 'ref') {
              issue(at, `"${owner}" is not an entity in scope`);
              return [];
            }
            spec = kinds.get(ownerType.kind)!.fields.get(field);
            if (!spec && kinds.get(ownerType.kind)!.derived.has(field)) {
              issue(at, `"${field}" is derived; write its inputs instead`);
              return [];
            }
          }
          if (!spec || rest.length > 0) {
            issue(at, `no such address "${address}"`);
            return [];
          }
          let target = spec.type;
          if (indexed) {
            if (spec.type.k !== 'map') {
              issue(at, `"${field}" has no keys`);
              return [];
            }
            const index = expr(indexed[3], here(), `${at}.key`, ['string']);
            return [{ target: { owner, field, index, type: spec.type.val }, value: expr(source, here(), at, [celType(spec.type.val)]) }];
          }
          if (key !== undefined) {
            if (spec.type.k !== 'map') {
              issue(at, `"${field}" has no keys`);
              return [];
            }
            if (spec.type.key.k === 'enum' && !enums.get(spec.type.key.name)!.includes(key)) {
              issue(at, `"${key}" is not a ${spec.type.key.name}`);
            }
            target = spec.type.val;
          }
          return [{ target: { owner, field, key, type: target }, value: expr(source, here(), at, [celType(target)]) }];
        });
        out.push({ op: 'set', writes });
      } else if ('create' in fx) {
        const kind = kinds.get(fx.create.kind);
        if (!kind) {
          issue(`${path}.create.kind`, `unknown kind "${fx.create.kind}"`);
          return;
        }
        const given = (fx.create.fields ?? {}) as Record<string, Expr>;
        const fields: Binding[] = [];
        for (const [name, source] of Object.entries(given)) {
          const spec = kind.fields.get(name);
          if (!spec) issue(`${path}.create.fields.${name}`, `${kind.name} has no field "${name}"`);
          else fields.push({ name, value: expr(source, here(), `${path}.create.fields.${name}`, [celType(spec.type)]) });
        }
        for (const spec of kind.fields.values()) {
          if (!(spec.name in given) && spec.default === undefined && !spec.init) {
            issue(`${path}.create`, `${kind.name} needs "${spec.name}"`);
          }
        }
        if (fx.create.as) declare(fx.create.as, { k: 'ref', kind: kind.name }, `${path}.create.as`);
        out.push({ op: 'create', kind: kind.name, as: fx.create.as, fields });
      } else if ('destroy' in fx) {
        const target = expr(fx.destroy, here(), `${path}.destroy`);
        if (target !== FAILED && !target.type.startsWith('kind.')) issue(`${path}.destroy`, `destroy takes an entity, not a ${target.type}`);
        out.push({ op: 'destroy', target });
      } else if ('link' in fx || 'unlink' in fx) {
        const op = 'link' in fx ? 'link' : 'unlink';
        const spec = fx[op];
        const relation = relations.get(spec.rel);
        if (!relation) {
          issue(`${path}.${op}.rel`, `unknown relation "${spec.rel}"`);
          return;
        }
        out.push({
          op, rel: spec.rel,
          from: expr(spec.from, here(), `${path}.${op}.from`, [`kind.${relation.from}`]),
          to: expr(spec.to, here(), `${path}.${op}.to`, [`kind.${relation.to}`]),
        });
      } else if ('if' in fx) {
        const when = expr(fx.if, here(), `${path}.if`, ['bool']);
        block(fx.then, scope, `${path}.then`);
        if (fx.else) block(fx.else, scope, `${path}.else`);
        out.push({ op: 'if', when, then: `${path}.then`, else: fx.else ? `${path}.else` : undefined });
      } else if ('each' in fx) {
        const list = expr(fx.in, here(), `${path}.in`);
        const listType = fromCelType(list.type);
        let item: ValueType = STRING;
        if (listType?.k === 'list') item = listType.of;
        else if (list !== FAILED) issue(`${path}.in`, `each needs a list, not a ${list.type}`);
        if (RESERVED_VARS.has(fx.each) || here().has(fx.each)) issue(`${path}.each`, `"${fx.each}" is reserved or already bound here`);
        block(fx.do, scope, `${path}.do`, new Map([[fx.each, item]]));
        out.push({ op: 'each', as: fx.each, type: item, in: list, do: `${path}.do` });
      } else if ('while' in fx) {
        const when = expr(fx.while, here(), `${path}.while`, ['bool']);
        block(fx.do, scope, `${path}.do`);
        out.push({ op: 'while', when, do: `${path}.do` });
      } else if ('prompt' in fx) {
        const spec = fx.prompt;
        const seat = expr(spec.seat, here(), `${path}.prompt.seat`, ['string']);
        const given = (spec.with ?? {}) as Record<string, Expr>;
        const used = new Set<string>();
        const withTypes = new Map<string, ValueType>();
        const menus = doc.menus ?? {};
        const offer = [...new Set((spec.offer as string[]).flatMap((entry) => menus[entry] ?? [entry]))];
        for (const offered of offer) {
          const intent = registry.intents.get(offered);
          if (!intent) {
            issue(`${path}.prompt.offer`, `unknown intent "${offered}"`);
            continue;
          }
          for (const param of intent.params.filter((p) => !p.in)) {
            used.add(param.name);
            const known = withTypes.get(param.name);
            if (!(param.name in given)) issue(`${path}.prompt`, `intent "${offered}" needs "${param.name}" given`);
            else if (known && celType(known) !== celType(param.type)) issue(`${path}.prompt.with.${param.name}`, `offered intents disagree on the type of "${param.name}"`);
            else withTypes.set(param.name, param.type);
          }
        }
        const withBindings = Object.entries(given).flatMap(([name, source]) => {
          if (!used.has(name)) {
            issue(`${path}.prompt.with.${name}`, `no offered intent takes "${name}"`);
            return [];
          }
          const wanted = withTypes.get(name)!;
          return [{ name, type: wanted, value: expr(source, here(), `${path}.prompt.with.${name}`, [celType(wanted)]) }];
        });
        if (spec.ifNone) block(spec.ifNone, scope, `${path}.ifNone`);
        out.push({
          op: 'prompt', seat, with: withBindings, offer, repeat: spec.repeat === true,
          ifNone: spec.ifNone ? `${path}.ifNone` : undefined,
        });
      } else if ('done' in fx) {
        out.push({ op: 'done' });
      } else if ('emit' in fx) {
        const signal = registry.signals.get(fx.emit);
        if (!signal) {
          issue(`${path}.emit`, `unknown signal "${fx.emit}"`);
          return;
        }
        out.push({ op: 'emit', signal: signal.name, args: bindings(fx.with, signal.params, scope, path, `signal "${signal.name}"`) });
      } else if ('call' in fx) {
        const procedure = registry.procedures.get(fx.call);
        if (!procedure) {
          issue(`${path}.call`, `unknown procedure "${fx.call}"`);
          return;
        }
        const args = bindings(fx.with, procedure.params, scope, path, `procedure "${procedure.name}"`);
        const as = Object.entries((fx.as ?? {}) as Record<string, string>).flatMap(([local, returned]) => {
          const returnedType = procedure.returns.get(returned);
          if (!returnedType) {
            issue(`${path}.as.${local}`, `procedure "${procedure.name}" returns no "${returned}"`);
            return [];
          }
          return [{ local, returned, type: bind(local, celType(returnedType), `${path}.as.${local}`) }];
        });
        out.push({ op: 'call', procedure: procedure.name, args, as });
      }
    });
    return scope;
  };

  for (const [name, intent] of Object.entries(doc.intents ?? {})) {
    block(intent.effects, undefined, `intents.${name}.effects`, intentScopes.get(name));
  }
  for (const [name, procedure] of Object.entries(doc.procedures ?? {})) {
    const spec = registry.procedures.get(name)!;
    const scope = block(procedure.do, undefined, spec.do, spec.params);
    for (const [returned, returnedType] of spec.returns) {
      const bound = scope.vars.get(returned);
      if (!bound) issue(`procedures.${name}.returns.${returned}`, 'is never bound at the top level of the procedure');
      else if (celType(bound) !== celType(returnedType)) issue(`procedures.${name}.returns.${returned}`, `is bound as ${showType(bound)}, not ${showType(returnedType)}`);
    }
  }
  (doc.reactions ?? []).forEach((reaction, index) => {
    const signal = registry.signals.get(reaction.on);
    if (!signal) {
      issue(`reactions.${index}.on`, `unknown signal "${reaction.on}"`);
      return;
    }
    const when = reaction.when === undefined ? undefined : expr(reaction.when, signal.params, `reactions.${index}.when`, ['bool']);
    block(reaction.do, undefined, `reactions.${index}.do`, signal.params);
    signal.reactions.push({ when, do: `reactions.${index}.do` });
  });
  block(doc.flow ?? [], undefined, 'flow');

  // ── Addresses: every fact the ruleset allows to exist ────────────────────
  const address = (path: string, of: 'field' | 'derived' | 'relation' | 'global' | 'table' | 'key', valueType: string) =>
    registry.addresses.set(path, { of, type: valueType });
  const withKeys = (path: string, valueType: ValueType) => {
    if (valueType.k === 'map' && valueType.key.k === 'enum') {
      for (const key of enums.get(valueType.key.name)!) address(`${path}.${key}`, 'key', showType(valueType.val));
    }
  };
  for (const [name, spec] of globals) {
    address(`game.${name}`, 'global', showType(spec.type));
    withKeys(`game.${name}`, spec.type);
  }
  for (const kind of kinds.values()) {
    for (const field of kind.fields.values()) {
      address(`${kind.name}.${field.name}`, 'field', showType(field.type));
      withKeys(`${kind.name}.${field.name}`, field.type);
    }
    for (const derived of kind.derived.values()) {
      address(`${kind.name}.${derived.name}`, 'derived', showType(derived.type));
      withKeys(`${kind.name}.${derived.name}`, derived.type);
    }
    for (const [name, traversal] of kind.traversals) address(`${kind.name}.${name}`, 'relation', `list<${traversal.other}>`);
  }
  for (const [name, tableType] of Object.entries(tableTypes)) address(`tables.${name}`, 'table', tableType);

  return registry;
}

export type { RulesetDoc };

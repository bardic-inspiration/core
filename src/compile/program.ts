// The resolved registry: what `compile` produces and the runtime plays. It is
// the merged document plus everything derived from it once, up front: parsed
// types, type-checked expressions, effect blocks, and the address table.

import type { RulesetDoc, SpaceDoc } from '../format.ts';
import type { Session } from '../runtime/session.ts';
import type { Value } from '../runtime/state.ts';
import type { ValueType } from '../types.ts';

/** A parsed, type-checked expression. */
export interface Compiled {
  source: string;
  /** Where in the ruleset it was written, for error messages. */
  path: string;
  /** The CEL type the checker gave it. */
  type: string;
  run: (context: Record<string, unknown>) => unknown;
}

export interface FieldSpec {
  name: string;
  type: ValueType;
  default?: Value;
  init?: Compiled;
}

export interface DerivedSpec {
  name: string;
  type: ValueType;
  each?: { variable: string; keys: string[] };
  value: Compiled;
}

export interface Traversal {
  rel: string;
  /** Which end of the link this kind is on. */
  side: 'from' | 'to';
  other: string;
}

export interface KindSpec {
  name: string;
  fields: Map<string, FieldSpec>;
  derived: Map<string, DerivedSpec>;
  traversals: Map<string, Traversal>;
  checks: { that: Compiled; message: string }[];
  /** The class expressions see instances as; built once per registry. */
  handle: new (session: Session, id: string) => { id: string };
}

export interface Binding {
  name: string;
  value: Compiled;
}

export interface SetTarget {
  /** A variable holding an entity, or `game`. */
  owner: string;
  field: string;
  key?: string;
  type: ValueType;
}

/** A compiled effect. Nested effect lists are referenced by block id, so a paused match can be saved as plain data. */
export type Fx =
  | { op: 'let'; vars: (Binding & { type: ValueType })[] }
  | { op: 'roll'; as: string; n?: Compiled; d: Compiled }
  | { op: 'set'; writes: { target: SetTarget; value: Compiled }[] }
  | { op: 'create'; kind: string; as?: string; fields: Binding[] }
  | { op: 'destroy'; target: Compiled }
  | { op: 'link' | 'unlink'; rel: string; from: Compiled; to: Compiled }
  | { op: 'if'; when: Compiled; then: string; else?: string }
  | { op: 'each'; as: string; type: ValueType; in: Compiled; do: string }
  | { op: 'while'; when: Compiled; do: string }
  | { op: 'prompt'; seat: Compiled; with: (Binding & { type: ValueType })[]; offer: string[]; repeat: boolean; ifNone?: string }
  | { op: 'done' }
  | { op: 'emit'; signal: string; args: (Binding & { type: ValueType })[] }
  | { op: 'call'; procedure: string; args: (Binding & { type: ValueType })[]; as: { local: string; returned: string; type: ValueType }[] };

export interface ParamSpec {
  name: string;
  type: ValueType;
  /** Absent for a param the prompt gives. */
  in?: Compiled;
}

export interface IntentSpec {
  name: string;
  params: ParamSpec[];
  gates: Compiled[];
  effects: string;
}

export interface SignalSpec {
  name: string;
  params: Map<string, ValueType>;
  reactions: { when?: Compiled; do: string }[];
}

export interface ProcedureSpec {
  name: string;
  params: Map<string, ValueType>;
  returns: Map<string, ValueType>;
  do: string;
}

export interface BehaviorSpec {
  name: string;
  scores: Map<string, Compiled>;
  goals: { name: string; scale: Map<string, { when: Compiled; factor: number }> }[];
}

export interface AddressInfo {
  of: 'field' | 'derived' | 'relation' | 'global' | 'table' | 'key';
  type: string;
}

export interface Registry {
  /** The merged, pattern-expanded ruleset document. Plain data. */
  doc: RulesetDoc;
  id: string;
  version: string;
  layers: { id: string; version: string }[];
  /** Fixed seat roles, when the ruleset declares them. */
  seats?: string[];
  enums: Map<string, string[]>;
  space: SpaceDoc;
  globals: Map<string, FieldSpec>;
  kinds: Map<string, KindSpec>;
  relations: Map<string, { from: string; to: string }>;
  signals: Map<string, SignalSpec>;
  procedures: Map<string, ProcedureSpec>;
  intents: Map<string, IntentSpec>;
  behaviors: Map<string, BehaviorSpec>;
  /** Every effect list by id; `flow` is the scheduler. */
  blocks: Map<string, Fx[]>;
  /** Every fact the ruleset allows to exist, by address. */
  addresses: Map<string, AddressInfo>;
  /** Table data, converted for expressions. */
  tables: Record<string, unknown>;
  /** Compiles an expression over the global scope only (scenario end conditions), reporting into `issues`. */
  compileGlobal(source: string | number | boolean, path: string, issues: { path: string; message: string }[]): Compiled;
  /** The variables every expression sees (`game`, `all`, `space`, `tables`, `seats`), bound to a session. */
  globalsFor(session: Session): Record<string, unknown>;
  /** The session whose expression is being evaluated; host functions read it. */
  active: Session | null;
}

/** A refusal: the ruleset or scenario is invalid, with every reason found. */
export class CompileError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(issues: { path: string; message: string }[]) {
    super(`refused:\n${issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}`);
    this.issues = issues;
    this.name = 'CompileError';
  }
}

/** A rule failed while running: a bad write, a missing entity, an expression error. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

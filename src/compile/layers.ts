// Layers: the pattern kit expands into each layer, then extensions merge onto
// the base under the base's `open` list. The result is one plain document,
// the input to `resolve.ts`.

import type { ExtensionDoc, KitDoc, PatternUse, RulesBody, RulesetDoc } from '../format.ts';
import { FORMAT_VERSION } from '../format.ts';
import { schemaIssues, validators, type Issue } from '../schemas.ts';

type Json = unknown;
const isObject = (value: Json): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Replaces `${param}` in every key and string. A string that is exactly one placeholder takes the raw value. */
function substitute(node: Json, args: Record<string, Json>, where: string, issues: Issue[]): Json {
  const lookup = (key: string): Json => {
    if (!(key in args)) {
      issues.push({ path: where, message: `pattern body uses \${${key}}, which is not one of its params` });
      return '';
    }
    return args[key];
  };
  const text = (source: string): Json => {
    const whole = /^\$\{(\w+)\}$/.exec(source);
    if (whole) return lookup(whole[1]);
    return source.replace(/\$\{(\w+)\}/g, (_, key: string) => String(lookup(key)));
  };
  if (typeof node === 'string') return text(node);
  if (Array.isArray(node)) return node.map((item) => substitute(item, args, where, issues));
  if (isObject(node)) {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [String(text(key)), substitute(value, args, where, issues)]),
    );
  }
  return node;
}

const equal = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merges `source` into `target` within one layer. Maps merge by key, lists of
 * scalars union, lists of objects append, and two different values at the
 * same place are a conflict.
 */
function mergeInto(target: Record<string, Json>, source: Record<string, Json>, path: string, issues: Issue[]): void {
  for (const [key, value] of Object.entries(source)) {
    const at = path ? `${path}.${key}` : key;
    const existing = target[key];
    if (existing === undefined) target[key] = structuredClone(value);
    else if (isObject(existing) && isObject(value)) mergeInto(existing, value, at, issues);
    else if (Array.isArray(existing) && Array.isArray(value)) {
      for (const item of value) {
        if (isObject(item) || !existing.some((have) => equal(have, item))) existing.push(structuredClone(item));
      }
    } else if (!equal(existing, value)) {
      issues.push({ path: at, message: 'declared twice with different values' });
    }
  }
}

/** Expands a layer's `uses` and merges the layer's own declarations over them. */
export function expandPatterns(layer: RulesBody, kit: KitDoc | undefined, prefix: string, issues: Issue[]): RulesBody {
  const { uses = [], ...own } = layer;
  const out: Record<string, Json> = {};
  uses.forEach((use: PatternUse, index) => {
    const where = `${prefix}.uses.${index}`;
    const pattern = kit?.patterns[use.pattern];
    if (!pattern) {
      issues.push({ path: where, message: `unknown pattern "${use.pattern}"` });
      return;
    }
    const args: Record<string, Json> = {};
    for (const [name, spec] of Object.entries(pattern.params)) {
      if (use.with && name in use.with) args[name] = use.with[name];
      else if ('default' in spec) args[name] = spec.default;
      else issues.push({ path: where, message: `pattern "${use.pattern}" needs "${name}"` });
    }
    for (const name of Object.keys(use.with ?? {})) {
      if (!(name in pattern.params)) issues.push({ path: `${where}.with.${name}`, message: `pattern "${use.pattern}" has no param "${name}"` });
    }
    mergeInto(out, substitute(pattern.emits, args, where, issues) as Record<string, Json>, '', issues);
  });
  mergeInto(out, own as Record<string, Json>, '', issues);
  return out as RulesBody;
}

type Change = 'add' | 'append' | 'replace';

/**
 * Whether the base's `open` list allows a change at `path`. An entry `x`
 * opens everything at or under x. An entry `x.+` allows only additions
 * directly under x: a new key, or a new item when x is a list. `*` stands
 * for any one key.
 */
function isOpen(open: string[], path: string, change: Change): boolean {
  const at = path.split('.');
  const matches = (pattern: string[], target: string[]) =>
    pattern.length === target.length && pattern.every((part, index) => part === '*' || part === target[index]);
  return open.some((entry) => {
    const parts = entry.split('.');
    if (parts[parts.length - 1] !== '+') return parts.length <= at.length && matches(parts, at.slice(0, parts.length));
    const parent = parts.slice(0, -1);
    if (change === 'add') return matches(parent, at.slice(0, -1));
    return change === 'append' && matches(parent, at);
  });
}

/** Merges an extension onto the base, refusing every change the base does not mark open. */
function mergeExtension(
  target: Record<string, Json>, source: Record<string, Json>, open: string[], path: string, prefix: string, issues: Issue[],
): void {
  for (const [key, value] of Object.entries(source)) {
    const at = path ? `${path}.${key}` : key;
    const existing = target[key];
    const refuse = (what: string) =>
      issues.push({ path: `${prefix}.${at}`, message: `${what}, but the base ruleset does not mark "${at}" open` });
    if (existing === undefined) {
      if (isOpen(open, at, 'add')) target[key] = structuredClone(value);
      else refuse('adds this');
    } else if (isObject(existing) && isObject(value)) {
      mergeExtension(existing, value, open, at, prefix, issues);
    } else if (Array.isArray(existing) && Array.isArray(value)) {
      if (isOpen(open, at, 'append')) {
        for (const item of value) {
          if (isObject(item) || !existing.some((have) => equal(have, item))) existing.push(structuredClone(item));
        }
      } else refuse('appends to this');
    } else if (!equal(existing, value)) {
      if (isOpen(open, at, 'replace')) target[key] = structuredClone(value);
      else refuse('replaces this');
    }
  }
}

/** `1.4.2` satisfies a requirement of `1.2.0`: same major (same minor too while major is 0), and not older. */
export function versionSatisfies(actual: string, wanted: string): boolean {
  const a = actual.split('.').map(Number);
  const w = wanted.split('.').map(Number);
  if (a[0] !== w[0]) return false;
  if (a[0] === 0 && a[1] !== w[1]) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== w[i]) return a[i] > w[i];
  }
  return true;
}

export interface LayerInput {
  kit?: unknown;
  base: unknown;
  extensions?: unknown[];
}

export interface Layered {
  /** The merged document, with no `uses` left in it. */
  doc: RulesetDoc;
  /** The id and version of every layer that went in, base first. */
  layers: { id: string; version: string }[];
}

/** Validates each document's structure and merges them. Issues are collected, never thrown. */
export function layer(input: LayerInput, issues: Issue[]): Layered | undefined {
  const structure = (which: 'ruleset' | 'extension' | 'kit', doc: unknown, prefix: string): boolean => {
    const validate = validators[which];
    if (!validate(doc)) {
      issues.push(...schemaIssues(prefix, validate.errors));
      return false;
    }
    if ((doc as { format: number }).format !== FORMAT_VERSION) {
      issues.push({ path: `${prefix}.format`, message: `format ${(doc as { format: number }).format} is not supported; this core reads format ${FORMAT_VERSION}` });
      return false;
    }
    return true;
  };

  if (input.kit !== undefined && !structure('kit', input.kit, 'kit')) return undefined;
  if (!structure('ruleset', input.base, 'ruleset')) return undefined;
  const kit = input.kit as KitDoc | undefined;
  const base = input.base as RulesetDoc;
  const { format, ruleset, open = [], ...baseBody } = base;
  const merged = expandPatterns(baseBody, kit, 'ruleset', issues) as Record<string, Json>;
  const layers = [{ id: ruleset.id, version: ruleset.version }];

  (input.extensions ?? []).forEach((raw, index) => {
    const prefix = `extensions.${index}`;
    if (!structure('extension', raw, prefix)) return;
    const { format: _format, extension, extends: wants, ...body } = raw as ExtensionDoc;
    if (wants.id !== ruleset.id || !versionSatisfies(ruleset.version, wants.version)) {
      issues.push({ path: `${prefix}.extends`, message: `extends ${wants.id}@${wants.version}, but the base is ${ruleset.id}@${ruleset.version}` });
      return;
    }
    const expanded = expandPatterns(body, kit, prefix, issues) as Record<string, Json>;
    mergeExtension(merged, expanded, open, '', prefix, issues);
    layers.push({ id: extension.id, version: extension.version });
  });

  const doc = { format, ruleset, open, ...merged } as RulesetDoc;
  // Substitution can produce shapes no single layer was checked for.
  const validate = validators.ruleset;
  if (!validate(doc)) {
    issues.push(...schemaIssues('ruleset', validate.errors));
    return undefined;
  }
  return { doc, layers };
}

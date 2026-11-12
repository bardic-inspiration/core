// Free-standing expressions: the same CEL the rules are written in, compiled
// against a registry and evaluated on any state. This is what a host writes
// its own questions in (a batch metric, an inspector field) without adding
// anything to the ruleset.

import { fromCelType } from './compile/resolve.ts';
import { CompileError, RuleError, type Compiled, type Registry } from './compile/program.ts';
import type { Scenario } from './runtime/scenario.ts';
import { Session, dehydrate, invalid, normalize } from './runtime/session.ts';
import type { State, Value } from './runtime/state.ts';
import { parseType, showType, type ValueType } from './types.ts';

export interface ExpressionOptions {
  /** Variables the expression may read beside the global scope, by name, each with its type (`int`, `creature`, `list<cell>`). */
  vars?: Record<string, string>;
  /** The type the expression must have, in the same notation. */
  expect?: string;
}

export interface EvaluateOptions {
  /** Evaluate through this seat's view: reading what the seat cannot see is an error. A referee seat sees everything. */
  viewer?: string;
  /** A value for each declared variable: entity ids, cells as `{ x, y }` or `[x, y]`. */
  vars?: Record<string, unknown>;
}

export interface Expression {
  source: string;
  /** Its type in the format's notation (`int`, `list<creature>`), or CEL's when the format has no name for it. */
  type: string;
  /** Its value on a state, such as a match's, or `fold` of a log up to any entry. */
  evaluate(state: State, scenario: Scenario, options?: EvaluateOptions): Value;
}

/**
 * Compiles one expression against a registry, with the checks a ruleset's
 * own expressions get. It sees `game`, `all`, `tables`, `seats`, `space`,
 * and the variables declared in `options.vars`. Refused with a CompileError.
 */
export function compileExpression(registry: Registry, source: string | number | boolean, options: ExpressionOptions = {}): Expression {
  const issues: { path: string; message: string }[] = [];
  const names = { enums: new Set(registry.enums.keys()), kinds: new Set(registry.kinds.keys()) };
  const type = (text: string, path: string): ValueType | undefined => {
    try {
      return parseType(text, names);
    } catch (error) {
      issues.push({ path, message: (error as Error).message });
      return undefined;
    }
  };
  const vars = new Map<string, ValueType>();
  for (const [name, text] of Object.entries(options.vars ?? {})) {
    const parsed = type(text, `expression.vars.${name}`);
    if (parsed) vars.set(name, parsed);
  }
  const expected = options.expect === undefined ? undefined : type(options.expect, 'expression.expect');
  if (issues.length > 0) throw new CompileError(issues);
  let compiled: Compiled;
  try {
    compiled = registry.compileExpr(source, vars, 'expression', issues);
  } catch (error) {
    // A variable named like a global (`game`, `all`) is refused by the expression library itself.
    throw new CompileError([{ path: 'expression.vars', message: (error as Error).message.split('\n')[0] }]);
  }
  const actual = fromCelType(compiled.type);
  const shown = actual ? showType(actual) : compiled.type;
  // Seats and enum values are strings to an expression, so a string satisfies either.
  const fits = (want: ValueType, got: ValueType | undefined): boolean => {
    if (!got) return false;
    if (want.k === 'list') return got.k === 'list' && fits(want.of, got.of);
    if (want.k === 'map') return got.k === 'map' && fits(want.val, got.val);
    if (want.k === 'seat' || want.k === 'enum' || want.k === 'string') return got.k === 'string';
    return want.k === got.k && (want.k !== 'ref' || want.kind === (got as { kind: string }).kind);
  };
  if (issues.length === 0 && expected && !fits(expected, actual)) {
    issues.push({ path: 'expression', message: `is ${shown}, but ${options.expect} is needed (in \`${compiled.source}\`)` });
  }
  if (issues.length > 0) throw new CompileError(issues);

  return {
    source: compiled.source,
    type: shown,
    evaluate(state, scenario, given = {}) {
      const referee = given.viewer !== undefined && scenario.doc.seats[given.viewer]?.referee;
      if (given.viewer !== undefined && !scenario.world.seats.includes(given.viewer)) throw new RuleError(`"${given.viewer}" is not a seat in this match`);
      const session = new Session(registry, state, scenario.world, referee ? undefined : given.viewer);
      const hydrated: Record<string, unknown> = {};
      for (const [name, varType] of vars) {
        const value = normalize(varType, given.vars?.[name]);
        const reason = invalid(registry, scenario.world, state, varType, value);
        if (reason) throw new RuleError(`expression.vars.${name}: ${reason}`);
        hydrated[name] = session.hydrate(value as Value, varType);
      }
      return dehydrate(session.eval(compiled, hydrated));
    },
  };
}

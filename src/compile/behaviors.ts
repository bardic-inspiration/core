// Behaviors are their own layer. A behavior set is a document apart from the
// ruleset, compiled against the ruleset's registry: its scores and goals are
// expressions in the scope of the intents they weigh. The rules never read a
// behavior, so a set can be swapped or varied without recompiling them.

import { FORMAT_VERSION, type BehaviorDoc, type BehaviorSetDoc } from '../format.ts';
import { schemaIssues, validators, type Issue } from '../schemas.ts';
import type { ValueType } from '../types.ts';
import { versionSatisfies } from './layers.ts';
import { CompileError, type BehaviorSpec, type Compiled, type Registry } from './program.ts';

export interface Behaviors {
  /** The registry the behaviors were compiled against. */
  registry: Registry;
  /** The ids of the sets that went in, in order. */
  sets: string[];
  byName: Map<string, BehaviorSpec>;
}

/**
 * Compiles behavior sets against a registry, or throws a CompileError with
 * every reason they were refused. Sets merge in the order given: a later set
 * adds behaviors, and adds to or replaces the scores and goals of earlier
 * ones (a goal is replaced by name).
 */
export function compileBehaviors(registry: Registry, sets: unknown | unknown[]): Behaviors {
  const issues: Issue[] = [];
  const merged = new Map<string, Required<Pick<BehaviorDoc, 'scores' | 'goals'>>>();
  const ids: string[] = [];
  (Array.isArray(sets) ? sets : [sets]).forEach((raw, index) => {
    const prefix = `behaviors.${index}`;
    const validate = validators.behaviorSet;
    if (!validate(raw)) return issues.push(...schemaIssues(prefix, validate.errors));
    const doc = raw as BehaviorSetDoc;
    if (doc.format !== FORMAT_VERSION) {
      return issues.push({ path: `${prefix}.format`, message: `format ${doc.format} is not supported; this core reads format ${FORMAT_VERSION}` });
    }
    if (doc.ruleset.id !== registry.id || !versionSatisfies(registry.version, doc.ruleset.version)) {
      issues.push({ path: `${prefix}.ruleset`, message: `written for ${doc.ruleset.id}@${doc.ruleset.version}, but the ruleset is ${registry.id}@${registry.version}` });
    }
    for (const extension of doc.extensions ?? []) {
      if (!registry.layers.some((layer) => layer.id === extension)) {
        issues.push({ path: `${prefix}.extensions`, message: `needs the extension "${extension}", which is not loaded` });
      }
    }
    ids.push(doc.behaviorSet.id);
    for (const [name, behavior] of Object.entries(doc.behaviors)) {
      const into = merged.get(name) ?? { scores: {}, goals: [] };
      merged.set(name, into);
      Object.assign(into.scores, behavior.scores);
      for (const goal of behavior.goals ?? []) {
        const at = into.goals.findIndex((have) => have.name === goal.name);
        if (at < 0) into.goals.push(goal);
        else into.goals[at] = goal;
      }
    }
  });

  const byName = new Map<string, BehaviorSpec>();
  for (const [name, behavior] of merged) {
    const spec: BehaviorSpec = { name, registry, scores: new Map(), goals: [] };
    /** What a score sees: the deciding seat and the intent's params. */
    const scopeOf = (intent: string, path: string): Map<string, ValueType> | undefined => {
      const found = registry.intents.get(intent);
      if (!found) issues.push({ path, message: `unknown intent "${intent}"` });
      return found && new Map<string, ValueType>([['seat', { k: 'seat' }], ...found.params.map((param): [string, ValueType] => [param.name, param.type])]);
    };
    for (const [intent, source] of Object.entries(behavior.scores)) {
      const path = `behaviors.${name}.scores.${intent}`;
      const vars = scopeOf(intent, path);
      if (vars) spec.scores.set(intent, registry.compileExpr(source, vars, path, issues, ['int', 'double']));
    }
    behavior.goals.forEach((goal, index) => {
      const scale = new Map<string, { when: Compiled; factor: number }>();
      for (const [intent, factor] of Object.entries(goal.scale)) {
        const path = `behaviors.${name}.goals.${index}`;
        const vars = scopeOf(intent, `${path}.scale.${intent}`);
        if (vars) scale.set(intent, { when: registry.compileExpr(goal.when, vars, `${path}.when`, issues, ['bool']), factor });
      }
      spec.goals.push({ name: goal.name, scale });
    });
    byName.set(name, spec);
  }
  if (issues.length > 0) throw new CompileError(issues);
  return { registry, sets: ids, byName };
}

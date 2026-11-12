// Making an instance of a declared kind. Scenario setup, the `create` effect,
// and referee authoring all come through here, so nothing can enter state
// that the ruleset does not declare.

import { RuleError, type Registry } from '../compile/program.ts';
import { Session, dehydrate, invalid, normalize, type World } from './session.ts';
import { apply, type State, type Value } from './state.ts';

/** The complete, validated fields of a new `kind` instance, or a RuleError saying why it cannot exist. */
export function instantiate(
  registry: Registry, world: World, state: State, kindName: string, id: string, given: Record<string, unknown>,
): Record<string, Value> {
  const kind = registry.kinds.get(kindName);
  if (!kind) throw new RuleError(`the ruleset declares no kind "${kindName}"`);
  if (state.entities[id]) throw new RuleError(`an entity "${id}" already exists`);
  for (const name of Object.keys(given)) {
    if (!kind.fields.has(name)) throw new RuleError(`${kindName} has no field "${name}"`);
  }
  const fields: Record<string, Value> = {};
  const check = (name: string, value: unknown, against: State) => {
    const reason = invalid(registry, world, against, kind.fields.get(name)!.type, value);
    if (reason) throw new RuleError(`${kindName}.${name}: ${reason}`);
    fields[name] = value as Value;
  };
  for (const spec of kind.fields.values()) {
    if (spec.name in given) check(spec.name, normalize(spec.type, given[spec.name]), state);
    else if (spec.default !== undefined) fields[spec.name] = spec.default;
    else if (!spec.init) throw new RuleError(`${kindName} needs "${spec.name}"`);
  }
  for (const spec of kind.fields.values()) {
    if (spec.name in fields || !spec.init) continue;
    const draft = apply(state, { t: 'create', id, kind: kindName, fields: { ...fields } });
    const session = new Session(registry, draft, world);
    check(spec.name, dehydrate(session.eval(spec.init, { self: session.handle(id, kindName) })), draft);
  }
  return fields;
}

// Scenarios: who sits where, what exists at the start, and when the match
// ends. A scenario is checked against its ruleset as strictly as the ruleset
// is checked against the format, and refused with every reason found.

import { versionSatisfies } from '../compile/layers.ts';
import { CompileError, RuleError, type Compiled, type Registry } from '../compile/program.ts';
import { FORMAT_VERSION, type ScenarioDoc } from '../format.ts';
import { createGridHost, noSpace } from '../host/grid.ts';
import { schemaIssues, validators, type Issue } from '../schemas.ts';
import { instantiate } from './instantiate.ts';
import { Session, invalid, normalize, type World } from './session.ts';
import { apply, emptyState, type State, type Value, type Write } from './state.ts';

export interface Scenario {
  doc: ScenarioDoc;
  world: World;
  /** The writes that build the starting state, in order. */
  setup: Write[];
  end: { when: Compiled; outcome: { name: string; value: Compiled }[] }[];
  maxDecisions: number;
}

export function loadScenario(registry: Registry, raw: unknown): Scenario {
  const issues: Issue[] = [];
  const issue = (path: string, message: string) => issues.push({ path: `scenario.${path}`, message });
  const validate = validators.scenario;
  if (!validate(raw)) throw new CompileError(schemaIssues('scenario', validate.errors));
  const doc = raw as ScenarioDoc;
  if (doc.format !== FORMAT_VERSION) issue('format', `format ${doc.format} is not supported; this core reads format ${FORMAT_VERSION}`);
  if (doc.ruleset.id !== registry.id || !versionSatisfies(registry.version, doc.ruleset.version)) {
    issue('ruleset', `written for ${doc.ruleset.id}@${doc.ruleset.version}, but the ruleset is ${registry.id}@${registry.version}`);
  }

  const seats = Object.keys(doc.seats);
  if (registry.seats && (seats.length !== registry.seats.length || registry.seats.some((seat) => !seats.includes(seat)))) {
    issue('seats', `the ruleset fixes the seats as ${registry.seats.join(', ')}`);
  }
  for (const [seat, spec] of Object.entries(doc.seats)) {
    if (spec.behavior && !registry.behaviors.has(spec.behavior)) issue(`seats.${seat}.behavior`, `unknown behavior "${spec.behavior}"`);
  }

  let world: World = { host: noSpace, space: { width: 0, height: 0, unit: 1 }, seats };
  if (registry.space.grid === 'square') {
    const width = doc.space?.width ?? registry.space.width;
    const height = doc.space?.height ?? registry.space.height;
    if (width === undefined || height === undefined) issue('space', 'the ruleset has a grid, so the scenario must give its width and height');
    else if ((registry.space.width ?? width) !== width || (registry.space.height ?? height) !== height) issue('space', 'the ruleset fixes the grid size');
    else {
      const map = { width, height, blocked: doc.space?.blocked };
      world = { host: createGridHost(registry.space, map), space: { width, height, unit: registry.space.unit ?? 1 }, seats };
    }
  } else if (doc.space) issue('space', 'the ruleset declares no space');

  const setup: Write[] = [];
  let state: State = emptyState();
  const write = (event: Write) => {
    setup.push(event);
    state = apply(state, event);
  };

  for (const name of Object.keys(doc.game ?? {})) {
    if (!registry.globals.has(name)) issue(`game.${name}`, 'the ruleset declares no such global');
  }
  for (const spec of registry.globals.values()) {
    const value = doc.game && spec.name in doc.game ? normalize(spec.type, doc.game[spec.name]) : spec.default;
    if (value === undefined) issue(`game.${spec.name}`, 'the ruleset gives no default, so the scenario must set it');
    else {
      const reason = invalid(registry, world, state, spec.type, value);
      if (reason) issue(`game.${spec.name}`, reason);
      else write({ t: 'global', field: spec.name, value: value as Value });
    }
  }

  (doc.entities ?? []).forEach((entity, index) => {
    const id = entity.id ?? `${entity.kind}#${state.nextId}`;
    try {
      write({ t: 'create', id, kind: entity.kind, fields: instantiate(registry, world, state, entity.kind, id, entity.fields ?? {}) });
    } catch (error) {
      if (!(error instanceof RuleError)) throw error;
      issue(`entities.${index}`, error.message);
    }
  });

  (doc.links ?? []).forEach((link, index) => {
    const relation = registry.relations.get(link.rel);
    if (!relation) return issue(`links.${index}.rel`, `unknown relation "${link.rel}"`);
    if (state.entities[link.from]?.kind !== relation.from) return issue(`links.${index}.from`, `"${link.from}" is not an existing ${relation.from}`);
    if (state.entities[link.to]?.kind !== relation.to) return issue(`links.${index}.to`, `"${link.to}" is not an existing ${relation.to}`);
    write({ t: 'link', rel: link.rel, from: link.from, to: link.to });
  });

  if (issues.length === 0) {
    const session = new Session(registry, state, world);
    for (const id of Object.keys(state.entities)) {
      try {
        for (const message of session.failedChecks(id)) issue(`entities.${id}`, message);
      } catch (error) {
        issue(`entities.${id}`, (error as Error).message);
      }
    }
  }

  const end = (doc.end ?? []).map((condition, index) => {
    const report: Issue[] = [];
    const when = registry.compileGlobal(condition.when, `end.${index}.when`, report);
    if (report.length === 0 && when.type !== 'bool') report.push({ path: `end.${index}.when`, message: `an end condition is a bool, not a ${when.type}` });
    const outcome = Object.entries(condition.outcome).map(([name, source]) => ({
      name, value: registry.compileGlobal(source, `end.${index}.outcome.${name}`, report),
    }));
    for (const found of report) issue(found.path, found.message);
    return { when, outcome };
  });

  if (issues.length > 0) throw new CompileError(issues);
  return { doc, world, setup, end, maxDecisions: doc.limits?.maxDecisions ?? 10000 };
}

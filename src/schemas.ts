// JSON Schemas for every authored document. Structure is refused here, before
// any name is resolved or expression parsed: unknown keys fail, so a typo can
// never be silently ignored (fail closed).

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

const NAME = '^[a-z][A-Za-z0-9_]*$';
const DOTTED = '^[a-z][A-Za-z0-9_]*(\\.[a-z][A-Za-z0-9_]*)*$';

const expr = { type: ['string', 'number', 'boolean'] };
const name = { type: 'string', pattern: NAME };
const exprMap = { type: 'object', propertyNames: { pattern: NAME }, additionalProperties: expr };
const typeMap = { type: 'object', propertyNames: { pattern: NAME }, additionalProperties: { type: 'string' } };
const closed = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', additionalProperties: false, properties, required,
});
const named = (value: unknown, pattern = NAME) => ({
  type: 'object', propertyNames: { pattern }, additionalProperties: value,
});

const field = {
  anyOf: [
    { type: 'string' },
    closed({ type: { type: 'string' }, default: {}, init: expr, visible: expr, doc: { type: 'string' } }, ['type']),
  ],
};

const effects = { type: 'array', items: { $ref: '#/$defs/effect' } };
const link = closed({ rel: name, from: expr, to: expr }, ['rel', 'from', 'to']);

const effect = {
  oneOf: [
    closed({ let: exprMap }, ['let']),
    closed({ roll: closed({ as: name, n: expr, d: expr }, ['as', 'd']) }, ['roll']),
    closed({ set: { type: 'object', minProperties: 1, additionalProperties: expr } }, ['set']),
    closed({ create: closed({ kind: name, as: name, fields: exprMap }, ['kind']) }, ['create']),
    closed({ destroy: expr }, ['destroy']),
    closed({ link }, ['link']),
    closed({ unlink: link }, ['unlink']),
    closed({ if: expr, then: effects, else: effects }, ['if', 'then']),
    closed({ each: name, in: expr, do: effects }, ['each', 'in', 'do']),
    closed({ while: expr, do: effects }, ['while', 'do']),
    closed({
      prompt: closed({
        seat: expr, with: exprMap, offer: { type: 'array', items: name, minItems: 1 },
        repeat: { type: 'boolean' }, ifNone: effects,
      }, ['seat', 'offer']),
    }, ['prompt']),
    closed({ done: { const: true } }, ['done']),
    closed({ emit: { type: 'string', pattern: DOTTED }, with: exprMap }, ['emit']),
    closed({ call: name, with: exprMap, as: { type: 'object', propertyNames: { pattern: NAME }, additionalProperties: name } }, ['call']),
  ],
};

const body = {
  uses: {
    type: 'array',
    items: closed({ pattern: name, with: { type: 'object' } }, ['pattern']),
  },
  seats: { type: 'array', items: name, minItems: 1, uniqueItems: true },
  enums: named({ type: 'array', items: { type: 'string', pattern: '^[A-Za-z0-9_./-]+$' }, minItems: 1, uniqueItems: true }),
  tables: named({}),
  space: closed({
    grid: { enum: ['square', 'none'] }, adjacency: { enum: [4, 8] },
    unit: { type: 'integer', minimum: 1 }, increment: { type: 'integer', minimum: 1 },
    vertical: { type: 'boolean' }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 },
    layers: named(closed({ type: { type: 'string' }, default: {}, doc: { type: 'string' } }, ['type', 'default'])),
    blocksMove: expr, blocksSight: expr,
  }, ['grid']),
  globals: named(field),
  kinds: named(closed({
    doc: { type: 'string' },
    fields: named(field),
    derived: named(closed({ type: { type: 'string' }, value: expr, each: name, doc: { type: 'string' } }, ['type', 'value'])),
    checks: { type: 'array', items: closed({ that: expr, message: { type: 'string' } }, ['that', 'message']) },
  })),
  relations: named(closed({ from: name, to: name, inverse: name, doc: { type: 'string' } }, ['from', 'to'])),
  signals: named(closed({ params: typeMap, doc: { type: 'string' } }), DOTTED),
  reactions: {
    type: 'array',
    items: closed({ on: { type: 'string', pattern: DOTTED }, when: expr, do: effects, doc: { type: 'string' } }, ['on', 'do']),
  },
  procedures: named(closed({ params: typeMap, returns: typeMap, do: effects, doc: { type: 'string' } }, ['do'])),
  intents: named(closed({
    doc: { type: 'string' },
    params: named({ anyOf: [{ type: 'string' }, closed({ type: { type: 'string' }, in: expr }, ['type'])] }),
    gate: { anyOf: [expr, { type: 'array', items: expr }] },
    effects,
  }, ['effects'])),
  menus: named({ type: 'array', items: name, uniqueItems: true }),
  flow: effects,
};

const behavior = closed({
  doc: { type: 'string' },
  scores: exprMap,
  goals: {
    type: 'array',
    items: closed({ name: { type: 'string' }, when: expr, scale: named({ type: 'number' }) }, ['name', 'when', 'scale']),
  },
});

const version = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' };
const header = (extra: Record<string, unknown> = {}) =>
  closed({ id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' }, version, title: { type: 'string' }, ...extra }, ['id', 'version']);
const $defs = { effect };

const rulesetSchema = {
  $defs,
  ...closed({
    format: { type: 'integer' }, ruleset: header(),
    open: { type: 'array', items: { type: 'string' } }, ...body,
  }, ['format', 'ruleset']),
};

// An extension is partial by nature: it may give one key of something the base
// declares. Only its header and section names are checked here; its content
// is checked as part of the merged ruleset.
const extensionSchema = closed({
  format: { type: 'integer' }, extension: header(),
  extends: closed({ id: { type: 'string' }, version }, ['id', 'version']),
  ...Object.fromEntries(Object.keys(body).map((section) => [section, { type: ['object', 'array'] }])),
}, ['format', 'extension', 'extends']);

const kitSchema = {
  $defs,
  ...closed({
    format: { type: 'integer' }, kit: header(),
    patterns: named(closed({
      doc: { type: 'string' },
      params: named(closed({ doc: { type: 'string' }, default: {} })),
      // A pattern body is checked after substitution, as part of the layer it expands into.
      emits: { type: 'object' },
    }, ['params', 'emits'])),
  }, ['format', 'kit', 'patterns']),
};

const behaviorSetSchema = closed({
  format: { type: 'integer' },
  behaviorSet: closed({ id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' }, title: { type: 'string' } }, ['id']),
  ruleset: closed({ id: { type: 'string' }, version }, ['id', 'version']),
  extensions: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  behaviors: named(behavior),
}, ['format', 'behaviorSet', 'ruleset', 'behaviors']);

const scenarioSchema = closed({
  format: { type: 'integer' },
  scenario: closed({ id: { type: 'string' }, title: { type: 'string' } }, ['id']),
  ruleset: closed({ id: { type: 'string' }, version }, ['id', 'version']),
  seats: {
    type: 'object', minProperties: 1, propertyNames: { pattern: NAME },
    additionalProperties: closed({ behavior: name, referee: { type: 'boolean' } }),
  },
  space: closed({
    width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 },
    cells: {
      type: 'array',
      items: {
        type: 'object', required: ['at'], propertyNames: { pattern: NAME },
        properties: { at: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 } },
      },
    },
  }, ['width', 'height']),
  game: { type: 'object' },
  entities: {
    type: 'array',
    items: closed({ id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]*$' }, kind: name, fields: { type: 'object' } }, ['kind']),
  },
  links: { type: 'array', items: closed({ rel: name, from: { type: 'string' }, to: { type: 'string' } }, ['rel', 'from', 'to']) },
  end: { type: 'array', items: closed({ when: expr, outcome: exprMap }, ['when', 'outcome']) },
  limits: closed({ maxDecisions: { type: 'integer', minimum: 1 } }),
}, ['format', 'scenario', 'ruleset', 'seats']);

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });

export const validators: Record<'ruleset' | 'extension' | 'kit' | 'behaviorSet' | 'scenario', ValidateFunction> = {
  ruleset: ajv.compile(rulesetSchema),
  extension: ajv.compile(extensionSchema),
  kit: ajv.compile(kitSchema),
  behaviorSet: ajv.compile(behaviorSetSchema),
  scenario: ajv.compile(scenarioSchema),
};

/** One refused thing: where in the document, and why. */
export interface Issue {
  path: string;
  message: string;
}

/**
 * Turns Ajv's errors into issues. A failed `oneOf` reports every branch; the
 * deepest errors are the ones about the branch the author meant, so only
 * those are kept.
 */
export function schemaIssues(prefix: string, errors: ErrorObject[] | null | undefined): Issue[] {
  const all = (errors ?? []).filter((e) => e.keyword !== 'oneOf' && e.keyword !== 'anyOf');
  const byParent = new Map<string, ErrorObject[]>();
  for (const error of all) {
    const key = error.instancePath;
    byParent.set(key, [...(byParent.get(key) ?? []), error]);
  }
  const paths = [...byParent.keys()];
  const issues: Issue[] = [];
  for (const [path, list] of byParent) {
    if (paths.some((other) => other !== path && other.startsWith(`${path}/`))) continue;
    const messages = new Set(list.map((e) =>
      e.keyword === 'additionalProperties' ? `unknown key "${e.params.additionalProperty}"` : e.message ?? e.keyword));
    issues.push({ path: `${prefix}${path.replace(/\//g, '.')}`, message: [...messages].join('; ') });
  }
  return issues;
}

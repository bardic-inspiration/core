// The authored document shapes: ruleset layers, the pattern kit, behavior sets,
// and scenarios.
// These are what a YAML file parses into; `schemas.ts` holds the JSON Schemas
// that refuse anything else, and `docs/format.md` describes them in prose.

/** The format version this build of core reads. Rulesets are versioned separately. */
export const FORMAT_VERSION = 2;

/** A CEL expression. YAML may give a bare number or boolean; the compiler stringifies it. */
export type Expr = string | number | boolean;

export interface FieldDoc {
  type: string;
  /** Literal starting value. */
  default?: unknown;
  /** Expression over `self`, evaluated once when an instance is created. */
  init?: Expr;
  /**
   * Who may see the value: a bool expression over `viewer` (a seat) and, on a
   * kind's field, `self`. Absent: every seat sees it.
   */
  visible?: Expr;
  doc?: string;
}

export interface DerivedDoc {
  type: string;
  value: Expr;
  /** For an enum-keyed map: the variable name bound to each key while `value` is evaluated. */
  each?: string;
  doc?: string;
}

export interface CheckDoc {
  that: Expr;
  message: string;
}

export interface KindDoc {
  doc?: string;
  fields?: Record<string, string | FieldDoc>;
  derived?: Record<string, DerivedDoc>;
  checks?: CheckDoc[];
}

export interface RelationDoc {
  from: string;
  to: string;
  /** Name under which the `to` side reads its `from` entities. */
  inverse?: string;
  doc?: string;
}

export interface ParamDoc {
  type: string;
  /** Domain to enumerate, an expression yielding a list. Absent: the prompt must give the value. */
  in?: Expr;
}

export interface IntentDoc {
  doc?: string;
  params?: Record<string, string | ParamDoc>;
  gate?: Expr | Expr[];
  effects: EffectDoc[];
}

export interface SignalDoc {
  params?: Record<string, string>;
  doc?: string;
}

export interface ReactionDoc {
  on: string;
  when?: Expr;
  do: EffectDoc[];
  doc?: string;
}

export interface ProcedureDoc {
  params?: Record<string, string>;
  returns?: Record<string, string>;
  do: EffectDoc[];
  doc?: string;
}

export interface PromptDoc {
  seat: Expr;
  with?: Record<string, Expr>;
  /** Intent names, menu names, or both. */
  offer: string[];
  repeat?: boolean;
  ifNone?: EffectDoc[];
}

/** The closed set of effects. Each is an object with exactly one head key. */
export type EffectDoc =
  | { let: Record<string, Expr> }
  | { roll: { as: string; n?: Expr; d: Expr } }
  | { set: Record<string, Expr> }
  | { create: { kind: string; as?: string; fields?: Record<string, Expr> } }
  | { destroy: Expr }
  | { link: { rel: string; from: Expr; to: Expr } }
  | { unlink: { rel: string; from: Expr; to: Expr } }
  | { if: Expr; then: EffectDoc[]; else?: EffectDoc[] }
  | { each: string; in: Expr; do: EffectDoc[] }
  | { while: Expr; do: EffectDoc[] }
  | { prompt: PromptDoc }
  | { done: true }
  | { emit: string; with?: Record<string, Expr> }
  | { call: string; with?: Record<string, Expr>; as?: Record<string, string> };

export interface GoalDoc {
  name: string;
  /** Scale factors per intent, applied while `when` holds. */
  when: Expr;
  scale: Record<string, number>;
}

export interface BehaviorDoc {
  doc?: string;
  scores?: Record<string, Expr>;
  goals?: GoalDoc[];
}

/** A typed attribute every cell of the map carries. */
export interface CellLayerDoc {
  /** `int`, `number`, `bool`, `string`, or an enum name. */
  type: string;
  /** The value of a cell the scenario says nothing about. */
  default: unknown;
  doc?: string;
}

export interface SpaceDoc {
  grid: 'square' | 'none';
  /** Which neighbours count as adjacent on a square grid. */
  adjacency?: 4 | 8;
  /** Game units per cell (5 for 5e feet). */
  unit?: number;
  /** Movement increment, in units. Declared for the engine; the rules spend it. */
  increment?: number;
  vertical?: boolean;
  width?: number;
  height?: number;
  /** What each cell holds. The scenario's `space.cells` gives the values. */
  layers?: Record<string, CellLayerDoc>;
  /** A bool expression over `cell` (its layer values): nothing can be in such a cell. The host respects it. */
  blocksMove?: Expr;
  /** A bool expression over `cell`: such a cell breaks a line of sight that crosses it. The host respects it. */
  blocksSight?: Expr;
}

export interface PatternUse {
  pattern: string;
  with?: Record<string, unknown>;
}

/** The sections a layer may contribute. */
export interface RulesBody {
  uses?: PatternUse[];
  seats?: string[];
  enums?: Record<string, string[]>;
  tables?: Record<string, unknown>;
  space?: SpaceDoc;
  globals?: Record<string, string | FieldDoc>;
  kinds?: Record<string, KindDoc>;
  relations?: Record<string, RelationDoc>;
  signals?: Record<string, SignalDoc>;
  reactions?: ReactionDoc[];
  procedures?: Record<string, ProcedureDoc>;
  intents?: Record<string, IntentDoc>;
  /** Named lists of intents a prompt can offer, so a layer can add an intent to a prompt it does not own. */
  menus?: Record<string, string[]>;
  flow?: EffectDoc[];
}

export interface RulesetDoc extends RulesBody {
  format: number;
  ruleset: { id: string; version: string; title?: string };
  /** What extensions may change. `x` opens everything at or under x; `x.+` allows only additions directly under x; `*` is any one key. */
  open?: string[];
}

export interface ExtensionDoc extends RulesBody {
  format: number;
  extension: { id: string; version: string; title?: string };
  extends: { id: string; version: string };
}

/**
 * A set of behaviors, kept apart from the rules they play. It is compiled
 * against a ruleset's registry; sets given together merge in order, so a
 * later one may add behaviors, scores, and goals, or replace them.
 */
export interface BehaviorSetDoc {
  format: number;
  behaviorSet: { id: string; title?: string };
  ruleset: { id: string; version: string };
  /** Extensions whose intents this set scores; each must be among the registry's layers. */
  extensions?: string[];
  behaviors: Record<string, BehaviorDoc>;
}

export interface PatternDoc {
  doc?: string;
  params: Record<string, { doc?: string; default?: unknown }>;
  emits: RulesBody;
}

export interface KitDoc {
  format: number;
  kit: { id: string; version: string };
  patterns: Record<string, PatternDoc>;
}

export interface ScenarioDoc {
  format: number;
  scenario: { id: string; title?: string };
  ruleset: { id: string; version: string };
  seats: Record<string, { behavior?: string; referee?: boolean }>;
  /** The map. Each entry of `cells` gives one cell's layer values: `{ at: [x, y], terrain: wall }`. */
  space?: { width: number; height: number; cells?: ({ at: [number, number] } & Record<string, unknown>)[] };
  game?: Record<string, unknown>;
  entities?: { id?: string; kind: string; fields?: Record<string, unknown> }[];
  links?: { rel: string; from: string; to: string }[];
  /** End conditions belong to the scenario. The first that holds ends the match. */
  end?: { when: Expr; outcome: Record<string, Expr> }[];
  limits?: { maxDecisions?: number };
}

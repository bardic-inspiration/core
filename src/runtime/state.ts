// Game state and the event log. Events are the closed set of writes: every
// change to state is one of them, appended to the log, and `fold` rebuilds
// the state from the log alone (state is the log replayed).

import { produce } from 'immer';

/** A stored value: plain JSON. Entity references are ids, cells are `{ x, y }`. */
export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

export interface Entity {
  kind: string;
  fields: Record<string, Value>;
}

export interface State {
  /** Every live entity by id, in creation order. */
  entities: Record<string, Entity>;
  /** Each relation's links as `[from, to]` pairs, in the order they were made. */
  links: Record<string, [string, string][]>;
  /** The ruleset's globals. */
  game: Record<string, Value>;
  /** The random stream's position. */
  rng: number;
  /** Counter for generated entity ids. */
  nextId: number;
  /** Set once, when a scenario end condition holds or the flow runs out. */
  ended: Record<string, Value> | null;
}

export type Write =
  | { t: 'seed'; rng: number }
  | { t: 'global'; field: string; value: Value }
  | { t: 'create'; id: string; kind: string; fields: Record<string, Value> }
  | { t: 'set'; id: string; field: string; key?: string; value: Value }
  | { t: 'destroy'; id: string }
  | { t: 'link'; rel: string; from: string; to: string }
  | { t: 'unlink'; rel: string; from: string; to: string }
  | { t: 'roll'; n: number; d: number; values: number[]; rng: number }
  | { t: 'end'; outcome: Record<string, Value> };

/** Entries that record what happened without writing state. */
export type Marker =
  | { t: 'intent'; seat: string; intent: string; params: Record<string, Value> }
  | { t: 'signal'; name: string; args: Record<string, Value> };

/** One log entry. `by` marks a write a referee seat authored rather than a rule. */
export type GameEvent = (Write | Marker) & { seq: number; by?: string };

export const emptyState = (): State => ({ entities: {}, links: {}, game: {}, rng: 0, nextId: 1, ended: null });

/** Applies one event. Markers leave state untouched. */
export function apply(state: State, event: Write | Marker): State {
  // Immer's Draft type cannot follow the recursive Value type, so the recipe is typed by hand.
  const recipe = (draft: State): void => {
    switch (event.t) {
      case 'seed':
        draft.rng = event.rng;
        break;
      case 'global':
        draft.game[event.field] = event.value;
        break;
      case 'create':
        draft.entities[event.id] = { kind: event.kind, fields: event.fields };
        draft.nextId += 1;
        break;
      case 'set': {
        const entity = draft.entities[event.id];
        if (!entity) throw new Error(`set on missing entity "${event.id}"`);
        if (event.key === undefined) entity.fields[event.field] = event.value;
        else (entity.fields[event.field] as Record<string, Value>)[event.key] = event.value;
        break;
      }
      case 'destroy':
        delete draft.entities[event.id];
        for (const rel of Object.keys(draft.links)) {
          draft.links[rel] = draft.links[rel].filter(([from, to]) => from !== event.id && to !== event.id);
        }
        break;
      case 'link':
        (draft.links[event.rel] ??= []).push([event.from, event.to]);
        break;
      case 'unlink':
        draft.links[event.rel] = (draft.links[event.rel] ?? []).filter(([from, to]) => from !== event.from || to !== event.to);
        break;
      case 'roll':
        draft.rng = event.rng;
        break;
      case 'end':
        draft.ended = event.outcome;
        break;
      case 'intent':
      case 'signal':
        break;
    }
  };
  return (produce as (base: State, recipe: (draft: State) => void) => State)(state, recipe);
}

/** Rebuilds state from a log: no rules run, only the recorded writes. */
export function fold(log: readonly GameEvent[]): State {
  return log.reduce<State>((state, event) => apply(state, event), emptyState());
}

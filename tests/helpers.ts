import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { existsSync, readdirSync } from 'node:fs';
import {
  bindSeats, compile, compileBehaviors, compileExpression, loadScenario, Match,
  type Behaviors, type BehaviorSetDoc, type Registry, type Scenario, type Seat, type State,
} from '../src/index.ts';
import { loadKit, readYaml } from '../src/load.ts';

export const fixture = (name: string): any => parse(readFileSync(new URL(`./fixtures/${name}.yaml`, import.meta.url), 'utf8'));

/** A minimal valid ruleset to mutate in refusal tests. */
export const tiny = (): any => ({
  format: 2,
  ruleset: { id: 'tiny', version: '1.0.0' },
  enums: { color: ['red', 'blue'] },
  globals: { turns: { type: 'int', default: 0 } },
  kinds: {
    token: {
      fields: { owner: 'seat', color: 'color', value: { type: 'int', default: 1 } },
      derived: { double: { type: 'int', value: 'self.value * 2' } },
      checks: [{ that: 'self.value >= 0', message: 'value cannot be negative' }],
    },
  },
  signals: { bumped: { params: { token: 'token' } } },
  reactions: [{ on: 'bumped', do: [{ set: { 'game.turns': 'game.turns + 1' } }] }],
  intents: {
    bump: {
      params: { token: { type: 'token', in: 'all.token.filter(t, t.owner == seat)' } },
      gate: 'token.value < 3',
      effects: [{ set: { 'token.value': 'token.value + 1' } }, { emit: 'bumped', with: { token: 'token' } }],
    },
  },
  flow: [{ while: 'true', do: [{ each: 'player', in: 'seats', do: [{ prompt: { seat: 'player', offer: ['bump'] } }] }] }],
});

/** A behavior set for the tiny ruleset. */
export const tinyBehaviors = (behaviors: Record<string, unknown> = { eager: { scores: { bump: 1 } } }): any => ({
  format: 2, behaviorSet: { id: 'tiny' }, ruleset: { id: 'tiny', version: '1.0.0' }, behaviors,
});

export const tinyScenario = (): any => ({
  format: 2,
  scenario: { id: 'pair' },
  ruleset: { id: 'tiny', version: '1.0.0' },
  seats: { a: {}, b: {} },
  entities: [
    { id: 't1', kind: 'token', fields: { owner: 'a', color: 'red' } },
    { id: 't2', kind: 'token', fields: { owner: 'b', color: 'blue' } },
  ],
  end: [{ when: 'all.token.all(t, t.value >= 3)', outcome: { result: "'done'", turns: 'game.turns' } }],
});

export const compileWith = (base: unknown, extensions: unknown[] = []): Registry => compile({ kit: loadKit(), base, extensions });

const loaded = new WeakMap<Registry, Behaviors>();

/**
 * The behaviors that ship for a registry's ruleset: its default set, with
 * every other set whose extensions are all loaded laid over it.
 */
export function behaviorsFor(registry: Registry): Behaviors {
  let behaviors = loaded.get(registry);
  if (!behaviors) {
    const dir = `rulesets/${registry.id}/behaviors`;
    const path = new URL(`../${dir}`, import.meta.url);
    const files = existsSync(path) ? readdirSync(path).sort().map((file) => readYaml(`${dir}/${file}`) as BehaviorSetDoc) : [];
    const fits = (set: BehaviorSetDoc) => (set.extensions ?? []).every((id) => registry.layers.some((layer) => layer.id === id));
    const first = (set: BehaviorSetDoc) => (set.behaviorSet.id === 'default' ? 0 : 1);
    behaviors = compileBehaviors(registry, files.filter(fits).sort((a, b) => first(a) - first(b)));
    loaded.set(registry, behaviors);
  }
  return behaviors;
}

/** The seats a scenario names, each driven by its behavior, or at random without one. */
export const aiSeats = (scenario: Scenario, behaviors: Behaviors): Record<string, Seat> => bindSeats(scenario, behaviors);

export const play = (registry: Registry, scenario: Scenario, seed: string | number, behaviors = behaviorsFor(registry)) => {
  const match = new Match(registry, scenario, seed);
  return { match, ...match.run(bindSeats(scenario, behaviors)) };
};

/** The CompileError message of a refused input, or '' when it was accepted. */
export function refusal(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (error) {
    if ((error as Error).name !== 'CompileError') throw error;
    return (error as Error).message;
  }
}

export { loadScenario };

/** Advances to the next decision and takes the first option matching `want`; fails if none does. */
export function choose(match: Match, seat: string, intent: string, want: Record<string, unknown> = {}): void {
  const decision = match.advance();
  if (!decision) throw new Error(`the match ended before ${seat} could ${intent}`);
  if (decision.seat !== seat) throw new Error(`expected ${seat} to decide, but it is ${decision.seat}'s decision`);
  const index = decision.options.findIndex((option) =>
    option.intent === intent && Object.entries(want).every(([name, value]) => JSON.stringify(option.params[name]) === JSON.stringify(value)));
  if (index < 0) throw new Error(`${seat} cannot ${intent} ${JSON.stringify(want)}; legal: ${JSON.stringify(decision.options)}`);
  match.submit(index);
}

/** Evaluates a global-scope expression over a state, as a stored value. */
export function read(registry: Registry, scenario: Scenario, state: State, source: string): unknown {
  return compileExpression(registry, source).evaluate(state, scenario);
}

/** Ends turns and declines reactions until `seat` is asked to choose `intent` (or anything, when no intent is named). */
export function until(match: Match, seat: string, intent?: string): void {
  for (let decision = match.advance(); decision; decision = match.advance()) {
    if (decision.seat === seat && (!intent || decision.options.some((option) => option.intent === intent))) return;
    const pass = decision.options.findIndex((option) => ['endTurn', 'holdReaction', 'idle', 'check', 'fold'].includes(option.intent));
    if (pass < 0) throw new Error(`${decision.seat} has no way to pass: ${JSON.stringify(decision.options)}`);
    match.submit(pass);
  }
  throw new Error(`the match ended before ${seat} was asked`);
}

/**
 * Dice are seeded, so a test that needs a particular roll looks for a seed
 * that gives it: runs `attempt` on seeds 1 to 60 and returns the first result
 * that is not undefined.
 */
export function findSeed<T>(attempt: (seed: number) => T | undefined): T {
  for (let seed = 1; seed <= 60; seed++) {
    const found = attempt(seed);
    if (found !== undefined) return found;
  }
  throw new Error('no seed from 1 to 60 gave the roll this test needs');
}

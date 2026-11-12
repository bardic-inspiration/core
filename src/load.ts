// Node-side loading: reads YAML from disk and hands plain data to `compile`.
// Core itself never touches the file system, so the engine can bundle it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { compile } from './compile/resolve.ts';
import type { Registry } from './compile/program.ts';
import { loadScenario, type Scenario } from './runtime/scenario.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

export const readYaml = (path: string): unknown => parse(readFileSync(path.startsWith('/') ? path : `${root}${path}`, 'utf8'));

/** The standard pattern kit that ships with core. */
export const loadKit = (): unknown => readYaml('kit/patterns.yaml');

/** Compiles `rulesets/<name>/ruleset.yaml` with the standard kit and any extension files. */
export function loadRuleset(name: string, extensions: string[] = []): Registry {
  return compile({
    kit: loadKit(),
    base: readYaml(`rulesets/${name}/ruleset.yaml`),
    extensions: extensions.map((file) => readYaml(`rulesets/${name}/extensions/${file}.yaml`)),
  });
}

export const loadScenarioFile = (registry: Registry, name: string, scenario: string): Scenario =>
  loadScenario(registry, readYaml(`rulesets/${name}/scenarios/${scenario}.yaml`));

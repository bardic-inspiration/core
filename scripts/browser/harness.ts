// Bundles core for the browser and runs jobs in it, two ways: in a bare
// JavaScript realm inside Node (no `process`, no `require`, nothing but the
// language and the few web globals core uses), and in a real Web Worker in
// headless Chromium.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { readMaps, readYaml } from '../../src/load.ts';
import type { Job, JobResult } from './job.ts';

/** The page's side of a Web Worker, as far as this file uses it. Core is typed without the DOM. */
declare const Worker: new (url: string) => {
  onmessage: ((event: { data: JobResult | { error: string } }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
};

/**
 * The worker as one browser script. Bundling for the browser fails on any
 * import of a Node built-in, so a bundle is itself the check that core
 * reaches for none.
 */
export async function bundleWorker(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./worker.ts', import.meta.url))],
    bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

/** A shipped scenario as a job: the plain data a page would hand its worker. */
export const shippedJob = (ruleset: string, scenario: string, seeds: number[]): Job => ({
  kit: readYaml('kit/patterns.yaml'),
  ruleset: readYaml(`rulesets/${ruleset}/ruleset.yaml`),
  behaviors: [readYaml(`rulesets/${ruleset}/behaviors/default.yaml`)],
  scenario: readYaml(`rulesets/${ruleset}/scenarios/${scenario}.yaml`),
  maps: readMaps(ruleset),
  seeds,
});

const settle = (reply: JobResult | { error: string }): JobResult => {
  if ('error' in reply) throw new Error(reply.error);
  return reply;
};

/** Runs a job in a realm that has the web's globals core uses and none of Node's. */
export function runInBareRealm(bundle: string, job: Job): JobResult {
  let reply: JobResult | { error: string } | undefined;
  const realm = vm.createContext({
    TextEncoder, TextDecoder, performance: { now: () => performance.now() }, console,
    postMessage: (message: JobResult | { error: string }) => { reply = message; },
  });
  // Node's own structuredClone would hand back objects of Node's realm. Core clones only plain data, so this stands in.
  vm.runInContext(`globalThis.structuredClone = function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
  };`, realm);
  vm.runInContext(bundle, realm);
  // The job crosses as JSON, so no object of Node's realm leaks in.
  vm.runInContext(`onmessage({ data: JSON.parse(${JSON.stringify(JSON.stringify(job))}) })`, realm);
  return settle(reply!);
}

export interface Browser {
  version: string;
  run(job: Job): Promise<JobResult>;
  close(): Promise<void>;
}

/** Headless Chromium with the bundle loaded as a Web Worker. Each job gets a fresh worker. */
export async function openBrowser(bundle: string): Promise<Browser> {
  // Playwright is resolved as CommonJS so that an install outside this package is found too.
  const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(`Chromium did not start; install it with \`npx playwright install chromium\`.\n${(error as Error).message}`);
  }
  const page = await browser.newPage();
  await page.route('http://core.test/**', (route) => (route.request().url().endsWith('/worker.js')
    ? route.fulfill({ contentType: 'text/javascript', body: bundle })
    : route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>core</title>' })));
  await page.goto('http://core.test/');
  return {
    version: browser.version(),
    run: async (job) => settle(await page.evaluate((given) => new Promise<JobResult | { error: string }>((resolve) => {
      const worker = new Worker('/worker.js');
      worker.onmessage = (event) => {
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = (event) => resolve({ error: event.message });
      worker.postMessage(given);
    }), job)),
    close: () => browser.close(),
  };
}

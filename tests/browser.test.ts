// Core in the browser. The bundle is built for the browser, which fails on
// any Node built-in; it then compiles and plays in a realm with none of
// Node's globals, and in a Web Worker in headless Chromium. Both must write
// the logs Node writes. `npm run browser` does the same for every scenario
// and prints timings.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJob } from '../scripts/browser/job.ts';
import { bundleWorker, openBrowser, runInBareRealm, shippedJob, type Browser } from '../scripts/browser/harness.ts';

const jobs = [
  shippedJob('dnd-5e-2024-slice', 'worg-vs-scout', [1, 2, 3]),
  shippedJob('holdem', 'four-handed', [1]),
];

describe('core in the browser', () => {
  let bundle = '';
  let browser: Browser | undefined;
  beforeAll(async () => {
    bundle = await bundleWorker();
  });
  afterAll(() => browser?.close());

  it('bundles for the browser with no Node built-in', () => {
    expect(bundle.length).toBeGreaterThan(10_000);
    expect(bundle).not.toMatch(/require\(["']node:/);
  });

  it('compiles and plays in a realm without Node\'s globals', () => {
    for (const job of jobs) {
      expect(runInBareRealm(bundle, job).matches.map((match) => match.logHash)).toEqual(runJob(job).matches.map((match) => match.logHash));
    }
  });

  it('compiles and plays in a Web Worker in Chromium, writing the logs Node writes', async () => {
    browser = await openBrowser(bundle);
    for (const job of jobs) {
      const worker = await browser.run(job);
      expect(worker.matches.map((match) => match.logHash)).toEqual(runJob(job).matches.map((match) => match.logHash));
      expect(worker.compileMs).toBeGreaterThan(0);
    }
  });

  it('reports a refusal from the worker as an error', async () => {
    browser ??= await openBrowser(bundle);
    await expect(browser.run({ ...jobs[0], ruleset: { format: 2 } })).rejects.toThrow(/CompileError/);
  });
});

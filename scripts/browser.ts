// Plays every shipped scenario in a Web Worker in headless Chromium and in
// Node, checks that both write the same logs, and prints the timings.
//   npm run browser -- [--seeds 10]

import { runJob } from './browser/job.ts';
import { bundleWorker, openBrowser, shippedJob } from './browser/harness.ts';
import { shipped } from './measure.ts';

const args = process.argv.slice(2);
const count = Number(args[args.indexOf('--seeds') + 1] || 10);
const seeds = Array.from({ length: count }, (_, index) => index + 1);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const bundle = await bundleWorker();
const browser = await openBrowser(bundle);
const rows: Record<string, string | number>[] = [];
let failed = false;
try {
  for (const { ruleset, scenario } of shipped()) {
    const job = shippedJob(ruleset, scenario, seeds);
    const node = runJob(job);
    const worker = await browser.run(job);
    const same = node.matches.every((match, index) => match.logHash === worker.matches[index].logHash);
    failed ||= !same;
    rows.push({
      scenario: `${ruleset}/${scenario}`,
      'same logs': same ? 'yes' : 'NO',
      'node compile ms': Math.round(node.compileMs),
      'worker compile ms': Math.round(worker.compileMs),
      'node ms/match': Math.round(mean(node.matches.map((match) => match.ms))),
      'worker ms/match': Math.round(mean(worker.matches.map((match) => match.ms))),
    });
  }
} finally {
  await browser.close();
}
console.log(`Node ${process.version}, Chromium ${browser.version}, bundle ${Math.round(bundle.length / 1024)} kB, seeds 1 to ${count}`);
console.table(rows);
process.exit(failed ? 1 : 0);

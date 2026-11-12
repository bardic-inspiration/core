// The Web Worker entry: a job comes in as a message, its result goes back.

import { runJob, type Job } from './job.ts';

const scope = globalThis as unknown as { onmessage: (event: { data: Job }) => void; postMessage(message: unknown): void };

scope.onmessage = (event) => {
  try {
    scope.postMessage(runJob(event.data));
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
};

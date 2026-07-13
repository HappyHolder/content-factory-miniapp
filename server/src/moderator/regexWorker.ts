import { parentPort } from 'worker_threads';

type Job = { patterns: string[]; text: string };
parentPort?.on('message', (job: Job) => {
  try {
    for (const pattern of job.patterns) if (new RegExp(pattern, 'iu').test(job.text)) { parentPort?.postMessage({ pattern }); return; }
    parentPort?.postMessage({ pattern: null });
  } catch { parentPort?.postMessage({ pattern: null }); }
});

import path from 'path';
import { Worker } from 'worker_threads';

export async function matchRegexWithTimeout(patterns: string[], text: string, timeoutMs = 100): Promise<string | null> {
  if (!patterns.length || !text) return null;
  return new Promise(resolve => {
    const worker = new Worker(path.join(__dirname, 'regexWorker.js'));
    let settled = false;
    let evaluationTimer: NodeJS.Timeout | undefined;
    const startupTimer = setTimeout(() => finish(null), Math.max(1000, timeoutMs * 5));
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (evaluationTimer) clearTimeout(evaluationTimer);
      void worker.terminate();
      resolve(value);
    };
    worker.once('message', (result: { pattern?: unknown }) => finish(typeof result.pattern === 'string' ? result.pattern : null));
    worker.once('error', () => finish(null));
    worker.once('online', () => {
      evaluationTimer = setTimeout(() => finish(null), timeoutMs);
      worker.postMessage({ patterns, text: text.slice(0, 4096) });
    });
  });
}

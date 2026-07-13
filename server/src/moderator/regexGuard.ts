import path from 'path';
import { Worker } from 'worker_threads';

export async function matchRegexWithTimeout(patterns: string[], text: string, timeoutMs = 100): Promise<string | null> {
  if (!patterns.length || !text) return null;
  return new Promise(resolve => {
    const worker = new Worker(path.join(__dirname, 'regexWorker.js'));
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    worker.once('message', (result: { pattern?: unknown }) => finish(typeof result.pattern === 'string' ? result.pattern : null));
    worker.once('error', () => finish(null));
    worker.postMessage({ patterns, text: text.slice(0, 4096) });
  });
}

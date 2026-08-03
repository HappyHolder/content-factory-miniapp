type ImmediateScheduler = (callback: () => void) => unknown;

/**
 * Defers non-critical webhook work until the next event-loop turn.
 *
 * Express can finish writing the Telegram acknowledgement before expensive AI,
 * extraction or rendering work begins. Errors are always observed so a failed
 * background task cannot become an unhandled rejection.
 */
export function runWebhookBackgroundTask(
  task: () => Promise<void>,
  onError: (error: unknown) => void,
  schedule: ImmediateScheduler = setImmediate,
): void {
  schedule(() => {
    void task().catch(onError);
  });
}

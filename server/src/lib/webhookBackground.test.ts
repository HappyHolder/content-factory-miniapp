import test from 'node:test';
import assert from 'node:assert/strict';
import { runWebhookBackgroundTask } from './webhookBackground';

test('webhook background work never starts in the acknowledgement turn', async () => {
  const scheduled: (() => void)[] = [];
  let started = false;

  runWebhookBackgroundTask(
    async () => { started = true; },
    () => assert.fail('background task should not fail'),
    callback => scheduled.push(callback),
  );

  assert.equal(started, false);
  assert.equal(scheduled.length, 1);

  scheduled[0]!();
  await Promise.resolve();
  assert.equal(started, true);
});

test('webhook background work reports rejected tasks', async () => {
  const scheduled: (() => void)[] = [];
  let reported: unknown;
  const failure = new Error('generation failed');

  runWebhookBackgroundTask(
    async () => { throw failure; },
    error => { reported = error; },
    callback => scheduled.push(callback),
  );

  scheduled[0]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reported, failure);
});

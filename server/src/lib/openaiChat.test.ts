import assert from 'node:assert/strict';
import test from 'node:test';

// terraText has no second provider any more, so openAiText's retry IS the
// resilience of moderation, the Community Manager and Community Core. These
// tests pin that behaviour against a stubbed fetch — no API key, no network.
process.env['OPENAI_API_KEY'] = 'sk-test';
process.env['OPENAI_CHAT_MODEL'] = 'gpt-5.6-terra';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { openAiText } = require('./openaiChat') as typeof import('./openaiChat');

type Stub = { ok: boolean; status: number; json?: () => Promise<unknown>; text?: () => Promise<string> };
const ok = (text: string): Stub => ({
  ok: true, status: 200,
  json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
});
const httpError = (status: number, body = '{}'): Stub => ({ ok: false, status, text: async () => body });

/** Serves `responses` in order (repeating the last), and counts the calls. */
function stubFetch(responses: (Stub | (() => Stub))[]): () => number {
  let calls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => {
    const entry = responses[Math.min(calls, responses.length - 1)];
    calls++;
    return typeof entry === 'function' ? entry() : entry;
  };
  return () => calls;
}

const call = (timeoutMs = 20_000) => openAiText({ system: 's', prompt: 'p', timeoutMs });

test('a successful call does not retry', async () => {
  const calls = stubFetch([ok('hello')]);
  assert.equal(await call(), 'hello');
  assert.equal(calls(), 1);
});

test('429 and 5xx are retried once', async () => {
  let calls = stubFetch([httpError(429, 'rate limited'), ok('recovered')]);
  assert.equal(await call(), 'recovered');
  assert.equal(calls(), 2);

  calls = stubFetch([httpError(503), ok('recovered')]);
  assert.equal(await call(), 'recovered');
  assert.equal(calls(), 2);
});

test('auth and request errors are never retried — they cannot fix themselves', async () => {
  let calls = stubFetch([httpError(401, 'Incorrect API key')]);
  assert.equal(await call(), null);
  assert.equal(calls(), 1);

  calls = stubFetch([httpError(400, 'bad request')]);
  assert.equal(await call(), null);
  assert.equal(calls(), 1);
});

test('a dropped connection is retried once, then gives up', async () => {
  const calls = stubFetch([() => { throw new Error('ECONNRESET'); }]);
  assert.equal(await call(), null);
  assert.equal(calls(), 2);
});

test('timeoutMs is the total budget: a tight one suppresses the retry', async () => {
  // The moderator webhook path allows 25 s; a retry must never push past it.
  const calls = stubFetch([httpError(429)]);
  assert.equal(await call(1_500), null);
  assert.equal(calls(), 1);
});

test('a truncated answer returns null instead of burning a second call', async () => {
  const calls = stubFetch([{ ok: true, status: 200, json: async () => ({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }) }]);
  assert.equal(await call(), null);
  assert.equal(calls(), 1);
});

test('text is read from output items — this model sends no output_text field', async () => {
  stubFetch([{ ok: true, status: 200, json: async () => ({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '  {"violation":false}  ' }] }] }) }]);
  assert.equal(await call(), '{"violation":false}');
});

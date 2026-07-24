import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMaxTokens } from './replicateText';

test('Anthropic models never receive a max_tokens Replicate rejects', () => {
  // 150 (image prompts) and 800 (template slots) used to 422 and silently
  // degraded covers to a topic-free fallback prompt.
  assert.equal(resolveMaxTokens('anthropic/claude-4.5-sonnet', 150), 1024);
  assert.equal(resolveMaxTokens('anthropic/claude-4.5-sonnet', 800), 1024);
  assert.equal(resolveMaxTokens('anthropic/claude-4.5-sonnet', 4096), 4096);
});

test('other providers and unset values pass through untouched', () => {
  assert.equal(resolveMaxTokens('openai/gpt-5.6-terra', 150), 150);
  assert.equal(resolveMaxTokens('anthropic/claude-4.5-sonnet', undefined), undefined);
  assert.equal(resolveMaxTokens('openai/gpt-5.6-terra', undefined), undefined);
});

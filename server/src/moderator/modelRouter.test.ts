import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDecision, safeSuggestedRewrite } from './modelRouter.js';

test('parses a moderation verdict with a suggested rewrite', () => {
  const decision = parseDecision(JSON.stringify({
    violation: true,
    category: 'profanity',
    confidence: 0.97,
    reason: 'Мат',
    suggestedRewrite: 'Почему это снова не работает? Я очень устал это переделывать.',
  }), 'fallback');
  assert.equal(decision?.category, 'profanity');
  assert.equal(decision?.suggestedRewrite, 'Почему это снова не работает? Я очень устал это переделывать.');
});

test('accepts a meaning-preserving rewrite with original details', () => {
  const original = '@team, релиз 2.4 описан на https://example.com — какого чёрта он опять сломан?';
  const rewrite = '@team, релиз 2.4 описан на https://example.com — почему он опять сломан?';
  assert.equal(safeSuggestedRewrite(original, rewrite), rewrite);
});

test('rejects rewrites that invent links, mentions or numbers', () => {
  const original = 'Релиз 2.4 опять сломан';
  assert.equal(safeSuggestedRewrite(original, 'Релиз 3.0 опять сломан'), null);
  assert.equal(safeSuggestedRewrite(original, '@admin, релиз 2.4 опять сломан'), null);
  assert.equal(safeSuggestedRewrite(original, 'Релиз 2.4: https://fake.example'), null);
});

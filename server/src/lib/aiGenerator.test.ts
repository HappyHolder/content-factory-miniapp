import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVariantPrompts, extractProtectedSourceTerms } from './aiGenerator.js';

const mixedRussianSource =
  '\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043a\u043e\u043c\u0430\u043d\u0434\u0430 OpenAI \u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u043b\u0430 ChatGPT \u0438 \u043c\u043e\u0434\u0435\u043b\u044c GPT-5 \u0434\u043b\u044f \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a\u043e\u0432. ' +
  '\u041d\u043e\u0432\u0430\u044f \u0444\u0443\u043d\u043a\u0446\u0438\u044f \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0432\u043d\u0443\u0442\u0440\u0438 Telegram Mini Apps \u0438 \u043f\u043e\u043c\u043e\u0433\u0430\u0435\u0442 \u0431\u044b\u0441\u0442\u0440\u0435\u0435 \u0441\u043e\u0431\u0438\u0440\u0430\u0442\u044c \u043f\u0443\u0431\u043b\u0438\u043a\u0430\u0446\u0438\u0438. ' +
  '\u041e\u0442\u0434\u0435\u043b\u044c\u043d\u043e \u0443\u043f\u043e\u043c\u044f\u043d\u0443\u0442\u044b LayerZero, TON, @UsefulBot \u0438 \u0442\u0438\u043a\u0435\u0440 $TON. \u041e\u0441\u0442\u0430\u043b\u044c\u043d\u043e\u0439 \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u0439 \u0442\u0435\u043a\u0441\u0442 \u043d\u0430\u043f\u0438\u0441\u0430\u043d \u043f\u043e-\u0440\u0443\u0441\u0441\u043a\u0438.';

test('extracts immutable Latin names from a mainly Russian source', () => {
  assert.deepEqual(extractProtectedSourceTerms(mixedRussianSource), [
    'OpenAI',
    'ChatGPT',
    'GPT-5',
    'Telegram Mini Apps',
    'LayerZero',
    'TON',
    '@UsefulBot',
    '$TON',
  ]);
});

test('does not turn an English source into a blanket preserve list', () => {
  assert.deepEqual(
    extractProtectedSourceTerms('OpenAI released a new ChatGPT model for developers around the world.'),
    [],
  );
});

test('Russian prompt preserves source names instead of banning English words', () => {
  const prompts = buildVariantPrompts({
    input: mixedRussianSource,
    sourceType: 'prompt',
    channel: { handle: 'publium', name: 'Publium' },
    brandKit: { voiceProfile: { language: 'RU' } },
  });

  assert.ok(prompts.systemPrompt.includes('Write the prose in Russian'));
  assert.ok(prompts.systemPrompt.includes('preserve source-language proper nouns exactly as written'));
  assert.ok(prompts.userPrompt.includes('=== Preserve exactly in both variants ==='));
  assert.ok(prompts.protectedTerms.includes('OpenAI'));
  assert.ok(prompts.protectedTerms.includes('Telegram Mini Apps'));
  assert.equal(prompts.systemPrompt.includes('not a single word of English'), false);
});

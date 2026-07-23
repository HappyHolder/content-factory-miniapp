import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTemplateSlotFallback } from './templateSlotFallback';

test('fills the critical Publium update slots without an AI response', () => {
  const values = buildTemplateSlotFallback(
    ['BRAND', 'RUBRIC', 'VERSION', 'TITLE_WHITE', 'TITLE_ACCENT', 'CH1', 'CH2', 'CH3'],
    {
      title: 'Publium v1.4 - Community Core',
      content: [
        'Живое AI-ядро для Telegram-комьюнити.',
        'Персонажи поддерживают разговор.',
        'Они сохраняют общий контекст беседы.',
      ].join('\n'),
      coverLanguage: 'ru',
    },
    { name: 'Publium', rubricName: 'Новости' },
  );

  assert.equal(values.BRAND, 'Publium');
  assert.equal(values.RUBRIC, 'Новости');
  assert.equal(values.VERSION, 'v1.4');
  assert.ok(values.TITLE_WHITE);
  assert.ok(values.TITLE_ACCENT);
  assert.ok(values.CH1);
  assert.ok(values.CH2);
  assert.ok(values.CH3);
});

test('never invents a metric when the post has none', () => {
  const values = buildTemplateSlotFallback(
    ['VALUE', 'STAT', 'TITLE_WHITE', 'TITLE_ACCENT'],
    { title: 'Новый режим сообщества', content: 'Обсуждения продолжаются без ручной рутины.' },
  );

  assert.equal(values.VALUE, '');
  assert.equal(values.STAT, '');
  assert.equal(`${values.TITLE_WHITE} ${values.TITLE_ACCENT}`.trim(), 'Новый режим сообщества');
});

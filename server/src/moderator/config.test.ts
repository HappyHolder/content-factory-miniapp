import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBlocks } from './config.js';

test('keeps old antispam configs backward compatible', () => {
  const [block] = parseBlocks([{ id: 'anti', type: 'antispam', enabled: true }]);
  assert.equal(block?.type, 'antispam');
  if (block?.type !== 'antispam') return;
  assert.equal(block.telegramBotsMode, 'allow');
  assert.deepEqual(block.allowedBotUsernames, []);
});

test('normalizes the allowed Telegram bot list', () => {
  const [block] = parseBlocks([{
    id: 'anti',
    type: 'antispam',
    enabled: true,
    telegramBotsMode: 'allowlist',
    allowedBotUsernames: ['@UsefulBot', 'https://t.me/Another_Bot?start=1', 'ordinary_user', '@UsefulBot'],
  }]);
  assert.equal(block?.type, 'antispam');
  if (block?.type !== 'antispam') return;
  assert.equal(block.telegramBotsMode, 'allowlist');
  assert.deepEqual(block.allowedBotUsernames, ['usefulbot', 'another_bot']);
});

test('migrates legacy one-message AI settings into profanity moderation', () => {
  const [block] = parseBlocks([{
    id: 'ai', type: 'ai_moderation', enabled: true, rules: 'Без мата',
    action: 'delete_rewrite_warn', confidenceThreshold: 0.9, minLength: 8,
  }]);
  assert.equal(block?.type, 'ai_moderation');
  if (block?.type !== 'ai_moderation') return;
  assert.equal(block.messageModeration.enabled, true);
  assert.equal(block.messageModeration.action, 'delete_rewrite_warn');
  assert.equal(block.messageModeration.confidenceThreshold, 0.9);
  assert.equal(block.messageModeration.minLength, 8);
  assert.equal(block.messageModeration.customRule, '');
});

test('migrates legacy conversation settings without turning them into profanity rules', () => {
  const [block] = parseBlocks([{ id: 'ai', type: 'ai_moderation', enabled: true, rules: 'Без травли', interventionsEnabled: true, interventionMode: 'respond_warn', cooldownSeconds: 3600 }]);
  assert.equal(block?.type, 'ai_moderation');
  if (block?.type !== 'ai_moderation') return;
  assert.equal(block.conversationAnalysis.enabled, true);
  assert.equal(block.conversationAnalysis.reaction, 'respond');
  assert.equal(block.conversationAnalysis.customRules, 'Без травли');
  assert.equal(block.messageModeration.customRule, '');
  assert.equal('cooldownSeconds' in block, false);
  assert.equal('repeatAction' in block, false);
});

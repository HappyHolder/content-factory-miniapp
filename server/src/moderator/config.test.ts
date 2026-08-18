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

test('accepts cultural rewrite AI actions and one-character checks', () => {
  const [block] = parseBlocks([{
    id: 'ai', type: 'ai_moderation', enabled: true, rules: 'Без мата',
    action: 'delete_rewrite_warn', minLength: 1,
  }]);
  assert.equal(block?.type, 'ai_moderation');
  if (block?.type !== 'ai_moderation') return;
  assert.equal(block.action, 'delete_rewrite_warn');
  assert.equal(block.minLength, 1);
});

test('migrates legacy intervention sanctions to soft responses', () => {
  const [block] = parseBlocks([{ id: 'ai', type: 'ai_moderation', enabled: true, rules: 'Без травли', interventionsEnabled: true, interventionMode: 'respond_warn', cooldownSeconds: 3600 }]);
  assert.equal(block?.type, 'ai_moderation');
  if (block?.type !== 'ai_moderation') return;
  assert.equal(block.interventionMode, 'respond');
  assert.equal('cooldownSeconds' in block, false);
  assert.equal('repeatAction' in block, false);
});

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

import assert from 'node:assert/strict';
import test from 'node:test';
import { botChannelLabel, buildChannelPickerKeyboard, buildQuickActionsKeyboard, isChannelButtonText, parseChannelCallback, versionedMiniAppUrl } from './botQuickActions';

const channels = [
  { id: 'channel-one', name: 'First channel', handle: 'first' },
  { id: 'channel-two', name: 'Private channel', handle: null },
];

test('builds the two-button persistent keyboard', () => {
  assert.deepEqual(buildQuickActionsKeyboard(channels[0]!, 'https://publium.ru'), {
    keyboard: [[
      { text: 'Канал · @first' },
      { text: 'Открыть Publium', web_app: { url: 'https://publium.ru' } },
    ]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Пришлите текст, ссылку или фото',
  });
});

test('marks only the active channel in the picker', () => {
  assert.deepEqual(buildChannelPickerKeyboard(channels, 'channel-two'), {
    inline_keyboard: [
      [{ text: '@first', callback_data: 'channel:channel-one' }],
      [{ text: '✓ Private channel', callback_data: 'channel:channel-two' }],
    ],
  });
});

test('recognizes channel keyboard text and parses safe callbacks', () => {
  assert.equal(isChannelButtonText('Канал · @first'), true);
  assert.equal(isChannelButtonText('/channel'), true);
  assert.equal(isChannelButtonText('сырой материал'), false);
  assert.equal(parseChannelCallback('channel:channel-two'), 'channel-two');
  assert.equal(parseChannelCallback('post:channel-two'), null);
  assert.equal(botChannelLabel({ id: 'x', name: 'X', handle: '@double' }), '@double');
});
test('versions the Telegram Web App URL without changing its route or existing query',()=>{
  assert.equal(versionedMiniAppUrl('https://publium.ru/app?source=bot','release-42'),'https://publium.ru/app?source=bot&app_release=release-42');
  assert.equal(versionedMiniAppUrl(undefined,'release-42'),undefined);
});
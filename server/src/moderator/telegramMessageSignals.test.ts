import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBotUsername, telegramBotPolicyViolation, telegramMessageSignals } from './telegramMessageSignals.js';

test('normalizes Telegram bot usernames safely', () => {
  assert.equal(normalizeBotUsername('@Useful_Bot'), 'useful_bot');
  assert.equal(normalizeBotUsername('ordinary_user'), null);
  assert.equal(normalizeBotUsername('bot'), null);
});

test('detects the inline bot through which a human sent a message', () => {
  const signals = telegramMessageSignals({
    text: 'Карточка проекта',
    via_bot: { id: 42, username: 'ScamPromoBot', is_bot: true },
  });
  assert.equal(signals.viaBotId, 42);
  assert.equal(signals.viaBotUsername, 'scampromobot');
  assert.deepEqual(signals.botUsernames, ['scampromobot']);
});

test('extracts links and bot targets hidden in inline buttons', () => {
  const signals = telegramMessageSignals({
    reply_markup: {
      inline_keyboard: [[
        { url: 'https://t.me/HiddenScamBot?start=promo' },
        { web_app: { url: 'https://scam.example/app' } },
      ]],
    },
  });
  assert.deepEqual(signals.domains.sort(), ['scam.example', 't.me']);
  assert.deepEqual(signals.botUsernames, ['hiddenscambot']);
});

test('detects bot mentions and full t.me targets without treating ordinary usernames as bots', () => {
  const signals = telegramMessageSignals({
    text: 'Пишите @SupportScamBot, не @ordinary_user — https://t.me/SecondScamBot',
  });
  assert.deepEqual(signals.botUsernames.sort(), ['secondscambot', 'supportscambot']);
});

test('detects tg resolve links to bots', () => {
  const signals = telegramMessageSignals({
    text: 'Открыть',
    entities: [{ type: 'text_link', offset: 0, length: 7, url: 'tg://resolve?domain=DeepLinkBot' }],
  });
  assert.deepEqual(signals.urls, ['tg://resolve?domain=DeepLinkBot']);
  assert.deepEqual(signals.botUsernames, ['deeplinkbot']);
});

test('reads caption entities using the caption text', () => {
  const caption = 'Открыть сайт';
  const signals = telegramMessageSignals({
    caption,
    caption_entities: [{ type: 'text_link', offset: 0, length: caption.length, url: 'https://example.com/path' }],
  });
  assert.deepEqual(signals.domains, ['example.com']);
});

test('applies the bot policy to via bots and bot references', () => {
  const viaSignals = telegramMessageSignals({ via_bot: { id: 42, username: 'ScamPromoBot', is_bot: true } });
  assert.deepEqual(telegramBotPolicyViolation(viaSignals, 'block_all', []), {
    reason: 'VIA_BOT_BLOCKED', botUsername: 'scampromobot', viaBotId: 42,
  });
  assert.equal(telegramBotPolicyViolation(viaSignals, 'allowlist', ['scampromobot']), null);

  const mentionSignals = telegramMessageSignals({ text: 'Contact @AnotherScamBot' });
  assert.deepEqual(telegramBotPolicyViolation(mentionSignals, 'allowlist', ['usefulbot']), {
    reason: 'BOT_REFERENCE_BLOCKED', botUsername: 'anotherscambot', viaBotId: null,
  });
});

test('blocks an unidentified via bot in allowlist mode', () => {
  const signals = telegramMessageSignals({ via_bot: { id: 99, is_bot: true } });
  assert.deepEqual(telegramBotPolicyViolation(signals, 'allowlist', ['usefulbot']), {
    reason: 'VIA_BOT_BLOCKED', botUsername: null, viaBotId: 99,
  });
});

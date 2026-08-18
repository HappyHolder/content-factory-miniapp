import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStandaloneChatStyleContext,
  chatStyleRulesSnapshot,
  moderatorChannelContext,
  protectUnconfiguredStandaloneOffTopic,
  readPublishedChatStyle,
} from './chatStyleContext';

test('builds a compact standalone chat context from semantic BrandKit fields', () => {
  const context = buildStandaloneChatStyleContext({
    name: 'Telegram Mini Apps Collaboration',
    channelAbout: { topic: ' Mini Apps and collaborations ', targetAudience: 'Founders', contentGoal: 'Partnerships' },
    voiceProfile: { language: 'RU', tone: 'expert', customNote: 'Professional and informal' },
  });
  assert.equal(context.topic, 'Mini Apps and collaborations');
  assert.equal(context.topicConfigured, true);
  assert.equal(context.audience, 'Founders');
  assert.equal(context.communicationStyle, 'Professional and informal');
});

test('round-trips the published chat style snapshot', () => {
  const original = buildStandaloneChatStyleContext({ name: 'Chat', channelAbout: { topic: 'ESL' } });
  assert.deepEqual(readPublishedChatStyle(chatStyleRulesSnapshot(original)), original);
});

test('keeps the legacy channel context unchanged for publication channels', () => {
  assert.deepEqual(moderatorChannelContext({ kind: 'CHANNEL', name: 'Publium', handle: 'publium' }), {
    channel: 'Publium',
    handle: 'publium',
  });
});

test('blocks off-topic enforcement when standalone chat topic is not published', () => {
  const context = moderatorChannelContext({ kind: 'CHAT', name: 'Chat' });
  const decision = protectUnconfiguredStandaloneOffTopic({
    violation: true,
    category: 'off_topic',
    severity: 'medium',
    directed: false,
    confidence: 0.98,
    reason: 'Не по теме',
    suggestedRewrite: null,
  }, 'CHAT', context);
  assert.equal(decision.violation, false);
  assert.equal(decision.category, 'none');
});

test('allows an off-topic decision after the standalone topic is published', () => {
  const style = buildStandaloneChatStyleContext({ name: 'Chat', channelAbout: { topic: 'ESL practice' } });
  const context = moderatorChannelContext({ kind: 'CHAT', name: 'Chat', publishedRules: chatStyleRulesSnapshot(style) });
  const decision = protectUnconfiguredStandaloneOffTopic({
    violation: true,
    category: 'off_topic',
    severity: 'low',
    directed: false,
    confidence: 0.9,
    reason: 'Не по теме',
    suggestedRewrite: null,
  }, 'CHAT', context);
  assert.equal(decision.violation, true);
  assert.equal(decision.category, 'off_topic');
});

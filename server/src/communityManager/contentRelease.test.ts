import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommunityManagerConfig } from './config';
import { contentReleaseDueAt, contentThreadMatchesMessage } from './contentRelease';

test('silent content release waits twenty minutes by default',()=>{
  assert.equal(contentReleaseDueAt(new Date('2026-07-27T10:00:00.000Z')).toISOString(),'2026-07-27T10:20:00.000Z');
});

test('a reply anywhere in the Telegram discussion thread cancels proactive release support',()=>{
  const thread={discussionMessageId:777};
  assert.equal(contentThreadMatchesMessage(thread,{replyToMessageId:777}),true);
  assert.equal(contentThreadMatchesMessage(thread,{messageThreadId:777}),true);
  assert.equal(contentThreadMatchesMessage(thread,{replyToMessageId:778}),false);
});

test('content silence delay is backward compatible and bounded',()=>{
  assert.equal(parseCommunityManagerConfig({}).activities.contentSilenceMinutes,20);
  assert.equal(parseCommunityManagerConfig({activities:{contentSilenceMinutes:1}}).activities.contentSilenceMinutes,5);
  assert.equal(parseCommunityManagerConfig({activities:{contentSilenceMinutes:999}}).activities.contentSilenceMinutes,180);
});

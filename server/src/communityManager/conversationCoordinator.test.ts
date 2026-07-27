import assert from 'node:assert/strict';
import test from 'node:test';
import { isReplyContentRelevant, normalizeTopicKey } from './conversationCoordinator';

test('topic keys are stable across punctuation and casing',()=>{
  assert.equal(normalizeTopicKey('  SpaceX: Cash Flow  '),'spacex_cash_flow');
});

test('old replied-to content is excluded when classifier detects a new segment',()=>{
  assert.equal(isReplyContentRelevant({sameSegment:false}),false);
  assert.equal(isReplyContentRelevant({sameSegment:true}),true);
});

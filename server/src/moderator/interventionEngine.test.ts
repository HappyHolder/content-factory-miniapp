import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationCategoryForSignal, shouldAnalyzeConversation } from './interventionEngine.js';

test('primary-handled violations feed episodes without a second AI response', () => {
  assert.equal(shouldAnalyzeConversation({messageCount:8,messagesSinceAnalysis:8,isReply:true,hasActiveEpisode:true,moderated:true}),false);
});

test('active episodes are analyzed adaptively without a global cooldown', () => {
  assert.equal(shouldAnalyzeConversation({messageCount:2,messagesSinceAnalysis:1,isReply:false,hasActiveEpisode:true,moderated:false}),true);
});

test('a profanity verdict is stored but cannot create a conflict episode', () => {
  assert.equal(conversationCategoryForSignal('profanity'), 'none');
  assert.equal(conversationCategoryForSignal('toxicity'), 'toxicity');
});

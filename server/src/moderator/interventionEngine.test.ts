import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationRiskDelta, shouldAnalyzeConversation } from './interventionEngine.js';

test('primary-handled violations feed episodes without a second AI response', () => {
  assert.equal(shouldAnalyzeConversation({messageCount:8,messagesSinceAnalysis:8,isReply:true,hasActiveEpisode:true,moderated:true}),false);
});

test('active episodes are analyzed adaptively without a global cooldown', () => {
  assert.equal(shouldAnalyzeConversation({messageCount:2,messagesSinceAnalysis:1,isReply:false,hasActiveEpisode:true,moderated:false}),true);
});

test('direct escalating harassment raises temporary risk more than low tension', () => {
  assert.ok(conversationRiskDelta('high',true,true)>conversationRiskDelta('low',false,false));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CM_CONFIG, parseCommunityManagerConfig, randomInitiativeDate } from './config';
import { chooseAdaptiveActivityType, chooseActivityTopic } from './activityPolicy';

test('default CM is socially active without mandatory setup',()=>{
  assert.equal(DEFAULT_CM_CONFIG.replies.ambientConversation,true);
  assert.equal(DEFAULT_CM_CONFIG.replies.replyToUnansweredQuestion,true);
  assert.equal(DEFAULT_CM_CONFIG.activities.enabled,true);
  assert.equal(DEFAULT_CM_CONFIG.activities.requireApproval,false);
});

test('initiative time is randomized inside the configured silence window',()=>{
  const start=new Date('2026-07-17T10:00:00.000Z');
  assert.equal(randomInitiativeDate(DEFAULT_CM_CONFIG,start,()=>0).toISOString(),'2026-07-17T11:15:00.000Z');
  assert.equal(randomInitiativeDate(DEFAULT_CM_CONFIG,start,()=>1).toISOString(),'2026-07-17T13:00:00.000Z');
});

test('ignored activity changes format instead of causing a multi-day disappearance',()=>{
  const next=chooseAdaptiveActivityType(['DISCUSSION','POLL'],[{type:'DISCUSSION',evaluated:true,engaged:false}]);
  assert.equal(next,'POLL');
});

test('activity topics rotate without inventing a hidden backoff',()=>{
  assert.equal(chooseActivityTopic(['BTC','prediction markets'],['BTC']),'prediction markets');
});

test('legacy initiative quotas are ignored instead of becoming hidden blockers',()=>{
  const config=parseCommunityManagerConfig({activities:{maxInitiativesPerWeek:1},limits:{maxInitiativesPerDay:0}});
  assert.equal('maxInitiativesPerWeek' in config.activities,false);
  assert.equal('maxInitiativesPerDay' in config.limits,false);
});

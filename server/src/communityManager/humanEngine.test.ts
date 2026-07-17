import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CM_CONFIG } from './config';
import { communityPulse, chooseActivityForPulse } from './activityPolicy';
import { consolidateEpisodes, consolidateNotes } from './memoryPolicy';
import { routeSocialAction, type SocialDecision } from './socialRouter';
import { deriveSocialState } from './socialState';

const decision=(patch:Partial<SocialDecision>={}):SocialDecision=>({intent:'conversation',respond:true,research:false,confidence:.9,reason:'social',engagementLevel:'acknowledge',conversationScore:.9,topic:'',valueAdd:'',moderatorFollowup:false,usage:{input:0,output:0},...patch});

test('a lightweight acknowledgement becomes a reaction, not bot text',()=>{
  const route=routeSocialAction({config:DEFAULT_CM_CONFIG,decision:decision(),telegramDirect:false,socialAddress:false,productContext:false,recentModerator:false,cooldownFree:true,hasQuestion:false,socialState:deriveSocialState({participantCount:2,messageCount:4,pendingModerator:false,openQuestions:[],minutesSinceCm:20})});
  assert.equal(route.action,'REACT');
});

test('heated chat does not trigger an unsolicited pile-on',()=>{
  const state=deriveSocialState({participantCount:3,messageCount:15,pendingModerator:true,openQuestions:[],minutesSinceCm:5});
  const route=routeSocialAction({config:DEFAULT_CM_CONFIG,decision:decision({engagementLevel:'contribute',valueAdd:'opinion'}),telegramDirect:false,socialAddress:false,productContext:false,recentModerator:false,cooldownFree:true,hasQuestion:false,socialState:state});
  assert.equal(route.action,'SILENT');
});

test('activity policy reads community pulse instead of sending on a clock alone',()=>{
  const active=communityPulse({messages:12,participants:4,tension:false,openQuestions:0});
  const silent=communityPulse({messages:0,participants:0,tension:false,openQuestions:0});
  assert.equal(chooseActivityForPulse(['DISCUSSION','POLL'],[],active),null);
  assert.equal(chooseActivityForPulse(['DISCUSSION','POLL'],[],silent),'POLL');
});

test('episodic memory consolidates duplicates and retains open loops',()=>{
  const old={at:'2020-01-01T00:00:00.000Z',participant:'Alex',kind:'question' as const,summary:'When is launch?',outcome:'open' as const};
  const recent={...old,at:'2026-07-17T00:00:00.000Z'};
  const result=consolidateEpisodes([old],[recent]);
  assert.equal(result.length,1);
  assert.equal(result[0]?.at,recent.at);
});

test('participant notes are normalized and bounded',()=>{
  assert.deepEqual(consolidateNotes([' Likes BTC ','likes btc','Knows design'],2),['likes btc','Knows design']);
});
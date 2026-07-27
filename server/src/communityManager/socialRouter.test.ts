import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CM_CONFIG } from './config';
import { routeSocialAction, type SocialDecision } from './socialRouter';

const decision=(patch:Partial<SocialDecision>={}):SocialDecision=>({intent:'conversation',respond:true,research:false,confidence:.8,reason:'useful',engagementLevel:'contribute',conversationScore:.7,topic:'market',valueAdd:'specific angle',moderatorFollowup:false,usage:{input:0,output:0},...patch});
const config=(patch:any={})=>({...DEFAULT_CM_CONFIG,replies:{...DEFAULT_CM_CONFIG.replies,ambientConversation:true,thematicConversation:true,participationLevel:'selective' as const,...patch}});

test('direct closure is not forced into another CM reply',()=>{
  const route=routeSocialAction({config:config(),decision:decision({respond:false,engagementLevel:'ignore',speechAct:'closure',conversationComplete:true,expectsReply:false,newContribution:''}),telegramDirect:false,socialAddress:true,productContext:false,recentModerator:false,cooldownFree:false,hasQuestion:false});
  assert.equal(route.action,'SILENT');
});

test('useful thematic contribution does not require magic message length or participant count',()=>{
  const route=routeSocialAction({config:config(),decision:decision(),telegramDirect:false,socialAddress:false,productContext:false,recentModerator:false,cooldownFree:true,hasQuestion:false});
  assert.equal(route.action,'JOIN');
});

test('social rhythm suppresses only unsolicited participation',()=>{
  const ambient=routeSocialAction({config:config(),decision:decision(),telegramDirect:false,socialAddress:false,productContext:false,recentModerator:false,cooldownFree:false,hasQuestion:false});
  const direct=routeSocialAction({config:config(),decision:decision(),telegramDirect:true,socialAddress:false,productContext:false,recentModerator:false,cooldownFree:false,hasQuestion:false});
  assert.equal(ambient.action,'SILENT');assert.equal(direct.action,'REPLY');
});

test('moderator follow-up has priority and is not blocked by ambient cooldown',()=>{
  const route=routeSocialAction({config:config({moderatorFollowups:true}),decision:decision({moderatorFollowup:true}),telegramDirect:false,socialAddress:false,productContext:false,recentModerator:true,cooldownFree:false,hasQuestion:false});
  assert.equal(route.action,'SUPPORT_MODERATOR');assert.equal(route.priority,true);
});

test('isolated low-value acknowledgement stays silent',()=>{
  const route=routeSocialAction({config:config(),decision:decision({respond:false,engagementLevel:'ignore',conversationScore:.2,valueAdd:''}),telegramDirect:false,socialAddress:false,productContext:false,recentModerator:false,cooldownFree:true,hasQuestion:false});
  assert.equal(route.action,'SILENT');
});

test('an unanswered question returns as a priority open loop',()=>{
  const route=routeSocialAction({config:config({replyToUnansweredQuestion:true}),decision:decision({respond:false,conversationScore:.1,valueAdd:''}),telegramDirect:false,socialAddress:false,productContext:false,recentModerator:false,cooldownFree:false,hasQuestion:true,unansweredQuestion:true});
  assert.equal(route.action,'REPLY');assert.equal(route.priority,true);assert.equal(route.replyToCurrent,true);
});

test('question explicitly replied to another human is never answered on their behalf',()=>{
  const route=routeSocialAction({config:config(),decision:decision({conversationScore:.95,engagementLevel:'lead'}),telegramDirect:false,socialAddress:false,addressedToOtherHuman:true,productContext:true,recentModerator:false,cooldownFree:true,hasQuestion:true});
  assert.equal(route.action,'SILENT');assert.equal(route.reason,'question_addressed_to_human');
});

test('explicit CM mention still wins inside a human reply thread',()=>{
  const route=routeSocialAction({config:config(),decision:decision(),telegramDirect:true,socialAddress:false,addressedToOtherHuman:true,productContext:false,recentModerator:false,cooldownFree:true,hasQuestion:true});
  assert.equal(route.action,'REPLY');assert.equal(route.reason,'addressed_to_cm_with_value');
});


test('direct acknowledgement becomes a reaction without ending substantive dialogue globally',()=>{
  const route=routeSocialAction({config:config(),decision:decision({respond:false,engagementLevel:'acknowledge',speechAct:'acknowledgement',expectsReply:false,newContribution:''}),telegramDirect:true,socialAddress:false,productContext:false,recentModerator:false,cooldownFree:false,hasQuestion:false});
  assert.equal(route.action,'REACT');
});

test('a new substantive turn can continue a long direct dialogue',()=>{
  const route=routeSocialAction({config:config(),decision:decision({respond:true,engagementLevel:'contribute',speechAct:'argument',expectsReply:true,newContribution:'new counterargument'}),telegramDirect:true,socialAddress:false,productContext:false,recentModerator:false,cooldownFree:false,hasQuestion:false});
  assert.equal(route.action,'REPLY');
});

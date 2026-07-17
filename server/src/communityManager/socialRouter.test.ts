import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CM_CONFIG } from './config';
import { routeSocialAction, type SocialDecision } from './socialRouter';

const decision=(patch:Partial<SocialDecision>={}):SocialDecision=>({intent:'conversation',respond:true,research:false,confidence:.8,reason:'useful',engagementLevel:'contribute',conversationScore:.7,topic:'market',valueAdd:'specific angle',moderatorFollowup:false,usage:{input:0,output:0},...patch});
const config=(patch:any={})=>({...DEFAULT_CM_CONFIG,replies:{...DEFAULT_CM_CONFIG.replies,ambientConversation:true,thematicConversation:true,participationLevel:'selective' as const,...patch}});

test('direct address always gets a targeted reply',()=>{
  const route=routeSocialAction({config:config(),decision:decision({respond:false,engagementLevel:'ignore'}),telegramDirect:false,socialAddress:true,productContext:false,recentModerator:false,cooldownFree:false,hasQuestion:false});
  assert.equal(route.action,'REPLY');assert.equal(route.replyToCurrent,true);assert.equal(route.priority,true);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { CommunityAgentDecisionSchema } from './agentRuntime';
import { activitySessionKey, conversationSessionKey, durableSessionItems } from './agentSession';
import { participantPublic } from './participantMemory';
import { reviewContentComment } from './contentCommentPolicy';

test('conversation sessions isolate threads and segments while remaining stable',()=>{
  assert.equal(conversationSessionKey('thread-a','segment-a'),'conversation:thread-a:segment-a');
  assert.notEqual(conversationSessionKey('thread-a','segment-a'),conversationSessionKey('thread-a','segment-b'));
  assert.notEqual(conversationSessionKey('thread-a','segment-a'),conversationSessionKey('thread-b','segment-a'));
  assert.notEqual(conversationSessionKey('thread-a','segment-a'),activitySessionKey('daily_digest','2026-07-27'));
});

test('the unified decision contract supports silence without a forced question',()=>{
  const decision=CommunityAgentDecisionSchema.parse({
    action:'no_action',intent:'conversation_complete',targetMessageId:null,message:null,reaction:null,poll:null,
    reason:'People resolved the point themselves',topicKey:'spacex_valuation',sameConversation:true,expectsReply:false,
    conversationComplete:true,references:['msg:101'],digestItems:[],memoryUpdates:[],episode:null,editorialPlan:null,
  });
  assert.equal(decision.action,'no_action');
  assert.equal(decision.expectsReply,false);
});

test('participant API projects evidence-backed roles and expertise without losing owner labels',()=>{
  const participant=participantPublic({id:'p1',tgUserId:'42',username:'stepan',displayName:'Stepan',relationship:'REGULAR',relationshipState:{},roles:['owner-label'],expertise:['TON'],claims:[{kind:'ROLE',displayValue:'founder',status:'CONFIRMED',confidence:.95},{kind:'EXPERTISE',displayValue:'prediction markets',status:'CONFIRMED',confidence:.92},{kind:'PREFERENCE',displayValue:'prefers concise answers',status:'CONFIRMED',confidence:.9}],messageCount:12,cmExchangeCount:4,expertConfirmed:false,mentionEnabled:true,lastSeenAt:new Date(),lastCmExchangeAt:null,lastMentionedAt:null});
  assert.deepEqual(participant.roles,['owner-label','founder']);
  assert.deepEqual(participant.expertise,['TON','prediction markets']);
  assert.equal(participant.memories.length,3);
});
test('session persistence keeps dialogue messages but drops repeated tool payloads',()=>{
  const items=[{type:'message',role:'user',content:'current event'},{type:'function_call',name:'read_current_thread',arguments:'{}',callId:'1'},{type:'function_call_result',callId:'1',output:'large repeated thread'}] as any;
  assert.deepEqual(durableSessionItems(items).map((item:any)=>item.type),['message']);
});

test('content comment policy rejects generic engagement and accepts a grounded added thought',()=>{
  const generic=CommunityAgentDecisionSchema.parse({
    action:'comment',intent:'engage',targetMessageId:501,message:'What do you think about this news?',reaction:null,poll:null,
    reason:'engagement',topicKey:'ai',sameConversation:true,expectsReply:true,conversationComplete:false,references:[],digestItems:[],memoryUpdates:[],episode:null,
    editorialPlan:{disposition:'comment',subject:'Artificial intelligence',addedValue:'Ask participants to discuss the news',evidence:['post']},
  });
  assert.equal(reviewContentComment({decision:generic,postText:'Artificial intelligence changes the market.',replyTargetMessageId:501,sources:0}).approved,false);

  const grounded=CommunityAgentDecisionSchema.parse({
    action:'comment',intent:'content_comment',targetMessageId:501,
    message:'With AI, the important change is not only model capability. Once an agent may act on its own, control quality becomes part of the product rather than a setting added later.',
    reaction:null,poll:null,reason:'Adds a concrete implication',topicKey:'ai_agents',sameConversation:true,expectsReply:false,conversationComplete:false,
    references:['msg:501'],digestItems:[],memoryUpdates:[],episode:null,
    editorialPlan:{disposition:'comment',subject:'AI',addedValue:'Autonomy makes action control a product property',evidence:['post']},
  });
  assert.deepEqual(reviewContentComment({decision:grounded,postText:'AI increasingly moves from answers to autonomous actions.',replyTargetMessageId:501,sources:0}),{approved:true,issues:[]});
});

test('content comment policy requires the exact discussion root and researched evidence',()=>{
  const decision=CommunityAgentDecisionSchema.parse({
    action:'comment',intent:'content_comment',targetMessageId:null,message:'SpaceX must show that its launch cadence supports the company valuation.',reaction:null,poll:null,
    reason:'Adds valuation context',topicKey:'spacex',sameConversation:true,expectsReply:false,conversationComplete:false,references:[],digestItems:[],memoryUpdates:[],episode:null,
    editorialPlan:{disposition:'comment',subject:'SpaceX',addedValue:'Connect valuation with a verifiable launch cadence',evidence:['post','web']},
  });
  const review=reviewContentComment({decision,postText:'SpaceX shares declined.',sources:0});
  assert.equal(review.approved,false);
  assert.ok(review.issues.includes('missing_discussion_root'));
  assert.ok(review.issues.includes('web_claims_without_research'));
});

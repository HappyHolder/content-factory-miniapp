import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConversationGraph } from './conversationGraph';
import { deriveSocialState } from './socialState';

test('conversation graph preserves authors and reply targets',()=>{
  const at=new Date('2026-07-17T10:00:00Z'),identities=new Map([['1','Анна (@anna)'],['2','Борис (@boris)']]);
  const graph=buildConversationGraph({cmName:'Степан',identities,humans:[
    {telegramMessageId:1,replyToMessageId:null,text:'BTC растёт',tgUserId:'1',createdAt:at},
    {telegramMessageId:2,replyToMessageId:1,text:'не согласен',tgUserId:'2',createdAt:new Date(at.getTime()+1000)},
  ],actions:[]});
  assert.match(graph.history,/Борис \(@boris\) \[reply to Анна \(@anna\)\]: не согласен/);
  assert.equal(graph.threadCount,1);
});

test('social state notices active tension and open questions',()=>{
  const state=deriveSocialState({participantCount:3,messageCount:15,pendingModerator:true,openQuestions:['что дальше?'],minutesSinceCm:20});
  assert.equal(state.energy,'high');assert.equal(state.tension,'heated');assert.deepEqual(state.attention,['lower_tension','open_questions']);
});

test('CM response stays in the source human thread',()=>{
  const at=new Date('2026-07-17T10:00:00Z'),identities=new Map([['1','Anna'],['2','Boris']]);
  const graph=buildConversationGraph({cmName:'CM',identities,humans:[
    {telegramMessageId:1,replyToMessageId:null,text:'first thread',tgUserId:'1',createdAt:at},
    {telegramMessageId:2,replyToMessageId:null,text:'second thread',tgUserId:'2',createdAt:new Date(at.getTime()+1000)},
  ],actions:[{telegramMessageId:3,sourceTelegramMessageId:1,response:'answer to Anna',createdAt:new Date(at.getTime()+2000)}]});
  assert.equal(graph.threadCount,2);
  const anna=graph.threads.find(thread=>thread.id===1);
  assert.match(anna?.history??'',/Anna: first thread[\s\S]*CM: answer to Anna/);
});
test('human reply to a CM reply remains in the original human thread',()=>{
  const at=new Date('2026-07-17T10:00:00Z'),identities=new Map([['1','Anna'],['2','Boris']]);
  const graph=buildConversationGraph({cmName:'CM',identities,humans:[
    {telegramMessageId:10,replyToMessageId:null,text:'original topic',tgUserId:'1',createdAt:at},
    {telegramMessageId:30,replyToMessageId:20,text:'follow-up to CM',tgUserId:'2',createdAt:new Date(at.getTime()+2000)},
  ],actions:[{telegramMessageId:20,sourceTelegramMessageId:10,response:'CM answer',createdAt:new Date(at.getTime()+1000)}]});
  assert.equal(graph.threadCount,1);
  assert.match(graph.threads[0]?.history??'',/original topic[\s\S]*CM answer[\s\S]*follow-up to CM/);
});

test('Telegram discussion root groups messages even without direct reply edges',()=>{
  const at=new Date('2026-07-17T10:00:00Z'),identities=new Map([['1','Anna'],['2','Boris']]);
  const graph=buildConversationGraph({cmName:'CM',identities,humans:[
    {telegramMessageId:101,messageThreadId:100,replyToMessageId:null,text:'first',tgUserId:'1',createdAt:at},
    {telegramMessageId:102,messageThreadId:100,replyToMessageId:null,text:'second',tgUserId:'2',createdAt:new Date(at.getTime()+1000)},
  ],actions:[]});
  assert.equal(graph.threadCount,1);assert.equal(graph.threads[0]?.id,100);
});

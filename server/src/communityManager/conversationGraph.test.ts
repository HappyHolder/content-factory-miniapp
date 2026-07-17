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

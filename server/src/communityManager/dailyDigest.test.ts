import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommunityManagerConfig } from './config';
import {
  buildDigestBody,
  buildDigestClusters,
  dailyDigestWindow,
  digestRetentionDate,
  telegramMessageLink,
  topicsFromSelection,
  type DigestSourceMessage,
} from './dailyDigest';

const message=(id:number,minute:number,overrides:Partial<DigestSourceMessage>={}):DigestSourceMessage=>({
  telegramMessageId:id,replyToMessageId:null,messageThreadId:null,messageType:'TEXT',tgUserId:'u'+id,text:'Сообщение '+id,createdAt:new Date('2026-07-18T10:'+String(minute).padStart(2,'0')+':00.000Z'),...overrides,
});

test('daily digest uses the previous calendar day in the configured timezone',()=>{
  const window=dailyDigestWindow(new Date('2026-07-18T05:01:00.000Z'),'Europe/Moscow',8,0);
  assert.equal(window.due,true);
  assert.equal(window.dateKey,'2026-07-17');
  assert.equal(window.displayDate,'17.07.2026');
  assert.equal(window.from.toISOString(),'2026-07-16T21:00:00.000Z');
  assert.equal(window.to.toISOString(),'2026-07-17T21:00:00.000Z');
});

test('daily digest waits until the configured local time',()=>{
  assert.equal(dailyDigestWindow(new Date('2026-07-18T04:59:00.000Z'),'Europe/Moscow',8,0).due,false);
  assert.equal(dailyDigestWindow(new Date('2026-07-18T05:00:00.000Z'),'Europe/Moscow',8,0).due,true);
});

test('digest source survives conversational cleanup',()=>{
  assert.equal(digestRetentionDate(new Date('2026-07-18T00:00:00.000Z')).toISOString(),'2026-07-26T00:00:00.000Z');
});

test('legacy configs do not unexpectedly enable daily digests',()=>{
  const config=parseCommunityManagerConfig({activities:{enabled:true,digestEnabled:true}});
  assert.equal(config.activities.dailyDigestEnabled,false);
  assert.equal(config.activities.dailyDigestHour,8);
  assert.equal(config.activities.dailyDigestMinute,0);
});

test('daily digest settings are validated',()=>{
  const config=parseCommunityManagerConfig({activities:{dailyDigestEnabled:true,dailyDigestHour:25,dailyDigestMinute:-1,dailyDigestMaxTopics:99,dailyDigestImageUrl:'javascript:alert(1)'}});
  assert.equal(config.activities.dailyDigestEnabled,true);
  assert.equal(config.activities.dailyDigestHour,23);
  assert.equal(config.activities.dailyDigestMinute,0);
  assert.equal(config.activities.dailyDigestMaxTopics,6);
  assert.equal(config.activities.dailyDigestImageUrl,'');
});

test('reply chains determine a stable first message even across a long gap',()=>{
  const clusters=buildDigestClusters([
    message(101,0,{tgUserId:'a'}),
    message(102,30,{tgUserId:'b',replyToMessageId:101}),
    message(103,31,{tgUserId:'a',replyToMessageId:102}),
  ]);
  assert.equal(clusters.length,1);
  assert.equal(clusters[0].firstMessageId,101);
  assert.deepEqual(clusters[0].messages.map(item=>item.telegramMessageId),[101,102,103]);
});

test('Telegram topic id joins a discussion while distant bursts stay separate',()=>{
  const clusters=buildDigestClusters([
    message(1,0,{messageThreadId:77}),
    message(2,40,{messageThreadId:77}),
    message(10,1),
    message(11,5),
    message(20,30),
    message(21,31),
  ]);
  assert.equal(clusters.length,3);
  assert.deepEqual(new Set(clusters.map(cluster=>cluster.firstMessageId)),new Set([1,10,20]));
});

test('isolated messages are not promoted to discussions',()=>{
  assert.deepEqual(buildDigestClusters([message(1,0),message(2,20)]),[]);
});

test('structured selection cannot replace the deterministic cluster start',()=>{
  const clusters=buildDigestClusters([message(101,0),message(102,1)]);
  const topics=topicsFromSelection({topics:[
    {clusterId:clusters[0].id,summary:'Обсудили ИИ-модератора.'},
    {clusterId:'cluster_999',summary:'Выдуманная тема.'},
    {clusterId:clusters[0].id,summary:'Дубликат.'},
  ]},clusters,4);
  assert.deepEqual(topics,[{summary:'Обсудили ИИ-модератора.',firstMessageId:101}]);
});

test('Telegram message links support public and private supergroups',()=>{
  assert.equal(telegramMessageLink({tgChatId:'-100123456',username:'@publium_chat'},42),'https://t.me/publium_chat/42');
  assert.equal(telegramMessageLink({tgChatId:'-100123456'},42),'https://t.me/c/123456/42');
  assert.equal(telegramMessageLink({tgChatId:'-123456'},42),null);
});

test('digest body renders checked links and no synthetic conclusion',()=>{
  const body=buildDigestBody([{summary:'Обсудили ИИ-модератора.',firstMessageId:101}],{tgChatId:'-100777'});
  assert.equal(body,'• Обсудили ИИ-модератора.\n↳ https://t.me/c/777/101');
  assert.doesNotMatch(body,/Незакрытый вопрос|полезный итог/i);
});
test('a channel source post remains the first digest link for replies on the next day',()=>{
  const clusters=buildDigestClusters([
    message(900,0,{messageType:'CHANNEL_POST',tgUserId:null,text:'SpaceX fell 51 percent after the listing',createdAt:new Date('2026-07-27T23:58:00.000Z'),messageThreadId:900}),
    message(901,1,{tgUserId:'alice',text:'The launch valuation was too high',replyToMessageId:900,messageThreadId:900,createdAt:new Date('2026-07-28T00:01:00.000Z')}),
    message(902,2,{tgUserId:'bob',text:'Cash flow matters more than the headline price',replyToMessageId:901,messageThreadId:900,createdAt:new Date('2026-07-28T00:02:00.000Z')}),
  ]);
  assert.equal(clusters.length,1);
  assert.equal(clusters[0].firstMessageId,900);
  assert.equal(buildDigestBody([{summary:'SpaceX: участники спорили об оценке на листинге и роли денежного потока.',firstMessageId:clusters[0].firstMessageId}],{tgChatId:'-100777'}),'• SpaceX: участники спорили об оценке на листинге и роли денежного потока.\n↳ https://t.me/c/777/900');
});

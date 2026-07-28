import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommunityManagerConfig } from './config';
import { automaticChannelMirror, contentReleaseDueAt, contentRootDeadlineAt, contentThreadMatchesMessage } from './contentRelease';

test('silent content release waits twenty minutes by default',()=>{
  assert.equal(contentReleaseDueAt(new Date('2026-07-27T10:00:00.000Z')).toISOString(),'2026-07-27T10:20:00.000Z');
});

test('a reply anywhere in the Telegram discussion thread cancels proactive release support',()=>{
  const thread={discussionMessageId:777};
  assert.equal(contentThreadMatchesMessage(thread,{replyToMessageId:777}),true);
  assert.equal(contentThreadMatchesMessage(thread,{messageThreadId:777}),true);
  assert.equal(contentThreadMatchesMessage(thread,{replyToMessageId:778}),false);
});

test('content silence delay is backward compatible and bounded',()=>{
  assert.equal(parseCommunityManagerConfig({}).activities.contentSilenceMinutes,20);
  assert.equal(parseCommunityManagerConfig({activities:{contentSilenceMinutes:1}}).activities.contentSilenceMinutes,5);
  assert.equal(parseCommunityManagerConfig({activities:{contentSilenceMinutes:999}}).activities.contentSilenceMinutes,180);
});

test('discussion root has a bounded grace period and never falls back to a standalone comment',()=>{
  assert.equal(contentRootDeadlineAt(new Date('2026-07-27T10:00:00.000Z')).toISOString(),'2026-07-27T10:30:00.000Z');
});

test('automatic channel mirror is recognized from modern Telegram origin',()=>{
  assert.deepEqual(automaticChannelMirror({
    message_id:900,
    is_automatic_forward:true,
    sender_chat:{id:-100222},
    forward_origin:{type:'channel',chat:{id:-100222},message_id:77},
  }),{sourceChatId:-100222,channelMessageId:77,discussionMessageId:900});
});

test('channel mirror still supports the legacy Telegram fields',()=>{
  assert.deepEqual(automaticChannelMirror({
    message_id:901,
    is_automatic_forward:true,
    sender_chat:{id:-100333},
    forward_from_message_id:88,
  }),{sourceChatId:-100333,channelMessageId:88,discussionMessageId:901});
  assert.equal(automaticChannelMirror({message_id:902,sender_chat:{id:-100333},forward_origin:{type:'channel',chat:{id:-100333},message_id:89}}),null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommunityManagerConfig } from './config';
import { dailyDigestWindow, digestRetentionDate } from './dailyDigest';

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
  const config=parseCommunityManagerConfig({activities:{
    dailyDigestEnabled:true,
    dailyDigestHour:25,
    dailyDigestMinute:-1,
    dailyDigestMaxTopics:99,
    dailyDigestImageUrl:'javascript:alert(1)',
  }});
  assert.equal(config.activities.dailyDigestEnabled,true);
  assert.equal(config.activities.dailyDigestHour,23);
  assert.equal(config.activities.dailyDigestMinute,0);
  assert.equal(config.activities.dailyDigestMaxTopics,6);
  assert.equal(config.activities.dailyDigestImageUrl,'');
});

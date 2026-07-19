import test from 'node:test';
import assert from 'node:assert/strict';
import { ignoredActivityBackoff, initiativeScheduleBase } from './activityScheduler';

test('recent silence keeps its original intensity window',()=>{
  const now=new Date('2026-07-19T10:30:00.000Z');
  const silenceFrom=new Date('2026-07-19T10:00:00.000Z');
  assert.equal(initiativeScheduleBase(silenceFrom,now,'active'),silenceFrom);
});

test('stale blocked schedules restart from now without a deployment burst',()=>{
  const now=new Date('2026-07-19T10:00:00.000Z');
  const silenceFrom=new Date('2026-07-18T10:00:00.000Z');
  assert.equal(initiativeScheduleBase(silenceFrom,now,'active'),now);
});

test('two ignored initiatives create a long pause even in active mode',()=>{
  const sentAt=new Date('2026-07-19T10:00:00.000Z');
  assert.equal(ignoredActivityBackoff(2,'active',sentAt)?.toISOString(),'2026-07-19T19:00:00.000Z');
});

test('continued silence grows the pause instead of producing a message chain',()=>{
  const sentAt=new Date('2026-07-19T10:00:00.000Z');
  assert.equal(ignoredActivityBackoff(3,'balanced',sentAt)?.toISOString(),'2026-07-20T22:00:00.000Z');
  assert.equal(ignoredActivityBackoff(4,'quiet',sentAt)?.toISOString(),'2026-07-25T10:00:00.000Z');
});

test('one ignored initiative still permits one varied human check-in',()=>{
  assert.equal(ignoredActivityBackoff(1,'active',new Date()),null);
});

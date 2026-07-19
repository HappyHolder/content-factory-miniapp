import test from 'node:test';
import assert from 'node:assert/strict';
import { initiativeScheduleBase } from './activityScheduler';

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
